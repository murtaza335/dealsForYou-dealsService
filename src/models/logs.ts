import mongoose, { Schema, Document, Types } from "mongoose";

export interface LogDocument extends Document<Types.ObjectId> {
    entityType: "brand" | "deal";
    entityId: Types.ObjectId; 
    brandId?: Types.ObjectId; // optional for deals
    logType: "sync" | "error" | "update" | "create" | "delete";
    message: string;
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

const logSchema = new Schema<LogDocument>(
    {
        entityType: { type: String, enum: ["brand", "deal"], required: true },
        entityId: { type: Schema.Types.ObjectId, required: true },
        brandId: { type: Schema.Types.ObjectId, ref: "Brand" },

        logType: {
            type: String,
            enum: ["sync", "error", "update", "create", "delete"],
            required: true
        },

        message: { type: String, required: true },

        metadata: { type: Schema.Types.Mixed } // flexible debugging info
    },
    { timestamps: true }
);

export const LogModel = mongoose.model<LogDocument>("Logs", logSchema);