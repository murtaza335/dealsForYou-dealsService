import type { NextFunction, Request, Response } from "express";
import { dealsService } from "../services/deals.service.js";
import type { BrandDealUpsertInput, UpdateBrandInput } from "../repositories/deal.repository.js";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  return undefined;
};

const toStringArray = (value: unknown): string[] | undefined => {
  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    return items.length > 0 ? items : [];
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .flatMap((entry) => `${entry}`.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return items.length > 0 ? items : [];
};

const parseUpdateBrandInput = (body: unknown): UpdateBrandInput | { error: string } => {
  if (!isRecord(body)) {
    return { error: "Request body must be a JSON object." };
  }

  const updates: UpdateBrandInput = {};

  if (typeof body.name === "string" && body.name.trim().length > 0) updates.name = body.name.trim();
  if (typeof body.slug === "string" && body.slug.trim().length > 0) updates.slug = body.slug.trim();
  if (typeof body.baseUrl === "string" && body.baseUrl.trim().length > 0) updates.baseUrl = body.baseUrl.trim();
  if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
  if (typeof body.tagline === "string") updates.tagline = body.tagline.trim();
  if (typeof body.description === "string") updates.description = body.description.trim();
  if (typeof body.imgUrl === "string") updates.imgUrl = body.imgUrl.trim();
  if (typeof body.logoUrl === "string") updates.logoUrl = body.logoUrl.trim();
  if (typeof body.website === "string") updates.website = body.website.trim();
  if (typeof body.country === "string") updates.country = body.country.trim();

  const cities = toStringArray(body.cities);
  if (cities !== undefined) updates.cities = cities;

  const areas = toStringArray(body.areas);
  if (areas !== undefined) updates.areas = areas;

  if (body.locations !== undefined) {
    if (!Array.isArray(body.locations)) {
      return { error: "locations must be an array of { lat, lng } objects." };
    }

    const locations = body.locations
      .map((location) => {
        if (!isRecord(location)) {
          return null;
        }

        const lat = toNumber(location.lat);
        const lng = toNumber(location.lng);

        if (typeof lat !== "number" || Number.isNaN(lat) || typeof lng !== "number" || Number.isNaN(lng)) {
          return null;
        }

        return { lat, lng };
      })
      .filter((location): location is { lat: number; lng: number } => location !== null);

    if (locations.length !== body.locations.length) {
      return { error: "Each location must include numeric lat and lng values." };
    }

    updates.locations = locations;
  }

  if (Object.keys(updates).length === 0) {
    return { error: "At least one brand field must be provided to update." };
  }

  return updates;
};

const parseDealPayload = (body: unknown): BrandDealUpsertInput | { error: string } => {
  if (!isRecord(body)) {
    return { error: "Each deal must be a JSON object." };
  }

  const externalId = typeof body.externalId === "string" ? body.externalId.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const price = toNumber(body.price);

  if (!externalId) {
    return { error: "externalId is required for each deal." };
  }

  if (!title) {
    return { error: "title is required for each deal." };
  }

  if (typeof price !== "number" || Number.isNaN(price)) {
    return { error: "price must be a valid number for each deal." };
  }

  const input: BrandDealUpsertInput = {
    externalId,
    title,
    price,
  };

  if (typeof body.description === "string") input.description = body.description.trim();

  const originalPrice = toNumber(body.originalPrice);
  if (typeof originalPrice === "number" && !Number.isNaN(originalPrice)) input.originalPrice = originalPrice;

  if (typeof body.currency === "string" && body.currency.trim().length > 0) input.currency = body.currency.trim();

  const discountPercent = toNumber(body.discountPercent);
  if (typeof discountPercent === "number" && !Number.isNaN(discountPercent)) input.discountPercent = discountPercent;

  const minPersons = toNumber(body.minPersons);
  if (typeof minPersons === "number" && !Number.isNaN(minPersons)) input.minPersons = minPersons;

  const maxPersons = toNumber(body.maxPersons);
  if (typeof maxPersons === "number" && !Number.isNaN(maxPersons)) input.maxPersons = maxPersons;

  const cuisineTags = toStringArray(body.cuisineTags);
  if (cuisineTags !== undefined) input.cuisineTags = cuisineTags;

  const mealType = toStringArray(body.mealType);
  if (mealType !== undefined) input.mealType = mealType;

  if (typeof body.conditions === "string") input.conditions = body.conditions.trim();
  if (typeof body.startTime === "string" || body.startTime instanceof Date) input.startTime = body.startTime;
  if (typeof body.endTime === "string" || body.endTime instanceof Date) input.endTime = body.endTime;
  if (typeof body.imgUrl === "string") input.imgUrl = body.imgUrl.trim();
  if (typeof body.isHot === "boolean") input.isHot = body.isHot;
  if (typeof body.isActive === "boolean") input.isActive = body.isActive;

  return input;
};

const getDealsPayloads = (body: unknown): unknown[] => {
  if (Array.isArray(body)) {
    return body;
  }

  if (isRecord(body) && Array.isArray(body.deals)) {
    return body.deals;
  }

  if (isRecord(body) && isRecord(body.deal)) {
    return [body.deal];
  }

  return [body];
};

export const updateBrand = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const brandId = typeof req.params.brandId === "string" ? req.params.brandId.trim() : "";

    if (!brandId) {
      return res.status(400).json({
        success: false,
        message: "brandId is required.",
      });
    }

    const parsed = parseUpdateBrandInput(req.body);

    if ("error" in parsed) {
      return res.status(400).json({
        success: false,
        message: parsed.error,
      });
    }

    const brand = await dealsService.updateBrand(brandId, parsed);

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: "Brand not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Brand updated successfully.",
      data: brand,
    });
  } catch (error) {
    next(error);
  }
};

