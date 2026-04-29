import z from "zod";


export const DealSchema = z.object({
    id: z.number(),
    name: z.string(),
    description: z.string(),
    price: z.number(),
    salePrice: z.number(),
    image: z.string(),
    category: z.string(),
    brandSlug: z.string(),
    isActive: z.boolean(),
    publishedAt: z.string()
});

export type Deal = z.infer<typeof DealSchema>;