import { BrandModel, type BrandDocument } from "../models/brands.model.js";

export class BrandRepository {
  /**
   * Get all brands with PENDING approval status
   */
  static async getPendingBrands(): Promise<BrandDocument[]> {
    try {
      const brands = await BrandModel.find({ approvalStatus: "PENDING" })
        .sort({ createdAt: -1 });
      return brands;
    } catch (error) {
      throw new Error(`Failed to fetch pending brands: ${error}`);
    }
  }

  /**
   * Get all brands with APPROVED approval status
   */
  static async getApprovedBrands(): Promise<BrandDocument[]> {
    try {
      const brands = await BrandModel.find({ approvalStatus: "APPROVED" })
        .sort({ approvedAt: -1 });
      return brands;
    } catch (error) {
      throw new Error(`Failed to fetch approved brands: ${error}`);
    }
  }

  /**
   * Get all brands with REJECTED approval status
   */
  static async getRejectedBrands(): Promise<BrandDocument[]> {
    try {
      const brands = await BrandModel.find({ approvalStatus: "REJECTED" })
        .sort({ createdAt: -1 });
      return brands;
    } catch (error) {
      throw new Error(`Failed to fetch rejected brands: ${error}`);
    }
  }

  /**
   * Get a single brand by ID
   */
  static async getBrandById(brandId: string): Promise<BrandDocument | null> {
    try {
      const brand = await BrandModel.findOne({ brandId });
      return brand;
    } catch (error) {
      throw new Error(`Failed to fetch brand by ID: ${error}`);
    }
  }

  /**
   * Update brand approval status from PENDING to APPROVED
   * Only updates if current status is PENDING
   */
  static async approveBrand(brandId: string): Promise<BrandDocument | null> {
    try {
      // First check if brand exists and is in PENDING status
      const brand = await BrandModel.findOne({ brandId });

      if (!brand) {
        return null;
      }

      // Only allow approval if current status is PENDING
      if (brand.approvalStatus !== "PENDING") {
        throw new Error(
          `Cannot approve brand. Current status is ${brand.approvalStatus}, expected PENDING`
        );
      }

      // Update to APPROVED status and set approvedAt timestamp
      const updatedBrand = await BrandModel.findOneAndUpdate(
        { brandId, approvalStatus: "PENDING" },
        {
          approvalStatus: "APPROVED",
          approvedAt: new Date(),
        },
        { new: true }
      );

      return updatedBrand;
    } catch (error) {
      throw new Error(`Failed to approve brand: ${error}`);
    }
  }

  /**
   * Reject a brand (change from PENDING to REJECTED)
   */
  static async rejectBrand(
    brandId: string,
    rejectionReason: string
  ): Promise<BrandDocument | null> {
    try {
      const brand = await BrandModel.findOne({ brandId });

      if (!brand) {
        return null;
      }

      // Only allow rejection if current status is PENDING
      if (brand.approvalStatus !== "PENDING") {
        throw new Error(
          `Cannot reject brand. Current status is ${brand.approvalStatus}, expected PENDING`
        );
      }

      const updatedBrand = await BrandModel.findOneAndUpdate(
        { brandId, approvalStatus: "PENDING" },
        {
          approvalStatus: "REJECTED",
          rejectionReason,
        },
        { new: true }
      );

      return updatedBrand;
    } catch (error) {
      throw new Error(`Failed to reject brand: ${error}`);
    }
  }

  /**
   * Get brands by approval status
   */
  static async getBrandsByApprovalStatus(
    status: "PENDING" | "APPROVED" | "REJECTED"
  ): Promise<BrandDocument[]> {
    try {
      const brands = await BrandModel.find({ approvalStatus: status }).sort({
        createdAt: -1,
      });
      return brands;
    } catch (error) {
      throw new Error(`Failed to fetch brands by status: ${error}`);
    }
  }
}
