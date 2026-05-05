import amqp, { Channel, ChannelModel } from "amqplib";
import { DealRepository } from "../repositories/deal.repository.js";
import { isTransientError } from "../error.js";

class RabbitMQSubscriber {
    private connection: ChannelModel | null = null;
    private channel: Channel | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private reconnectAttempts = 0;
    private shuttingDown = false;
    private suppressReconnect = false;
    private readonly queue = "scraper_deals_queue";
    private readonly maxReconnectDelayMs = 30000;

    dealRepo = new DealRepository();
    constructor() { }

    async init() {
        this.shuttingDown = false;
        void this.connect();
    }

    private clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private cleanupConnection() {
        this.channel = null;
        this.connection = null;
    }

    private scheduleReconnect(reason: string) {
        if (this.shuttingDown || this.suppressReconnect || this.reconnectTimer) return;

        const delay = Math.min(1000 * 2 ** this.reconnectAttempts, this.maxReconnectDelayMs);
        this.reconnectAttempts = Math.min(this.reconnectAttempts + 1, 5);

        console.warn(`RabbitMQ subscriber reconnect scheduled in ${delay}ms (${reason}).`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect();
        }, delay);
    }

    private attachConnectionHandlers() {
        if (!this.connection) return;

        this.connection.on("error", (error) => {
            console.error("❌ RabbitMQ subscriber connection error:", error);
        });

        this.connection.on("close", () => {
            console.warn("RabbitMQ subscriber connection closed.");
            this.cleanupConnection();
            this.scheduleReconnect("connection closed");
        });
    }

    private attachChannelHandlers() {
        if (!this.channel) return;

        this.channel.on("error", (error) => {
            console.error("❌ RabbitMQ subscriber channel error:", error);
        });

        this.channel.on("close", () => {
            console.warn("RabbitMQ subscriber channel closed.");
            this.cleanupConnection();
            this.scheduleReconnect("channel closed");
        });
    }

    private async closeResources() {
        const channel = this.channel;
        const connection = this.connection;

        this.cleanupConnection();
        this.suppressReconnect = true;

        try {
            if (channel) {
                await channel.close();
            }
        } catch {
            // ignore shutdown races
        }

        try {
            if (connection) {
                await connection.close();
            }
        } catch {
            // ignore shutdown races
        }

        this.suppressReconnect = false;
    }

    private async connect() {
        try {
            this.clearReconnectTimer();

            if (this.connection || this.channel) {
                await this.closeResources();
            }

            this.connection = await amqp.connect(process.env.RABBITMQ_URL || "amqp://localhost");
            this.attachConnectionHandlers();

            this.channel = await this.connection.createChannel();
            this.attachChannelHandlers();

            await this.channel.assertQueue(this.queue, { durable: true });

            // 1. Prefetch: Don't give this worker more than 1 message at a time
            // This prevents one worker from getting overloaded while others are idle
            this.channel.prefetch(1);

            this.reconnectAttempts = 0;
            console.log(`Waiting for messages in ${this.queue}...`);

            // 2. Start consuming
            this.channel.consume(this.queue, async (msg) => {
                if (msg) {
                    await this.handleMessage(msg);
                }
            });
        } catch (error) {
            console.error("❌ Subscriber Error:", error);
            this.cleanupConnection();
            this.scheduleReconnect("initial connection failed");
        }
    }

    async handleMessage(msg: amqp.ConsumeMessage) {
        let content;
        try {
            content = JSON.parse(msg.content.toString());
        } catch (err) {
            this.channel?.nack(msg, false, false); // discard or DLQ
            return;
        }

        try {
            console.log("Received brandinfo");
            console.log(content.brandInfo.brand, content.brandInfo.slug, content.brandInfo.url, content.deals.length);
            // make the object for sending to the function
            const brandInfo = {
                name: content.brandInfo.brand,
                slug: content.brandInfo.slug,
                baseUrl: content.brandInfo.url
            }
            // here we will be sending the data to the database and then we will be acknowledging the message
            // first extracting and saving the brand
            const brand = await this.dealRepo.updateOrInsertBrand(brandInfo);
            // adding brandLogoUrl to the brandInfo object for syncing the deals
            const enrichedBrandInfo = {
                ...content.brandInfo,
                logoUrl: brand.imgUrl ?? "",
            };
            // then syncing the deals for that brand
            await this.dealRepo.syncDealsForBrand(brand._id.toString(), content.deals, enrichedBrandInfo);


            // 3. Acknowledge: Tell RabbitMQ the message is processed and can be deleted
            if (this.channel) {
                this.channel.ack(msg);
            }

        }
        // error handling to be imporved. 
        catch (error) {
            if (this.channel)
                if (isTransientError(error)) {
                    // retry
                    this.channel.nack(msg, false, true);
                } else {
                    // permanent failure → remove from main queue
                    this.channel.nack(msg, false, false);
                }
        }
    }

    async closeSubscriber(): Promise<void> {
        this.shuttingDown = true;
        this.clearReconnectTimer();
        await this.closeResources();
    }
}

export const rabbitMQSubscriber = new RabbitMQSubscriber();