import amqp, { Channel, ChannelModel, Connection } from "amqplib";
import { DealRepository } from "../repositories/deal.repository.js";
import { isTransientError } from "../error.js";

class RabbitMQSubscriber {
    private connection: ChannelModel | null = null;
    private channel: Channel | null = null;
    private readonly queue = "scraper_deals_queue";

    dealRepo = new DealRepository();
    constructor() { }

    async init() {
        try {
            this.connection = await amqp.connect("amqp://localhost:5672");
            this.channel = await this.connection.createChannel();

            await this.channel.assertQueue(this.queue, { durable: true });

            // 1. Prefetch: Don't give this worker more than 1 message at a time
            // This prevents one worker from getting overloaded while others are idle
            this.channel.prefetch(1);

            console.log(`Waiting for messages in ${this.queue}...`);

            // 2. Start consuming
            this.channel.consume(this.queue, async (msg) => {
                if (msg) {
                    await this.handleMessage(msg);
                }
            });
        } catch (error) {
            console.error("❌ Subscriber Error:", error);
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
            // then syncing the deals for that brand
            await this.dealRepo.syncDealsForBrand(brand._id.toString(), content.deals);


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
}

export const rabbitMQSubscriber = new RabbitMQSubscriber();