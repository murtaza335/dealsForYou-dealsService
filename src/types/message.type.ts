import z from "zod";
import {DealSchema} from "./deal.type.js";

export const DealMessageSchema = z.object({
    brand: z.string(),
    name: z.string(),
    url: z.string(),
    deals: z.array(DealSchema) // Adjust the type as needed for your deal structure
});

// export this type so that we can use it in our rabbitmq subscriber to type the messages we receive from the scraper service
export type DealMessage = z.infer<typeof DealMessageSchema>;