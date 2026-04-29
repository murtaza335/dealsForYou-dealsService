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
  },
  { timestamps: true }
);

export const BrandModel = mongoose.model<BrandDocument>("Brand", brandSchema);
