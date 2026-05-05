import { DealDocument } from "../models/deal.model.js";
import { BrandDocument } from "../models/brands.model.js";
import {
  BrandDealUpsertInput,
  DealFilterOptions,
  DealFilters,
  DealRepository,
  DealsListResult,
  UpdateBrandInput,
} from "../repositories/deal.repository.js";

class DealsService {
  private readonly dealRepository = new DealRepository();

  async getDeals(filters: DealFilters): Promise<DealsListResult> {
    return this.dealRepository.getDeals(filters);
  }

  async getDealById(dealId: string): Promise<DealDocument | null> {
    return this.dealRepository.getDealById(dealId);
  }

  async getDealsByIds(deals: string[] | Array<{ dealId: string; brandSlug?: string }>): Promise<DealDocument[]> {
    return this.dealRepository.getDealsByIds(deals);
  }

  async getFilterOptions(): Promise<DealFilterOptions> {
    return this.dealRepository.getFilterOptions();
  }

  async getFilterBrands(): Promise<Array<{ name: string; slug: string }>> {
    return this.dealRepository.getFilterBrands();
  }

  async getFilterCuisineTags(): Promise<string[]> {
    return this.dealRepository.getFilterCuisineTags();
  }

  async getFilterMealTypes(): Promise<string[]> {
    return this.dealRepository.getFilterMealTypes();
  }

  async getFilterPriceRange(): Promise<{ min: number; max: number }> {
    return this.dealRepository.getFilterPriceRange();
  }

  async updateBrand(
    brandIdentifier: string,
    updates: UpdateBrandInput
  ): Promise<BrandDocument | null> {
    return this.dealRepository.updateBrand(brandIdentifier, updates);
  }

  async upsertDealForBrand(
    brandIdentifier: string,
    dealInput: BrandDealUpsertInput
  ): Promise<DealDocument | null> {
    return this.dealRepository.upsertDealForBrand(brandIdentifier, dealInput);
  }

  async deleteDealForBrand(
    brandIdentifier: string,
    dealIdentifier: string
  ): Promise<DealDocument | null> {
    return this.dealRepository.deleteDealForBrand(brandIdentifier, dealIdentifier);
  }
}

export const dealsService = new DealsService();
