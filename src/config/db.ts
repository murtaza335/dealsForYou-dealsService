import mongoose from "mongoose";
import "dotenv/config";

const ENV = process.env.DATABASE_URL_DEALS_SERVICE || "";

//connecting the scraper service to the deals database cluster0
export const connectDB = async () => {
  try {
    await mongoose.connect(ENV);

    console.log(" MongoDB connected successfully");
  } catch (error) {
    console.error(" MongoDB connection failed:", error);
    process.exit(1);
  }
};