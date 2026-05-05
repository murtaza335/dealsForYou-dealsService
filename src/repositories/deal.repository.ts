import { DealModel } from "../models/deal.model.js";
import mongoose from "mongoose";
import { LogModel } from "../models/logs.js";
import { LogDocument } from "../models/logs.js";
import { DealDocument } from "../models/deal.model.js";
import { BrandDocument, BrandModel } from "../models/brands.model.js";
import { v4 as uuidv4 } from "uuid";
import { publishDealCreated } from "../services/rabbitmq.publisher.js";
import { metadataEnrichmentService } from "../services/metadata.enrichment.service.js";

export interface DealFilters {
  minPrice?: number;
  maxPrice?: number;
  query?: string;
  brand?: string;
  brands?: string[];
  cuisineTags?: string[];
  mealTypes?: string[];
  minDiscount?: number;
  maxDiscount?: number;
  minPersons?: number;
  maxPersons?: number;
  isHot?: boolean;
  isActive?: boolean;
  isExpired?: boolean;
  startAfter?: Date;
  endBefore?: Date;
  page?: number;
  limit?: number;
  sortBy?: "createdAt" | "price" | "discountPercent" | "viewsCount" | "endTime";
  sortOrder?: "asc" | "desc";
}

export interface DealsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface DealsListResult {
  items: DealDocument[];
  pagination: DealsPagination;
}

export interface DealFilterOptions {
  brands: Array<{ name: string; slug: string }>;
  cuisineTags: string[];
  mealTypes: string[];
  currencies: string[];
  priceRange: { min: number; max: number };
  discountRange: { min: number; max: number };
  personsRange: { min: number; max: number };
}

export interface UpdateBrandInput {
  name?: string;
  slug?: string;
  baseUrl?: string;
  isActive?: boolean;
  tagline?: string;
  description?: string;
  imgUrl?: string;
  logoUrl?: string;
  website?: string;
  cities?: string[];
  areas?: string[];
  locations?: Array<{ lat: number; lng: number }>;
  country?: string;
}

export interface BrandDealUpsertInput {
  externalId: string;
  title: string;
  description?: string;
  price: number;
  originalPrice?: number;
  currency?: string;
  discountPercent?: number;
  minPersons?: number;
  maxPersons?: number;
  cuisineTags?: string[];
  mealType?: string[];
  conditions?: string;
  startTime?: string | Date;
  endTime?: string | Date;
  imgUrl?: string;
  isHot?: boolean;
  isActive?: boolean;
}

// const brandSchema = new Schema<BrandDocument>(
//   {
//     brandId: {
//       type: String,
//       required: true,
//       unique: true,
//       default: () => new mongoose.Types.ObjectId().toString() // Generate UUID string
//     },
//     name: { type: String, required: true, unique: true },
//     slug: { type: String, required: true, unique: true },
//     baseUrl: { type: String, required: true },
//     isActive: { type: Boolean, default: true },
//     publishedAt: { type: Date, default: Date.now },
//     tagline: { type: String },
//     description: { type: String },
//     logoUrl: { type: String },
//     website: { type: String },
//     city: { type: String },
//     area: { type: String },
//     location: { type: { lat: Number, lng: Number } },
//     country: { type: String },
//     createdAt: { type: Date, default: Date.now },
//     updatedAt: { type: Date, default: Date.now }
//   },
//   { timestamps: true }
// );

export class DealRepository {

  private escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private toSortedUniqueStrings(values: unknown[]): string[] {
    const result = new Set<string>();

    for (const value of values) {
      if (typeof value !== "string") {
        continue;
      }

      const normalized = value.trim();
      if (normalized.length === 0) {
        continue;
      }

      result.add(normalized);
    }

    return [...result].sort((a, b) => a.localeCompare(b));
  }

