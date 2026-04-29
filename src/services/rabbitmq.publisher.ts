import amqp, { Channel, ChannelModel } from "amqplib";
import { DealDocument } from "../models/deal.model.js";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

type DealPayloadInput = DealDocument | Record<string, unknown>;

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

  const conn = await amqp.connect(process.env.RABBITMQ_URL || "amqp://localhost:5672");
  const ch = await conn.createChannel();
  await ch.assertExchange("deals.events", "direct", { durable: true });

  connection = conn;
  channel = ch;

  return ch;
}

export async function publishDealEvent(
  routingKey: "deal_created" | "deal_updated" | "deal_status_changed",
  dealId: string,
  dealData: Record<string, unknown>,
  brandId: string
): Promise<void> {
  const ch = await getChannel();

  const payload = {
    eventType: routingKey,
    dealId,
    brandId,
    dealData,
    occurredAt: new Date().toISOString(),
  };

  ch.publish("deals.events", routingKey, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: "application/json",
  });
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
}
