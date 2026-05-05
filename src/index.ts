import express, { Request, Response } from "express";
import { rabbitMQSubscriber } from "./services/rabbitmq.subscriber.js";
import "dotenv/config";
import { connectDB } from "./config/db.js";
import { dealsRouter } from "./routes/deals.routes.js";
import { brandAdminRouter } from "./routes/brandAdmin.routes.js";
import { brandsRouter } from "./routes/brands.routes.js";
import mongoose from "mongoose";
import { BrandModel } from "./models/brands.model.js";
import { DealModel } from "./models/deal.model.js";

const app = express();
const PORT = process.env.SERVICE_PORT_DEALS_SERVICE || 5000;

app.use(express.json());

app.use("/api/deals", dealsRouter);
app.use("/api/brands", brandAdminRouter);
app.use("/api/brands", brandsRouter);
 
app.get("/", (req: Request, res: Response) => {
    res.send("Data service is Up!");
});

app.listen(PORT, async () => {

    // conenct db first 
    await connectDB();
    console.log("[DB] name:", mongoose.connection.name);
console.log("[DB] modelNames:", mongoose.modelNames());
console.log("[DB] BrandModel collection:", BrandModel.collection.name);
console.log("[DB] DealModel collection:", DealModel.collection.name);

    // then start the rabbitmq subscriber
    await rabbitMQSubscriber.init();
    
});
