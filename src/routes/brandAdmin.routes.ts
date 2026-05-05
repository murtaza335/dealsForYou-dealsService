import { Router } from "express";
import {
  approveBrand,
  createBrand,
  createManualDeal,
  deleteBrand,
  deleteManualDeal,
  getBrandByPublicId,
  listBrandDeals,
  listBrands,
  listPendingBrands,
  rejectBrand,
  suspendBrand,
} from "../controllers/brandAdmin.controller.js";

export const brandAdminRouter = Router();

brandAdminRouter.post("/", createBrand);
brandAdminRouter.get("/", listBrands);
brandAdminRouter.get("/pending", listPendingBrands);
brandAdminRouter.get("/by-brand-id/:brandId", getBrandByPublicId);
brandAdminRouter.patch("/:brandId/approve", approveBrand);
brandAdminRouter.patch("/:brandId/reject", rejectBrand);
brandAdminRouter.patch("/:brandId/suspend", suspendBrand);
brandAdminRouter.delete("/:brandId", deleteBrand);
brandAdminRouter.get("/:brandId/deals", listBrandDeals);
brandAdminRouter.post("/:brandId/deals", createManualDeal);
brandAdminRouter.delete("/:brandId/deals/:dealId", deleteManualDeal);
