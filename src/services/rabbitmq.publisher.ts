import amqp, { Channel, ChannelModel } from "amqplib";
import { DealDocument } from "../models/deal.model.js";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let reconnectPromise: Promise<Channel> | null = null;

type DealPayloadInput = DealDocument | Record<string, unknown>;

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost:5672";
const MAX_PUBLISH_ATTEMPTS = 3;

function resetPublisherState() {
  connection = null;
  channel = null;
}

function attachPublisherHandlers(conn: ChannelModel, ch: Channel) {
  conn.on("error", (error) => {
    console.error("RabbitMQ publisher connection error:", error);
  });

  conn.on("close", () => {
    console.warn("RabbitMQ publisher connection closed.");
    resetPublisherState();
  });

  ch.on("error", (error) => {
    console.error("RabbitMQ publisher channel error:", error);
  });

  ch.on("close", () => {
    console.warn("RabbitMQ publisher channel closed.");
    resetPublisherState();
  });
}

async function connectPublisherChannel(): Promise<Channel> {
  const conn = await amqp.connect(RABBITMQ_URL);
  const ch = await conn.createChannel();
  await ch.assertExchange("deals.events", "direct", { durable: true });

  connection = conn;
  channel = ch;
  attachPublisherHandlers(conn, ch);

  return ch;
}

function normalizeDealPayload(dealData: DealPayloadInput): Record<string, unknown> {
  const maybeDoc = dealData as { toObject?: () => Record<string, unknown> };
  const plain =
    typeof maybeDoc.toObject === "function"
      ? maybeDoc.toObject()
      : (dealData as Record<string, unknown>);

  const rawBrandSlug = plain.brandSlug;
  const rawBrandName = plain.brandName;
  const brandSlug =
    typeof rawBrandSlug === "string" && rawBrandSlug.trim().length > 0
      ? rawBrandSlug
      : typeof rawBrandName === "string" && rawBrandName.trim().length > 0
        ? rawBrandName
        : "unknown-brand";

  return {
    ...plain,
    brandSlug,
    brandName: brandSlug,
  };
}

async function getChannel(): Promise<Channel> {
  if (channel) return channel;

  if (reconnectPromise) return reconnectPromise;

  reconnectPromise = connectPublisherChannel().finally(() => {
    reconnectPromise = null;
  });

  return reconnectPromise;
}

async function getChannelWithRetry(): Promise<Channel> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt += 1) {
    try {
      return await getChannel();
    } catch (error) {
      lastError = error;
      resetPublisherState();

      if (attempt < MAX_PUBLISH_ATTEMPTS) {
        const delay = 1000 * attempt;
        console.warn(
          `RabbitMQ publisher connect failed (attempt ${attempt}/${MAX_PUBLISH_ATTEMPTS}). Retrying in ${delay}ms.`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to connect to RabbitMQ");
}

async function publishWithRetry(
  payload: Record<string, unknown>,
  routingKey: "deal_created" | "deal_updated" | "deal_status_changed"
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt += 1) {
    try {
      const ch = await getChannelWithRetry();
      ch.publish("deals.events", routingKey, Buffer.from(JSON.stringify(payload)), {
        persistent: true,
        contentType: "application/json",
      });
      return;
    } catch (error) {
      lastError = error;
      resetPublisherState();

      if (attempt < MAX_PUBLISH_ATTEMPTS) {
        const delay = 1000 * attempt;
        console.warn(
          `RabbitMQ publish failed (attempt ${attempt}/${MAX_PUBLISH_ATTEMPTS}). Retrying in ${delay}ms.`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to publish RabbitMQ event");
}

export async function publishDealEvent(
  routingKey: "deal_created" | "deal_updated" | "deal_status_changed",
  dealId: string,
  dealData: Record<string, unknown>,
  brandId: string
): Promise<void> {
  const payload = {
    eventType: routingKey,
    dealId,
    brandId,
    dealData,
    occurredAt: new Date().toISOString(),
  };

  await publishWithRetry(payload, routingKey);
}

export async function publishDealCreated(dealId: string, dealData: DealPayloadInput, brandId: string) {
  const plainDealData = normalizeDealPayload(dealData);
  return publishDealEvent("deal_created", dealId, plainDealData, brandId);
}

export async function publishDealUpdated(dealId: string, dealData: DealPayloadInput, brandId: string) {
  const plainDealData = normalizeDealPayload(dealData);
  return publishDealEvent("deal_updated", dealId, plainDealData, brandId);
}

export async function closePublisher(): Promise<void> {
  if (channel) await channel.close();
  if (connection) await connection.close();
  resetPublisherState();
}
