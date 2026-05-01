import { Router } from "express";
import {
  deleteBrandDeal,
  updateBrand,
  upsertBrandDeals,
} from "../controllers/brands.controller.js";

export const brandsRouter = Router();

brandsRouter.patch("/:brandId", updateBrand);
brandsRouter.post("/:brandId/deals", upsertBrandDeals);
brandsRouter.delete("/:brandId/deals/:dealId", deleteBrandDeal);
