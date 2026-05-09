import type { NextFunction, Request, Response } from "express";
import { DealFilters } from "../repositories/deal.repository.js";
import { dealsService } from "../services/deals.service.js";

const parseNumberQuery = (value: unknown): number | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const parseBooleanQuery = (value: unknown): boolean | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return undefined;
};

const parseDateQuery = (value: unknown): Date | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(Number.NaN) : parsed;
};

const parseStringListQuery = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => `${entry}`.split(","))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
};

const parseDealsFilters = (req: Request): DealFilters | { error: string } => {
  const minPrice = parseNumberQuery(req.query.minPrice);
  const maxPrice = parseNumberQuery(req.query.maxPrice);
  const minDiscount = parseNumberQuery(req.query.minDiscount);
  const maxDiscount = parseNumberQuery(req.query.maxDiscount);
  const minPersons = parseNumberQuery(req.query.minPersons);
  const maxPersons = parseNumberQuery(req.query.maxPersons);
  const page = parseNumberQuery(req.query.page);
  const limit = parseNumberQuery(req.query.limit);
  const startAfter = parseDateQuery(req.query.startAfter);
  const endBefore = parseDateQuery(req.query.endBefore);

  if (
    Number.isNaN(minPrice) ||
    Number.isNaN(maxPrice) ||
    Number.isNaN(minDiscount) ||
    Number.isNaN(maxDiscount) ||
    Number.isNaN(minPersons) ||
    Number.isNaN(maxPersons) ||
    Number.isNaN(page) ||
    Number.isNaN(limit)
  ) {
    return { error: "Numeric filters are invalid. Use numeric values for price, discount, persons, page and limit." };
  }

  if (startAfter instanceof Date && Number.isNaN(startAfter.getTime())) {
    return { error: "Invalid startAfter date. Use ISO-8601 format." };
  }

  if (endBefore instanceof Date && Number.isNaN(endBefore.getTime())) {
    return { error: "Invalid endBefore date. Use ISO-8601 format." };
  }

  if (typeof minPrice === "number" && typeof maxPrice === "number" && minPrice > maxPrice) {
    return { error: "minPrice cannot be greater than maxPrice." };
  }

  if (typeof minDiscount === "number" && typeof maxDiscount === "number" && minDiscount > maxDiscount) {
    return { error: "minDiscount cannot be greater than maxDiscount." };
  }

  if (typeof minPersons === "number" && typeof maxPersons === "number" && minPersons > maxPersons) {
    return { error: "minPersons cannot be greater than maxPersons." };
  }

  if (typeof page === "number" && page < 1) {
    return { error: "page must be greater than or equal to 1." };
  }

  if (typeof limit === "number" && limit < 1) {
    return { error: "limit must be greater than or equal to 1." };
  }

  const sortBy =
    typeof req.query.sortBy === "string" &&
      ["createdAt", "price", "discountPercent", "viewsCount", "endTime"].includes(req.query.sortBy)
      ? (req.query.sortBy as DealFilters["sortBy"])
      : undefined;

  const sortOrder =
    typeof req.query.sortOrder === "string" && ["asc", "desc"].includes(req.query.sortOrder)
      ? (req.query.sortOrder as DealFilters["sortOrder"])
      : undefined;

  return {
    minPrice,
    maxPrice,
    minDiscount,
    maxDiscount,
    minPersons,
    maxPersons,
    page: typeof page === "number" ? page : undefined,
    limit: typeof limit === "number" ? limit : undefined,
    startAfter,
    endBefore,
    sortBy,
    sortOrder,
    query: typeof req.query.query === "string" ? req.query.query : undefined,
    brand: typeof req.query.brand === "string" ? req.query.brand : undefined,
    brands: parseStringListQuery(req.query.brands),
    cuisineTags: parseStringListQuery(req.query.cuisineTags),
    mealTypes: parseStringListQuery(req.query.mealTypes),
    isHot: parseBooleanQuery(req.query.isHot),
    isActive: parseBooleanQuery(req.query.isActive),
    isExpired: parseBooleanQuery(req.query.isExpired),
  };
};

export const getDeals = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filtersOrError = parseDealsFilters(req);

    if ("error" in filtersOrError) {
      return res.status(400).json({
        success: false,
        message: filtersOrError.error,
      });
    }

    const deals = await dealsService.getDeals(filtersOrError);

    return res.status(200).json({
      success: true,
      message: "Deals fetched successfully.",
      data: deals.items,
      pagination: deals.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const getDealById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dealId = typeof req.params.dealId === "string" ? req.params.dealId.trim() : undefined;

    if (!dealId) {
      return res.status(400).json({
        success: false,
        message: "dealId is required.",
      });
    }

    const deal = await dealsService.getDealById(dealId);

    if (!deal) {
      return res.status(404).json({
        success: false,
        message: "Deal not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Deal fetched successfully.",
      data: deal,
    });
  } catch (error) {
    next(error);
  }
};

export const getDealsByIds = async (req: Request, res: Response, next: NextFunction) => {

  try {
    const dealsParam = req.query.deals;
    const ids = parseStringListQuery(req.query.ids);
    let deals: string[] | Array<{ dealId: string; brandSlug?: string }> = ids;

    if (typeof dealsParam === "string") {
      try {
        const parsed = JSON.parse(dealsParam);
        deals = Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        console.error("[Deals] Failed to parse deals parameter:", error);
        return res.status(400).json({
          success: false,
          message: "Invalid deals parameter format. Expected JSON array of objects with dealId and brandSlug.",
        });
      }
    }

    if (!deals.length) {
      return res.status(400).json({
        success: false,
        message: "ids or deals query parameter is required.",
      });
    }

    console.log("[Deals] Fetching deals with criteria:", deals);

    const fetchedDeals = await dealsService.getDealsByIds(deals);

    console.log("[Deals] Returned deals count:", fetchedDeals.length);

    return res.status(200).json({
      success: true,
      message: "Deals fetched successfully.",
      data: fetchedDeals,
    });
  } catch (error) {
    next(error);
  }
};

export const getFilterOptions = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const options = await dealsService.getFilterOptions();

    return res.status(200).json({
      success: true,
      message: "Filter options fetched successfully.",
      data: options,
    });
  } catch (error) {
    next(error);
  }
};

export const getFilterBrands = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const brands = await dealsService.getFilterBrands();

    return res.status(200).json({
      success: true,
      message: "Filter brands fetched successfully.",
      data: brands,
    });
  } catch (error) {
    next(error);
  }
};

export const getFilterCuisineTags = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cuisineTags = await dealsService.getFilterCuisineTags();

    return res.status(200).json({
      success: true,
      message: "Filter cuisine tags fetched successfully.",
      data: cuisineTags,
    });
  } catch (error) {
    next(error);
  }
};

export const getFilterMealTypes = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const mealTypes = await dealsService.getFilterMealTypes();

    return res.status(200).json({
      success: true,
      message: "Filter meal types fetched successfully.",
      data: mealTypes,
    });
  } catch (error) {
    next(error);
  }
};

export const getFilterPriceRange = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const priceRange = await dealsService.getFilterPriceRange();

    return res.status(200).json({
      success: true,
      message: "Filter price range fetched successfully.",
      data: priceRange,
    });
  } catch (error) {
    next(error);
  }
};


