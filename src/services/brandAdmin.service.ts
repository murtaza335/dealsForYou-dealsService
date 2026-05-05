import { v4 as uuidv4 } from "uuid";
import { BrandDocument, BrandModel } from "../models/brands.model.js";
import { DealDocument, DealModel } from "../models/deal.model.js";

type BrandInput = {
  name: string;
  tagline?: string;
  description: string;
  logoUrl?: string;
  website?: string;
  contactEmail: string;
  contactPhone: string;
  country: string;
  cities: string[];
  areas?: string[];
  cuisineTags?: string[];
  socials?: Record<string, string>;
  notes?: string;
  scrapeRequested: boolean;
};

type ManualDealInput = {
  title: string;
  description?: string;
  price: number;
  originalPrice?: number;
  discountPercent?: number;
  minPersons?: number;
  maxPersons?: number;
  cuisineTags?: string[];
  mealType?: string[];
  conditions?: string;
  startTime?: string;
  endTime?: string;
  imgUrl: string;
  isActive?: boolean;
  createdBy?: string;
};

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const cleanList = (values?: string[]) =>
  [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];

export class BrandAdminService {
  async createPendingBrand(input: BrandInput): Promise<BrandDocument> {
    const slugBase = slugify(input.name);
    const slug = slugBase || `brand-${Date.now()}`;
    const existing = await BrandModel.findOne({ slug });

    if (existing) {
      throw new Error("A brand with this name already exists.");
    }

    const scrapeRequested = Boolean(input.scrapeRequested);
    const logoUrl = input.logoUrl?.trim() || "";

    return BrandModel.create({
      name: input.name.trim(),
      slug,
      baseUrl: input.website?.trim() || "manual",
      logoUrl,
      imgUrl: logoUrl,
      website: input.website?.trim() || undefined,
      tagline: input.tagline?.trim() || undefined,
      description: input.description.trim(),
      contactEmail: input.contactEmail.trim(),
      contactPhone: input.contactPhone.trim(),
      country: input.country.trim(),
      cities: cleanList(input.cities),
      areas: cleanList(input.areas),
      cuisineTags: cleanList(input.cuisineTags),
      socials: input.socials ?? {},
      notes: input.notes?.trim() || undefined,
      approvalStatus: "PENDING",
      scrapeRequested,
      scraperStatus: scrapeRequested ? "PENDING_SETUP" : "NOT_REQUESTED",
      manualDealManagementEnabled: !scrapeRequested,
      isActive: false,
    });
  }

  async getBrandByPublicId(brandId: string): Promise<BrandDocument | null> {
    return BrandModel.findOne({ brandId });
  }

  async listBrands(): Promise<BrandDocument[]> {
    return BrandModel.find({}).sort({ createdAt: -1 });
  }

  async listPendingBrands(): Promise<BrandDocument[]> {
    return BrandModel.find({ approvalStatus: "PENDING" }).sort({ createdAt: -1 });
  }

  async suspendBrand(brandId: string): Promise<BrandDocument | null> {
    const brand = await BrandModel.findOneAndUpdate(
      { brandId },
      {
        $set: {
          isActive: false,
          scraperStatus: "DISABLED",
        },
      },
      { returnDocument: "after", runValidators: true }
    );

    if (!brand) return null;

    await DealModel.updateMany(
      { brandId: brand._id },
      { $set: { isActive: false, isHot: false } }
    );

    return brand;
  }

  async deleteBrand(brandId: string): Promise<BrandDocument | null> {
    const brand = await BrandModel.findOneAndDelete({ brandId });

    if (!brand) return null;

    await DealModel.deleteMany({ brandId: brand._id });
    return brand;
  }

  async updateApproval(
    brandId: string,
    approvalStatus: "APPROVED" | "REJECTED",
    rejectionReason?: string
  ): Promise<BrandDocument | null> {
    return BrandModel.findOneAndUpdate(
      { brandId },
      {
        $set: {
          approvalStatus,
          rejectionReason: approvalStatus === "REJECTED" ? rejectionReason ?? "" : undefined,
          isActive: approvalStatus === "APPROVED",
          approvedAt: approvalStatus === "APPROVED" ? new Date() : undefined,
        },
      },
      { returnDocument: "after", runValidators: true }
    );
  }

  async listBrandDeals(brandId: string): Promise<DealDocument[]> {
    const brand = await this.getBrandByPublicId(brandId);
    if (!brand) throw new Error("Brand not found.");

    return DealModel.find({ brandId: brand._id, deletedAt: { $exists: false } }).sort({ createdAt: -1 });
  }

  async createManualDeal(brandId: string, input: ManualDealInput): Promise<DealDocument> {
    const brand = await this.getBrandByPublicId(brandId);
    if (!brand) throw new Error("Brand not found.");
    if (brand.approvalStatus !== "APPROVED") throw new Error("Brand is not approved.");
    if (!brand.manualDealManagementEnabled) throw new Error("Manual deal management is disabled for this brand.");

    const originalPrice = input.originalPrice;
    const discountPercent =
      typeof input.discountPercent === "number"
        ? input.discountPercent
        : originalPrice && originalPrice > input.price
          ? Math.round(((originalPrice - input.price) / originalPrice) * 100)
          : undefined;

    return DealModel.create({
      dealId: uuidv4(),
      brandId: brand._id,
      brandSlug: brand.slug,
      externalId: `manual:${uuidv4()}`,
      title: input.title.trim(),
      description: input.description?.trim() || "",
      price: input.price,
      originalPrice,
      discountPercent,
      currency: "PKR",
      minPersons: input.minPersons,
      maxPersons: input.maxPersons,
      cuisineTags: cleanList(input.cuisineTags),
      mealType: cleanList(input.mealType),
      conditions: input.conditions?.trim() || undefined,
      startTime: input.startTime ? new Date(input.startTime) : undefined,
      endTime: input.endTime ? new Date(input.endTime) : undefined,
      isExpired: input.endTime ? new Date(input.endTime) <= new Date() : false,
      isActive: input.isActive ?? true,
      isHot: false,
      imgUrl: input.imgUrl,
      sourceType: "MANUAL",
      manuallyCreatedBy: input.createdBy,
      baseUrl: brand.baseUrl || brand.website || "manual",
      brandLogoUrl: brand.logoUrl || brand.imgUrl || "",
    });
  }

  async deleteManualDeal(brandId: string, dealId: string): Promise<DealDocument | null> {
    const brand = await this.getBrandByPublicId(brandId);
    if (!brand) throw new Error("Brand not found.");
    if (!brand.manualDealManagementEnabled) throw new Error("Manual deal management is disabled for this brand.");

    return DealModel.findOneAndUpdate(
      { brandId: brand._id, dealId, sourceType: "MANUAL" },
      { $set: { isActive: false, deletedAt: new Date() } },
      { returnDocument: "after" }
    );
  }
}

export const brandAdminService = new BrandAdminService();
