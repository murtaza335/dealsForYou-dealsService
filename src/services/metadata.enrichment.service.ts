import "dotenv/config";
import { DealDocument } from "../models/deal.model.js";

export interface DealMetadataEnrichmentResult {
  metadata: Record<string, unknown>;
  source: string;
  model?: string;
  enrichedAt: Date;
}

interface MetadataEnrichmentConfig {
  enabled: boolean;
  apiKey?: string;
  baseUrl: string;
  model?: string;
  timeoutMs: number;
  batchSize: number;
  minIntervalMs: number;
  maxRetries: number;
}

type LlmResponseShape = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

function toPlainDeal(deal: DealDocument): Record<string, unknown> {
  const maybeDoc = deal as { toObject?: () => Record<string, unknown> };

  return typeof maybeDoc.toObject === "function"
    ? maybeDoc.toObject()
    : (deal as unknown as Record<string, unknown>);
}

function normalizeMetadata(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function extractJsonFromText(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    const firstBracket = trimmed.indexOf("[");
    const lastBracket = trimmed.lastIndexOf("]");

    if (firstBracket >= 0 && lastBracket > firstBracket) {
      try {
        return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
      } catch {
        // ignore
      }
    }

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        // ignore
      }
    }

    return null;
  }
}

class MetadataEnrichmentService {
  private getConfig(): MetadataEnrichmentConfig {
    const enabled = (process.env.DEAL_METADATA_ENRICHMENT_ENABLED ?? "true").toLowerCase() !== "false";
    const batchSize = Math.min(10, Math.max(1, Number(process.env.DEAL_METADATA_ENRICHMENT_BATCH_SIZE ?? "3")));
    const minIntervalMs = Math.max(0, Number(process.env.DEAL_METADATA_ENRICHMENT_MIN_INTERVAL_MS ?? "1000"));
    const maxRetries = Math.max(0, Number(process.env.DEAL_METADATA_ENRICHMENT_MAX_RETRIES ?? "3"));

    return {
      enabled,
      apiKey: process.env.GROQ_API_KEY?.trim() || undefined,
      baseUrl: process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1",
      model: process.env.GROQ_MODEL?.trim() || "llama-3.1-8b-instant",
      timeoutMs: Number(process.env.DEAL_METADATA_ENRICHMENT_TIMEOUT_MS ?? "15000"),
      batchSize,
      minIntervalMs,
      maxRetries,
    };
  }

  private compactDealPayload(deal: DealDocument): Record<string, unknown> {
    const plainDeal = toPlainDeal(deal);

    return {
      dealId: plainDeal.dealId,
      externalId: plainDeal.externalId,
      title: plainDeal.title,
      description: plainDeal.description ?? "",
      price: plainDeal.price,
      originalPrice: plainDeal.originalPrice ?? null,
      currency: plainDeal.currency ?? "PKR",
      discountPercent: plainDeal.discountPercent ?? null,
      minPersons: plainDeal.minPersons ?? null,
      maxPersons: plainDeal.maxPersons ?? null,
      cuisineTags: Array.isArray(plainDeal.cuisineTags) ? plainDeal.cuisineTags : [],
      mealType: Array.isArray(plainDeal.mealType) ? plainDeal.mealType : [],
      conditions: plainDeal.conditions ?? "",
      brandSlug: plainDeal.brandSlug ?? "",
    };
  }

  private buildPromptPayload(deals: DealDocument[], brandId: string): Record<string, unknown> {
    return {
      task: "deal_metadata_enrichment",
      brandId,
      deals: deals.map((deal) => this.compactDealPayload(deal)),
      rules: [
        "Infer metadata from title, description, price, originalPrice, discountPercent, minPersons, maxPersons, conditions, cuisineTags, and mealType.",
        "Do not copy fields verbatim; categorize them.",
        "If a deal looks like a burger combo, classify cuisineTags with values like burger, fast_food, combo, family_meal when appropriate.",
        "If persons can be inferred, set persons to a number or a range string such as 2 or 2-4.",
        "If price suggests cheap, mid, premium, or luxury, set priceTier accordingly.",
        "If discount is meaningful, set discountTier such as none, low, medium, or high.",
        "Always return useful tags even when source arrays are empty if the text clearly implies them.",
        "Use empty arrays only when no confident tag can be inferred.",
      ],
      output: {
        type: "array",
        itemShape: {
          dealId: "string",
          metadata: {
            summary: "string",
            keywords: ["string"],
            cuisineTags: ["string"],
            mealTypes: ["string"],
            persons: "string",
            priceTier: "string",
            discountTier: "string",
            intentTags: ["string"],
            confidence: "number",
          },
        },
      },
    };
  }