export const upsertBrandDeals = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const brandId = typeof req.params.brandId === "string" ? req.params.brandId.trim() : "";

    if (!brandId) {
      return res.status(400).json({
        success: false,
        message: "brandId is required.",
      });
    }

    const payloads = getDealsPayloads(req.body);

    if (!payloads.length) {
      return res.status(400).json({
        success: false,
        message: "At least one deal is required.",
      });
    }

    const parsedDeals: BrandDealUpsertInput[] = [];

    for (const payload of payloads) {
      const parsed = parseDealPayload(payload);

      if ("error" in parsed) {
        return res.status(400).json({
          success: false,
          message: parsed.error,
        });
      }

      parsedDeals.push(parsed);
    }

    const savedDeals = [] as Array<NonNullable<Awaited<ReturnType<typeof dealsService.upsertDealForBrand>>>>;

    for (const dealInput of parsedDeals) {
      const savedDeal = await dealsService.upsertDealForBrand(brandId, dealInput);

      if (!savedDeal) {
        return res.status(404).json({
          success: false,
          message: "Brand not found.",
        });
      }

      savedDeals.push(savedDeal);
    }

    return res.status(200).json({
      success: true,
      message: savedDeals.length === 1 ? "Deal saved successfully." : "Deals saved successfully.",
      data: savedDeals.length === 1 ? savedDeals[0] : savedDeals,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteBrandDeal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const brandId = typeof req.params.brandId === "string" ? req.params.brandId.trim() : "";
    const dealId = typeof req.params.dealId === "string" ? req.params.dealId.trim() : "";

    if (!brandId) {
      return res.status(400).json({
        success: false,
        message: "brandId is required.",
      });
    }

    if (!dealId) {
      return res.status(400).json({
        success: false,
        message: "dealId is required.",
      });
    }

    const deletedDeal = await dealsService.deleteDealForBrand(brandId, dealId);

    if (!deletedDeal) {
      return res.status(404).json({
        success: false,
        message: "Deal not found for this brand.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Deal deleted successfully.",
      data: deletedDeal,
    });
  } catch (error) {
    next(error);
  }
};