  private isRetryableSyncError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
      return false;
    }

    const mongoError = error as { code?: number; hasErrorLabel?: (label: string) => boolean };
    const isDuplicateKey = mongoError.code === 11000;
    const isTransientTransaction = Boolean(mongoError.hasErrorLabel?.("TransientTransactionError"));
    const isUnknownCommitResult = Boolean(mongoError.hasErrorLabel?.("UnknownTransactionCommitResult"));

    return isDuplicateKey || isTransientTransaction || isUnknownCommitResult;
  }

  private isTransactionUnsupportedError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
      return false;
    }

    const mongoError = error as { message?: string };
    return (mongoError.message ?? "").includes("Transaction numbers are only allowed");
  }

  private normalizeStringArray(values: unknown): string[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  private normalizeDate(value: string | Date | undefined): Date | undefined {
    if (value === undefined) {
      return undefined;
    }

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private async resolveBrand(brandIdentifier: string): Promise<BrandDocument | null> {
    const identifier = brandIdentifier.trim();

    if (!identifier.length) {
      return null;
    }

    return BrandModel.findOne({
      $or: [
        { _id: identifier },
        { brandId: identifier },
        { slug: identifier },
      ],
    });
  }

  private getBrandLogo(brand: BrandDocument): string {
    return brand.imgUrl ?? brand.logoUrl ?? "";
  }

  // the function we need are:
  // 1. updateOrInsertBrand(brandInfo{}) - this will check if the brand already exists in the database by its slug and if it does it will return the brand document otherwise it will create a new brand document and return it
  // 2. syncDealsForBrand(brandId, deals) - this will take the brand id and the array of deals for that brand and it will sync the deals in the database by doing the following:
  //    a. for each deal in the array it will check if the deal already exists in the database by its externalId and brandId and if it does it will update the existing deal document with the new data otherwise it will create a new deal document
  //    b. after processing all the deals in the array it will also check if there are any deals in the database for that brand that are not in the new array of deals and if there are it will mark those deals as inactive.
  // 3. getActiveDealsForBrand(brandId) - this will return all the active deals for a given brand id
  // 4. getDealById(dealId) - this will return a single deal document by its deal id
  // 5. incrementDealViews(dealId) - this will increment the views count for a given deal id by 1
  // 6. markHotDeals() - this will be a function that will be called by a background job to mark the hot deals based on the views count and the discount percent or any other criteria we want to use to determine if a deal is hot or not.

  async updateOrInsertBrand(
    brandInfo: { name: string; slug: string; baseUrl: string , brandLogoUrl?: string }
  ): Promise<BrandDocument> {

    const brand = await BrandModel.findOneAndUpdate(
      { slug: brandInfo.slug },
      {
        $set: {
          ...brandInfo
        },
        $setOnInsert: {
          publishedAt: new Date()
        }
      },
      {
        returnDocument: "after",
        upsert: true,
        runValidators: true
      }
    );

    if (!brand) {
      throw new Error("Brand upsert failed");
    }
    console.log("Upserted brand:", brand.slug, brand._id);

    return brand;
  }

  async updateBrand(brandIdentifier: string, updates: UpdateBrandInput): Promise<BrandDocument | null> {
    const brand = await this.resolveBrand(brandIdentifier);

    if (!brand) {
      return null;
    }

    const brandUpdates: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        continue;
      }

      if (key === "logoUrl" && updates.imgUrl === undefined) {
        brandUpdates.imgUrl = value;
        continue;
      }

      brandUpdates[key] = value;
    }

    if (Object.keys(brandUpdates).length === 0) {
      return brand;
    }

    const updatedBrand = await BrandModel.findByIdAndUpdate(
      brand._id,
      { $set: brandUpdates },
      { new: true, runValidators: true }
    );

    if (!updatedBrand) {
      return null;
    }

    const dealUpdates: Record<string, unknown> = {};

    if (Object.prototype.hasOwnProperty.call(brandUpdates, "slug")) {
      dealUpdates.brandSlug = updatedBrand.slug;
    }

    if (Object.prototype.hasOwnProperty.call(brandUpdates, "baseUrl")) {
      dealUpdates.baseUrl = updatedBrand.baseUrl;
    }

    if (
      Object.prototype.hasOwnProperty.call(brandUpdates, "imgUrl") ||
      Object.prototype.hasOwnProperty.call(brandUpdates, "logoUrl")
    ) {
      dealUpdates.brandLogoUrl = this.getBrandLogo(updatedBrand);
    }

    if (Object.keys(dealUpdates).length > 0) {
      await DealModel.updateMany(
        { brandId: updatedBrand._id },
        { $set: dealUpdates }
      );
    }

    return updatedBrand;
  }

  async upsertDealForBrand(
    brandIdentifier: string,
    dealInput: BrandDealUpsertInput
  ): Promise<DealDocument | null> {
    const brand = await this.resolveBrand(brandIdentifier);

    if (!brand) {
      return null;
    }

    const externalId = dealInput.externalId.trim();
    const title = dealInput.title.trim();

    if (!externalId || !title || typeof dealInput.price !== "number" || Number.isNaN(dealInput.price)) {
      throw new Error("externalId, title and price are required to upsert a deal.");
    }

    const now = new Date();
    const startTime = this.normalizeDate(dealInput.startTime);
    const endTime = this.normalizeDate(dealInput.endTime);

    const isExpired = endTime ? endTime <= now : false;
    const isActive = isExpired
      ? false
      : typeof dealInput.isActive === "boolean"
        ? dealInput.isActive
        : startTime
          ? startTime <= now
          : true;

    return DealModel.findOneAndUpdate(
      { brandId: brand._id, externalId },
      {
        $setOnInsert: {
          dealId: uuidv4(),
        },
        $set: {
          brandId: brand._id,
          brandSlug: brand.slug,
          externalId,
          title,
          description: dealInput.description ?? "",
          price: dealInput.price,
          originalPrice: dealInput.originalPrice,
          currency: dealInput.currency ?? "PKR",
          discountPercent: dealInput.discountPercent,
          minPersons: dealInput.minPersons,
          maxPersons: dealInput.maxPersons,
          cuisineTags: this.normalizeStringArray(dealInput.cuisineTags),
          mealType: this.normalizeStringArray(dealInput.mealType),
          conditions: dealInput.conditions,
          startTime,
          endTime,
          isExpired,
          isActive,
          isHot: dealInput.isHot ?? false,
          imgUrl: dealInput.imgUrl ?? "",
          scrapedAt: now,
          baseUrl: brand.baseUrl,
          brandLogoUrl: this.getBrandLogo(brand),
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );
  }

  async deleteDealForBrand(brandIdentifier: string, dealIdentifier: string): Promise<DealDocument | null> {
    const brand = await this.resolveBrand(brandIdentifier);

    if (!brand) {
      return null;
    }

    const normalizedDealIdentifier = dealIdentifier.trim();

    if (!normalizedDealIdentifier.length) {
      throw new Error("dealId is required.");
    }

    return DealModel.findOneAndUpdate(
      {
        brandId: brand._id,
        $or: [
          { dealId: normalizedDealIdentifier },
          { externalId: normalizedDealIdentifier },
        ],
      },
      {
        $set: {
          isActive: false,
          isHot: false,
        },
      },
      { new: true }
    );
  }

async syncDealsForBrand(brandId: string, deals: DealDocument[], brandInfo: { brand: string; slug: string; url: string }): Promise<void> {
  console.log(
    `[DealSync] Started | brandId=${brandId} | incomingDeals=${deals?.length ?? 0}`
  );

  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throw new Error(`Invalid brandId: ${brandId}`);
  }

  const brandObjectId = new mongoose.Types.ObjectId(brandId);
  const now = new Date();

  console.log(
    `[DealSync] Target | db=${DealModel.db.name} | collection=${DealModel.collection.name}`
  );

  const validDeals = new Map<string, DealDocument>();
  let skippedCount = 0;

  for (const [index, raw] of deals.entries()) {
    if (!raw) {
      console.log(`[DealSync] Skip null payload | idx=${index + 1}`);
      skippedCount += 1;
      continue;
    }

    const externalId = String((raw as any).externalId ?? "").trim();

    if (!externalId) {
      console.log(`[DealSync] Skip: missing externalId | idx=${index + 1}`);
      skippedCount += 1;
      continue;
    }

    if (!raw.title || raw.price == null) {
      console.log(`[DealSync] Skip invalid deal | externalId=${externalId}`);
      skippedCount += 1;
      continue;
    }

    const endTime = raw.endTime ? new Date(raw.endTime) : null;
    if (endTime && isNaN(endTime.getTime())) {
      console.log(`[DealSync] Skip invalid endTime | externalId=${externalId}`);
      skippedCount += 1;
      continue;
    }

    validDeals.set(externalId, raw);
  }

  const incomingExternalIds = [...validDeals.keys()];
  console.log(
    `[DealSync] Prepared | valid=${incomingExternalIds.length} | skipped=${skippedCount}`
  );

  const bulkOps = incomingExternalIds.map((externalId) => {
    const raw = validDeals.get(externalId)!;
    const endTime = raw.endTime ? new Date(raw.endTime) : null;
    const startTime = raw.startTime ? new Date(raw.startTime) : null;

    let isExpired = endTime ? endTime <= now : false;
    let isActive = startTime ? startTime <= now : true;
    if (isExpired) isActive = false;

    return {
      updateOne: {
        filter: { brandId: brandObjectId, externalId },
        update: {
          $setOnInsert: {
            dealId: uuidv4(),
          },
          $set: {
            brandId: brandObjectId,
            externalId,
            brandSlug: raw.brandSlug ??  "unknown-brand",
            title: raw.title,
            description: raw.description ?? "",
            price: raw.price,
            originalPrice: raw.originalPrice ?? undefined,
            currency: raw.currency ?? "PKR",
            discountPercent: raw.discountPercent ?? undefined,
            minPersons: raw.minPersons ?? undefined,
            maxPersons: raw.maxPersons ?? undefined,
            cuisineTags: Array.isArray(raw.cuisineTags) ? raw.cuisineTags : [],
            mealType: Array.isArray(raw.mealType) ? raw.mealType : [],
            conditions: raw.conditions ?? undefined,
            startTime: startTime ?? undefined,
            endTime: endTime ?? undefined,
            isExpired,
            isActive,
            imgUrl: raw.imgUrl ?? "",
            scrapedAt: now,
            baseUrl: brandInfo.url ?? "",
          },
        },
        upsert: true,
      },
    };
  });

  if (bulkOps.length > 0) {
    let upsertedIds: string[] = [];

  try {
    const bulkResult = await DealModel.bulkWrite(bulkOps, { ordered: false });
    console.log(
      `[DealSync] Bulk result | matched=${bulkResult.matchedCount} | modified=${bulkResult.modifiedCount} | upserted=${bulkResult.upsertedCount}`
    );

    // Collect only newly inserted _ids
    if (bulkResult.upsertedIds && Object.keys(bulkResult.upsertedIds).length > 0) {
      upsertedIds = Object.values(bulkResult.upsertedIds).map((id) => id.toString());
      console.log(`[DealSync] Collected upsertedIds | count=${upsertedIds.length}`);
    }
  } catch (error) {
    const mongoError = error as {
      message?: string;
      code?: number;
      writeErrors?: Array<{ code?: number; errmsg?: string }>;
    };

    console.error(
      `[DealSync] Bulk upsert failed | code=${mongoError.code ?? "n/a"} | message=${mongoError.message ?? "unknown"}`
    );

    const writeErrors = mongoError.writeErrors ?? [];
    const onlyDuplicateErrors =
      writeErrors.length > 0 && writeErrors.every((entry) => entry.code === 11000);

    if (!onlyDuplicateErrors) {
      throw error;
    }

    console.warn(
      `[DealSync] Bulk had duplicate-key races | retrying as update-only ops=${writeErrors.length}`
    );

    // Retry without upsert (update-only)
    try {
      await DealModel.bulkWrite(
        bulkOps.map((op) => ({
          updateOne: {
            filter: op.updateOne.filter,
            update: op.updateOne.update,
            upsert: false,
          },
        })),
        { ordered: false }
      );
      console.log(`[DealSync] Retry completed successfully`);
    } catch (retryError) {
      console.error(`[DealSync] Retry failed | error=${(retryError as Error).message}`);
      throw retryError;
    }
  }

  let newlyInsertedDeals: DealDocument[] = [];

  // Only publish newly upserted deals
  if (upsertedIds.length > 0) {
    try {
      newlyInsertedDeals = await DealModel.find({ _id: { $in: upsertedIds } });
      console.log(`[DealSync] Found ${newlyInsertedDeals.length} deals to publish`);

      let publishedCount = 0;
      let failedCount = 0;

      for (const deal of newlyInsertedDeals) {
        try {
          if (!deal.dealId) {
            console.warn(`[DealSync] Skipping publish: deal missing dealId | _id=${deal._id}`);
            failedCount += 1;
            continue;
          }

          await publishDealCreated(deal.dealId, deal, brandId);
          publishedCount += 1;
        } catch (pubErr) {
          const errMsg = (pubErr as Error).message ?? "unknown error";
          console.error(`[DealSync] Failed to publish deal | dealId=${deal.dealId} | error=${errMsg}`);
          failedCount += 1;
        }
      }

      console.log(
        `[DealSync] Publishing summary | total=${newlyInsertedDeals.length} | published=${publishedCount} | failed=${failedCount}`
      );

      if (failedCount > 0) {
        console.warn(
          `[DealSync] ${failedCount} deals failed to publish | brandId=${brandId}`
        );
      }
    } catch (fetchError) {
      const errMsg = (fetchError as Error).message ?? "unknown error";
      console.error(`[DealSync] Failed to fetch upserted deals | error=${errMsg}`);
      throw fetchError;
    }
  } else {
    console.log(`[DealSync] No new deals to publish | brandId=${brandId}`);
  }

  if (newlyInsertedDeals.length > 0) {
    console.log(`[DealSync] Starting metadata enrichment | total=${newlyInsertedDeals.length}`);

    let enrichedCount = 0;
    let enrichmentFailedCount = 0;

    const enrichmentResults = await metadataEnrichmentService.enrichDealsMetadata(newlyInsertedDeals, brandId);
    const resultByDealId = new Map(enrichmentResults.map((entry) => [entry.dealId, entry.metadata]));

    const bulkUpdates: Array<{
      updateOne: {
        filter: { _id: mongoose.Types.ObjectId };
        update: {
          $set: {
            metadata: Record<string, unknown>;
            metadataEnrichedAt: Date;
            metadataSource: string;
          };
        };
      };
    }> = [];

    for (const deal of newlyInsertedDeals) {
      const metadata = resultByDealId.get(deal.dealId);
      if (!metadata) {
        enrichmentFailedCount += 1;
        continue;
      }

      enrichedCount += 1;
      bulkUpdates.push({
        updateOne: {
          filter: { _id: deal._id as mongoose.Types.ObjectId },
          update: {
            $set: {
              metadata,
              metadataEnrichedAt: new Date(),
              metadataSource: "groq",
            },
          },
        },
      });
    }

    if (bulkUpdates.length > 0) {
      await DealModel.bulkWrite(bulkUpdates, { ordered: false });
    }

    console.log(
      `[DealSync] Metadata enrichment summary | total=${newlyInsertedDeals.length} | enriched=${enrichedCount} | failed=${enrichmentFailedCount}`
    );
  }
}

  console.log(
    `[DealSync] Deactivate missing | validIncomingExternalIds=${incomingExternalIds.length}`
  );

  const deactivateResult = await DealModel.updateMany(
    {
      brandId: brandObjectId,
      externalId: { $nin: incomingExternalIds },
    },
    {
      $set: { isActive: false },
    }
  );

  const persistedCount = await DealModel.countDocuments({ brandId: brandObjectId });

  console.log(
    `[DealSync] Deactivate result | matched=${deactivateResult.matchedCount} | modified=${deactivateResult.modifiedCount}`
  );
  console.log(
    `[DealSync] Summary | attempted=${deals.length} | valid=${incomingExternalIds.length} | skipped=${skippedCount} | persistedCount=${persistedCount}`
  );

  console.log(`[DealSync] DONE | brandId=${brandId}`);

  
}




  async getActiveDealsForBrand(brandId: string): Promise<DealDocument[]> {
    return await DealModel.find({ brandId: brandId, isActive: true });
  }

  async getDealById(dealId: string): Promise<DealDocument | null> {
    return await DealModel.findOne({ dealId: dealId });
  }

  async getDealsByIds(
    requestedDeals: string[] | Array<{ dealId: string; brandSlug?: string }>
  ): Promise<DealDocument[]> {
    const normalizedDeals = requestedDeals
      .map((deal) =>
        typeof deal === "string"
          ? { dealId: deal.trim(), brandSlug: undefined }
          : {
              dealId: String(deal.dealId ?? "").trim(),
              brandSlug: deal.brandSlug ? String(deal.brandSlug).trim() : undefined,
            }
      )
      .filter((deal) => deal.dealId.length > 0);

    if (!normalizedDeals.length) {
      return [];
    }

    const dealIds = [...new Set(normalizedDeals.map((deal) => deal.dealId))];
    const externalIdConditions = normalizedDeals
      .filter((deal) => deal.brandSlug)
      .map((deal) => ({
        externalId: deal.dealId,
        brandSlug: deal.brandSlug,
      }));

    const foundDeals = await DealModel.find({
      $or: [
        { dealId: { $in: dealIds } },
        ...externalIdConditions,
      ],
    });

    const dealsByDealId = new Map(foundDeals.map((deal) => [deal.dealId, deal]));
    const dealsByExternalKey = new Map(
      foundDeals.map((deal) => [`${deal.externalId}:${deal.brandSlug}`, deal])
    );

    const orderedDeals: DealDocument[] = [];
    const addedIds = new Set<string>();

    for (const deal of normalizedDeals) {
      const foundDeal =
        dealsByDealId.get(deal.dealId) ??
        (deal.brandSlug ? dealsByExternalKey.get(`${deal.dealId}:${deal.brandSlug}`) : undefined);

      if (foundDeal && !addedIds.has(foundDeal.dealId)) {
        orderedDeals.push(foundDeal);
        addedIds.add(foundDeal.dealId);
      }
    }

    return orderedDeals;
  }
  async getDeals(filters: DealFilters): Promise<DealsListResult> {
    const mongoFilter: Record<string, unknown> = {};

    const requestedBrands = new Set<string>();

    if (typeof filters.brand === "string" && filters.brand.trim().length > 0) {
      requestedBrands.add(filters.brand.trim());
    }

    if (Array.isArray(filters.brands)) {
      for (const brand of filters.brands) {
        if (typeof brand === "string" && brand.trim().length > 0) {
          requestedBrands.add(brand.trim());
        }
      }
    }

    if (requestedBrands.size > 0) {
      const requestedBrandsRegex = [...requestedBrands].map((brand) => {
        const escapedBrand = this.escapeRegex(brand);
        return new RegExp(`^${escapedBrand}$`, "i");
      });

      const matchingBrands = await BrandModel.find({
        $or: [
          { slug: { $in: requestedBrandsRegex } },
          { name: { $in: requestedBrandsRegex } }
        ]
      }).select("_id");

      if (matchingBrands.length === 0) {
        const page = Math.max(1, filters.page ?? 1);
        const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

        return {
          items: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: page > 1,
          },
        };
      }

      mongoFilter.brandId = {
        $in: matchingBrands.map((brand: { _id: mongoose.Types.ObjectId }) => brand._id),
      };
    }

    if (typeof filters.isActive === "boolean") {
      mongoFilter.isActive = filters.isActive;
    }

    if (typeof filters.isHot === "boolean") {
      mongoFilter.isHot = filters.isHot;
    }

    if (typeof filters.isExpired === "boolean") {
      mongoFilter.isExpired = filters.isExpired;
    }

    if (typeof filters.minPrice === "number" || typeof filters.maxPrice === "number") {
      const priceRange: Record<string, number> = {};

      if (typeof filters.minPrice === "number") {
        priceRange.$gte = filters.minPrice;
      }

      if (typeof filters.maxPrice === "number") {
        priceRange.$lte = filters.maxPrice;
      }

      mongoFilter.price = priceRange;
    }

    if (typeof filters.minDiscount === "number" || typeof filters.maxDiscount === "number") {
      const discountRange: Record<string, number> = {};

      if (typeof filters.minDiscount === "number") {
        discountRange.$gte = filters.minDiscount;
      }

      if (typeof filters.maxDiscount === "number") {
        discountRange.$lte = filters.maxDiscount;
      }

      mongoFilter.discountPercent = discountRange;
    }

    if (typeof filters.minPersons === "number" || typeof filters.maxPersons === "number") {
      const personsRange: Record<string, number> = {};

      if (typeof filters.minPersons === "number") {
        personsRange.$gte = filters.minPersons;
      }

      if (typeof filters.maxPersons === "number") {
        personsRange.$lte = filters.maxPersons;
      }

      mongoFilter.maxPersons = personsRange;
    }

    if (filters.startAfter instanceof Date) {
      mongoFilter.startTime = {
        ...(typeof mongoFilter.startTime === "object" && mongoFilter.startTime !== null
          ? (mongoFilter.startTime as Record<string, Date>)
          : {}),
        $gte: filters.startAfter,
      };
    }

    if (filters.endBefore instanceof Date) {
      mongoFilter.endTime = {
        ...(typeof mongoFilter.endTime === "object" && mongoFilter.endTime !== null
          ? (mongoFilter.endTime as Record<string, Date>)
          : {}),
        $lte: filters.endBefore,
      };
    }

    if (Array.isArray(filters.cuisineTags) && filters.cuisineTags.length > 0) {
      const cuisineRegexes = filters.cuisineTags
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .map((tag) => new RegExp(`^${this.escapeRegex(tag)}$`, "i"));

      if (cuisineRegexes.length > 0) {
        mongoFilter.cuisineTags = { $in: cuisineRegexes };
      }
    }

    if (Array.isArray(filters.mealTypes) && filters.mealTypes.length > 0) {
      const mealTypeRegexes = filters.mealTypes
        .map((mealType) => mealType.trim())
        .filter((mealType) => mealType.length > 0)
        .map((mealType) => new RegExp(`^${this.escapeRegex(mealType)}$`, "i"));

      if (mealTypeRegexes.length > 0) {
        mongoFilter.mealType = { $in: mealTypeRegexes };
      }
    }

    if (typeof filters.query === "string" && filters.query.trim().length > 0) {
      const regex = new RegExp(this.escapeRegex(filters.query.trim()), "i");

      mongoFilter.$or = [
        { title: regex },
        { description: regex },
        { cuisineTags: { $in: [regex] } },
        { mealType: { $in: [regex] } },
        { brandSlug: regex }
      ];
    }

    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const skip = (page - 1) * limit;

    const sortBy = filters.sortBy ?? "createdAt";
    const sortOrder = filters.sortOrder === "asc" ? 1 : -1;

    const [items, total] = await Promise.all([
      DealModel.find(mongoFilter)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit),
      DealModel.countDocuments(mongoFilter),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: totalPages > 0 && page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  async getFilterBrands(): Promise<Array<{ name: string; slug: string }>> {
    const brands = await BrandModel.find({ isActive: true })
      .select({ _id: 0, name: 1, slug: 1, imgUrl: 1, baseUrl: 1 })
      .sort({ name: 1 })
      .lean();

    return brands.map((b) => ({
      name: b.name,
      slug: b.slug,
      imgUrl: b.imgUrl,
      baseUrl: b.baseUrl,
    }));
  }

  async getFilterCuisineTags(): Promise<string[]> {
    const tags = await DealModel.distinct("cuisineTags", { isActive: true });
    return this.toSortedUniqueStrings(tags);
  }

  async getFilterMealTypes(): Promise<string[]> {
    const mealTypes = await DealModel.distinct("mealType", { isActive: true });
    return this.toSortedUniqueStrings(mealTypes);
  }


  async getFilterPriceRange(): Promise<{ min: number; max: number }> {
    const priceStats = await DealModel.aggregate<{ min?: number; max?: number }>([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          min: { $min: "$price" },
          max: { $max: "$price" },
        },
      },
      { $project: { _id: 0, min: 1, max: 1 } },
    ]);

    const min = priceStats[0]?.min ?? 0;
    const max = priceStats[0]?.max ?? 0;

    return { min, max };
  }

  async getFilterOptions(): Promise<DealFilterOptions> {
    const [brands, cuisineTags, mealTypes, currencies, priceRange, discountStats, personsStats] = await Promise.all([
      this.getFilterBrands(),
      this.getFilterCuisineTags(),
      this.getFilterMealTypes(),
      DealModel.distinct("currency", { isActive: true }),
      this.getFilterPriceRange(),
      DealModel.aggregate<{ min?: number; max?: number }>([
        { $match: { isActive: true, discountPercent: { $ne: null } } },
        {
          $group: {
            _id: null,
            min: { $min: "$discountPercent" },
            max: { $max: "$discountPercent" },
          },
        },
        { $project: { _id: 0, min: 1, max: 1 } },
      ]),
      DealModel.aggregate<{ min?: number; max?: number }>([
        { $match: { isActive: true, maxPersons: { $ne: null } } },
        {
          $group: {
            _id: null,
            min: { $min: "$minPersons" },
            max: { $max: "$maxPersons" },
          },
        },
        { $project: { _id: 0, min: 1, max: 1 } },
      ]),
    ]);

    return {
      brands,
      cuisineTags,
      mealTypes,
      currencies: this.toSortedUniqueStrings(currencies),
      priceRange,
      discountRange: {
        min: discountStats[0]?.min ?? 0,
        max: discountStats[0]?.max ?? 0,
      },
      personsRange: {
        min: personsStats[0]?.min ?? 0,
        max: personsStats[0]?.max ?? 0,
      },
    };
  }

  // async incrementDealViews(dealId: string): Promise<void> {
  //   await DealModel.findOneAndUpdate({ dealId: dealId }, { $inc: { viewsCount: 1 } });
  // }

  // async markHotDeals(): Promise<void> {
  //   // Example criteria: Mark deals as hot if they have more than 100 views and a discount percent greater than 20%
  //   await DealModel.updateMany(
  //     { viewsCount: { $gt: 100 }, discountPercent: { $gt: 20 } },
  //     { $set: { isHot: true } }
  //   );
  // }
}