  private async callGroqForBatch(
    deals: DealDocument[],
    brandId: string,
    config: MetadataEnrichmentConfig
  ): Promise<Array<{ dealId: string; metadata: Record<string, unknown> }>> {
    const systemPrompt =
      "You extract structured metadata from deal listings. Infer categories and attributes from the deal text. Return ONLY valid JSON array. Each item must contain dealId and metadata. No markdown, no code fences. Prefer confident categorization over empty output.";

    const userPrompt = JSON.stringify(this.buildPromptPayload(deals, brandId));
    const estimatedInputTokens = estimateTokensFromText(systemPrompt) + estimateTokensFromText(userPrompt);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.max(1000, config.timeoutMs));

    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          max_tokens: Math.max(256, Math.min(1800, Math.floor(6000 - estimatedInputTokens - 200))),
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;

        const error = new Error(
          `metadata enrichment request failed | status=${response.status} | body=${errorText.slice(0, 300)}`
        ) as Error & { retryAfterMs?: number };

        if (response.status === 429) {
          error.retryAfterMs = Number.isFinite(retryAfterSeconds) ? Math.max(1000, retryAfterSeconds * 1000) : 2000;
        }

        throw error;
      }

      const responseBody = (await response.json()) as LlmResponseShape;
      const content = responseBody.choices?.[0]?.message?.content?.trim() ?? "";
      const parsed = extractJsonFromText(content);

      const items = Array.isArray(parsed) ? parsed : null;
      if (!items) {
        throw new Error("Groq batch response did not contain a valid JSON array");
      }

      return items
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return null;
          }

          const record = item as { dealId?: unknown; metadata?: unknown };
          if (typeof record.dealId !== "string" || !record.dealId.trim()) {
            return null;
          }

          const metadata = normalizeMetadata(record.metadata);
          if (!metadata) {
            return null;
          }

          return {
            dealId: record.dealId.trim(),
            metadata,
          };
        })
        .filter((entry): entry is { dealId: string; metadata: Record<string, unknown> } => entry !== null);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async callGroqWithRetry(
    deals: DealDocument[],
    brandId: string,
    config: MetadataEnrichmentConfig
  ): Promise<Array<{ dealId: string; metadata: Record<string, unknown> }>> {
    let attempt = 0;

    while (true) {
      try {
        return await this.callGroqForBatch(deals, brandId, config);
      } catch (error) {
        const err = error as Error & { retryAfterMs?: number };
        const isRateLimit = err.message.includes("status=429");
        const canRetry = isRateLimit && attempt < config.maxRetries;

        if (!canRetry) {
          throw error;
        }

        const baseDelay = err.retryAfterMs ?? 1500;
        const backoffDelay = Math.min(15000, baseDelay * Math.pow(2, attempt));
        console.warn(
          `[MetadataEnrichment] Rate limited | batchSize=${deals.length} | attempt=${attempt + 1} | waitingMs=${backoffDelay}`
        );
        await sleep(backoffDelay);
        attempt += 1;
      }
    }
  }

  async enrichDealsMetadata(
    deals: DealDocument[],
    brandId: string
  ): Promise<Array<{ dealId: string; metadata: Record<string, unknown> }>> {
    const config = this.getConfig();

    if (!config.enabled) {
      console.log(`[MetadataEnrichment] Skipped | disabled=true | count=${deals.length}`);
      return [];
    }

    if (!config.apiKey) {
      console.warn(`[MetadataEnrichment] Skipped | missing GROQ_API_KEY | count=${deals.length}`);
      return [];
    }

    const results: Array<{ dealId: string; metadata: Record<string, unknown> }> = [];
    const batchSize = Math.max(1, config.batchSize);

    for (let index = 0; index < deals.length; index += batchSize) {
      const batch = deals.slice(index, index + batchSize);

      if (index > 0 && config.minIntervalMs > 0) {
        await sleep(config.minIntervalMs);
      }

      try {
        const batchResults = await this.callGroqWithRetry(batch, brandId, config);
        results.push(...batchResults);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "unknown error";
        console.error(`[MetadataEnrichment] Batch failed | batchIndex=${Math.floor(index / batchSize) + 1} | error=${errMsg}`);
      }
    }

    return results;
  }

  async enrichDealMetadata(
    deal: DealDocument,
    brandId: string
  ): Promise<DealMetadataEnrichmentResult | null> {
    const config = this.getConfig();

    if (!config.enabled) {
      console.log(`[MetadataEnrichment] Skipped | disabled=true | dealId=${deal.dealId}`);
      return null;
    }

    if (!config.apiKey) {
      console.warn(`[MetadataEnrichment] Skipped | missing GROQ_API_KEY | dealId=${deal.dealId}`);
      return null;
    }

    try {
      const batchResults = await this.enrichDealsMetadata([deal], brandId);
      const metadata = batchResults[0]?.metadata ?? null;

      if (!metadata) {
        throw new Error("Groq response did not contain valid JSON metadata");
      }

      return {
        metadata,
        source: "groq",
        model: config.model,
        enrichedAt: new Date(),
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "unknown error";
      console.error(`[MetadataEnrichment] Failed | dealId=${deal.dealId} | error=${errMsg}`);
      return null;
    }
  }
}

export const metadataEnrichmentService = new MetadataEnrichmentService();