import mongoose, { Schema, Document, Types } from "mongoose";
import { v4 as uuidv4 } from "uuid";

// CREATE TABLE brands (
//     brand_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     name              VARCHAR(100) NOT NULL UNIQUE,
//     slug              VARCHAR(100) UNIQUE,
//     tagline           VARCHAR(255),
//     description       TEXT,
//     logo_url          TEXT,
//     website           TEXT,
//     is_active         BOOLEAN DEFAULT true,
//     popularity_score  FLOAT DEFAULT 0,                 -- updated by background job from views/trends
//     created_at        TIMESTAMPTZ DEFAULT NOW(),
//     updated_at        TIMESTAMPTZ DEFAULT NOW()
// );

// our schema for the brand data that we will be storing in our database
export interface BrandDocument extends Document<Types.ObjectId> {
  _id: Types.ObjectId;
  brandId: string; // UUID string
  imgUrl?: string;
  name: string;
  slug: string;
  baseUrl: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  tagline?: string;
  description?: string;
  logoUrl?: string;
  website?: string;
  cities?: string[];
  areas?: string[];
  locations?: { lat: number; lng: number }[];
  country?: string;
  contactEmail?: string;
  contactPhone?: string;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  scrapeRequested: boolean;
  scraperStatus: "NOT_REQUESTED" | "PENDING_SETUP" | "ACTIVE" | "DISABLED";
  manualDealManagementEnabled: boolean;
  cuisineTags?: string[];
  socials?: Record<string, string>;
  notes?: string;
  rejectionReason?: string;
  approvedAt?: Date;
}

const brandSchema = new Schema<BrandDocument>(
  {
    brandId: {
      type: String,
      required: true,
      unique: true,
      default: () => uuidv4() // Generate UUID string
    },
    imgUrl : {type: String, default: "" },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    baseUrl: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    tagline: { type: String },
    description: { type: String },
    logoUrl: { type: String },
    website: { type: String },
    cities: [ { type: String } ],
    areas: [ { type: String } ],
    locations: [{ type: { lat: Number, lng: Number } }],
    country: { type: String },
    contactEmail: { type: String },
    contactPhone: { type: String },
    approvalStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    scrapeRequested: { type: Boolean, default: false },
    scraperStatus: {
      type: String,
      enum: ["NOT_REQUESTED", "PENDING_SETUP", "ACTIVE", "DISABLED"],
      default: "NOT_REQUESTED",
    },
    manualDealManagementEnabled: { type: Boolean, default: true },
    cuisineTags: [{ type: String }],
    socials: { type: Schema.Types.Mixed },
    notes: { type: String },
    rejectionReason: { type: String },
    approvedAt: { type: Date },
  },
  { timestamps: true }
);

export const BrandModel = mongoose.model<BrandDocument>("Brand", brandSchema);
