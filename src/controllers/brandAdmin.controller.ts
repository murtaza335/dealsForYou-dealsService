import type { NextFunction, Request, Response } from "express";
import { brandAdminService } from "../services/brandAdmin.service.js";

const parseStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String).map((entry) => entry.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return [];
};

const parseNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const isScraperDealUpsertPayload = (body: unknown): boolean => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const payload = body as Record<string, unknown>;

  if (typeof payload.externalId === "string" && payload.externalId.trim()) return true;
  if (Array.isArray(payload.deals)) return true;
  if (payload.deal && typeof payload.deal === "object") {
    const deal = payload.deal as Record<string, unknown>;
    return typeof deal.externalId === "string" && deal.externalId.trim().length > 0;
  }

  return false;
};

export const createBrand = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {};
    const scrapeRequested = Boolean(body.scrapeRequested);

    if (!body.name || !body.contactEmail || !body.contactPhone || !body.country || !body.description) {
      return res.status(400).json({ success: false, message: "Missing required brand fields." });
    }

    const cities = parseStringList(body.cities);
    if (cities.length === 0) {
      return res.status(400).json({ success: false, message: "At least one city is required." });
    }

    if (scrapeRequested && !body.website) {
      return res.status(400).json({ success: false, message: "Website URL is required when scraper is requested." });
    }

    const brand = await brandAdminService.createPendingBrand({
      name: String(body.name),
      tagline: body.tagline ? String(body.tagline) : undefined,
      description: String(body.description),
      logoUrl: body.logoUrl ? String(body.logoUrl) : undefined,
      website: body.website ? String(body.website) : undefined,
      contactEmail: String(body.contactEmail),
      contactPhone: String(body.contactPhone),
      country: String(body.country),
      cities,
      areas: parseStringList(body.areas),
      cuisineTags: parseStringList(body.cuisineTags),
      socials: typeof body.socials === "object" && body.socials ? body.socials : {},
      notes: body.notes ? String(body.notes) : undefined,
      scrapeRequested,
    });

    return res.status(201).json({ success: true, data: brand });
  } catch (error) {
    next(error);
  }
};

export const getBrandByPublicId = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const brand = await brandAdminService.getBrandByPublicId(String(req.params.brandId));
    if (!brand) return res.status(404).json({ success: false, message: "Brand not found." });
    return res.status(200).json({ success: true, data: brand });
  } catch (error) {
    next(error);
  }
};

export const listBrands = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const brands = await brandAdminService.listBrands();
    return res.status(200).json({ success: true, data: brands });
  } catch (error) {
    next(error);
  }
};

export const listPendingBrands = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const brands = await brandAdminService.listPendingBrands();
    return res.status(200).json({ success: true, data: brands });
  } catch (error) {
    next(error);
  }
};

export const suspendBrand = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const brand = await brandAdminService.suspendBrand(String(req.params.brandId));
    if (!brand) return res.status(404).json({ success: false, message: "Brand not found." });
    return res.status(200).json({ success: true, data: brand });
  } catch (error) {
    next(error);
  }
};

export const deleteBrand = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const brand = await brandAdminService.deleteBrand(String(req.params.brandId));
    if (!brand) return res.status(404).json({ success: false, message: "Brand not found." });
    return res.status(200).json({ success: true, data: brand });
  } catch (error) {
    next(error);
  }
};

export const approveBrand = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const brand = await brandAdminService.updateApproval(String(req.params.brandId), "APPROVED");
    if (!brand) return res.status(404).json({ success: false, message: "Brand not found." });
    return res.status(200).json({ success: true, data: brand });
  } catch (error) {
    next(error);
  }
};

export const rejectBrand = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const brand = await brandAdminService.updateApproval(String(req.params.brandId), "REJECTED", req.body?.reason);
    if (!brand) return res.status(404).json({ success: false, message: "Brand not found." });
    return res.status(200).json({ success: true, data: brand });
  } catch (error) {
    next(error);
  }
};

export const listBrandDeals = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deals = await brandAdminService.listBrandDeals(String(req.params.brandId));
    return res.status(200).json({ success: true, data: deals });
  } catch (error) {
    next(error);
  }
};

export const createManualDeal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {};

    if (isScraperDealUpsertPayload(body)) {
      return next("router");
    }

    const price = parseNumber(body.price);

    if (!body.title || typeof price !== "number" || !body.imgUrl) {
      return res.status(400).json({ success: false, message: "Title, price and image are required." });
    }

    const deal = await brandAdminService.createManualDeal(String(req.params.brandId), {
      title: String(body.title),
      description: body.description ? String(body.description) : undefined,
      price,
      originalPrice: parseNumber(body.originalPrice),
      discountPercent: parseNumber(body.discountPercent),
      minPersons: parseNumber(body.minPersons),
      maxPersons: parseNumber(body.maxPersons),
      cuisineTags: parseStringList(body.cuisineTags),
      mealType: parseStringList(body.mealType),
      conditions: body.conditions ? String(body.conditions) : undefined,
      startTime: body.startTime ? String(body.startTime) : undefined,
      endTime: body.endTime ? String(body.endTime) : undefined,
      imgUrl: String(body.imgUrl),
      isActive: typeof body.isActive === "boolean" ? body.isActive : true,
      createdBy: body.createdBy ? String(body.createdBy) : undefined,
    });

    return res.status(201).json({ success: true, data: deal });
  } catch (error) {
    next(error);
  }
};

export const deleteManualDeal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deal = await brandAdminService.deleteManualDeal(String(req.params.brandId), String(req.params.dealId));
    if (!deal) return next("router");
    return res.status(200).json({ success: true, data: deal });
  } catch (error) {
    if (error instanceof Error && error.message === "Brand not found.") {
      return next("router");
    }

    next(error);
  }
};
