import mongoose, { Schema, Document, Types } from "mongoose";
import { v4 as uuidv4 } from "uuid";

//our schema for the deal data that we will be storing in our database
export interface DealDocument extends Document {
  dealId: string; // UUID string
  brandId: Types.ObjectId; // Reference to Brand
  brandSlug: string; // denormalized for easier querying without needing to populate brand
  externalId: string; // Unique ID from scraper per brand
  title: string;
  description?: string;
  price: number;
  originalPrice?: number;
  currency: string;
  discountPercent?: number;
  minPersons?: number;
  maxPersons?: number;
  cuisineTags?: string[];
  mealType?: string[];
  conditions?: string;
  startTime?: Date;
  endTime: Date;
  isExpired: boolean;
  isActive: boolean;
  isHot: boolean;
  imgUrl?: string;
  viewsCount: number;
  scrapedAt?: Date;
  metadata?: Record<string, unknown>;
  metadataEnrichedAt?: Date;
  metadataSource?: string;
}

const dealSchema = new Schema<DealDocument>(
  {
    dealId: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4() // Generate UUID string
    },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    brandSlug: { type: String, required: true }, // for easier querying without needing to populate brand
    externalId: { type: String, required: true },
    title: { type: String },
    description: { type: String },
    price: { type: Number },
    originalPrice: { type: Number },
    currency: { type: String, default: "PKR" },
    discountPercent: { type: Number },
    minPersons: { type: Number },
    maxPersons: { type: Number },
    cuisineTags: [{ type: String }],
    mealType: [{ type: String }],
    conditions: { type: String },
    startTime: { type: Date , nullable: true},
    endTime: { type: Date , nullable: true},
    isExpired: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isHot: { type: Boolean, default: false },
    viewsCount: { type: Number, default: 0 },
    scrapedAt: { type: Date },
    imgUrl: { type: String, default: "" },
    metadata: { type: Schema.Types.Mixed },
    metadataEnrichedAt: { type: Date },
    metadataSource: { type: String },
  },
  { timestamps: true }
);

dealSchema.index({ brandId: 1, externalId: 1 }, { unique: true });

export const DealModel = mongoose.model("Deal", dealSchema, "deals");