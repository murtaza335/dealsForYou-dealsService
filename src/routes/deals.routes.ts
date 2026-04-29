import { Router } from "express";
import {
	getDealById,
	getDealsByIds,
	getDeals,
	getFilterBrands,
	getFilterCuisineTags,
	getFilterMealTypes,
	getFilterOptions,
	getFilterPriceRange,
} from "../controllers/deals.controller.js";

export const dealsRouter = Router();

dealsRouter.get("/filters/options", getFilterOptions);
dealsRouter.get("/filters/brands", getFilterBrands);
dealsRouter.get("/filters/cuisine-tags", getFilterCuisineTags);
dealsRouter.get("/filters/meal-types", getFilterMealTypes);
dealsRouter.get("/filters/price-range", getFilterPriceRange);

dealsRouter.get("/", getDeals);
dealsRouter.get("/filtered", getDeals);
dealsRouter.get("/bulk", getDealsByIds);
dealsRouter.get("/:dealId", getDealById);
