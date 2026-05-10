import { Router } from "express";
import {
  deleteBrandDeal,
  updateBrand,
  upsertBrandDeals,
  getPendingBrands,
  getApprovedBrands,
  getRejectedBrands,
  approveBrandApplication,
  rejectBrandApplication,
} from "../controllers/brands.controller.js";

export const brandsRouter = Router();

// Approval status routes
brandsRouter.get("/approval/pending", getPendingBrands);
brandsRouter.get("/approval/approved", getApprovedBrands);
brandsRouter.get("/approval/rejected", getRejectedBrands);

// Brand approval/rejection routes
brandsRouter.patch("/:brandId/approve", approveBrandApplication);
brandsRouter.patch("/:brandId/reject", rejectBrandApplication);

// Existing routes
brandsRouter.patch("/:brandId", updateBrand);
brandsRouter.post("/:brandId/deals", upsertBrandDeals);
brandsRouter.delete("/:brandId/deals/:dealId", deleteBrandDeal);
