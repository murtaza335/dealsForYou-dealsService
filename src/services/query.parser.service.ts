import "dotenv/config";

export interface ParsedFilters {
  brand?: string;
  brands?: string[];
  maxPrice?: number;
  minPrice?: number;
  cuisineTags?: string[];
  mealTypes?: string[];
  minDiscount?: number;
}

class QueryParserService {
  private getApiKey(): string | undefined {
    return process.env.GROQ_API_KEY;
  }

  async parseQuery(query: string): Promise<ParsedFilters | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      console.warn("[QueryParser] Missing GROQ_API_KEY");
      return null;
    }

    const prompt = `
      Extract search filters from the following natural language query: "${query}".
      Return a JSON object with the following optional keys:
      - brand (string): a single brand name like "KFC" or "McDonald's"
      - brands (array of strings): multiple brand names if mentioned
      - maxPrice (number): the maximum price mentioned
      - minPrice (number): the minimum price mentioned
      - cuisineTags (array of strings): types of food like "burgers", "pizza", "deals"
      - mealTypes (array of strings): meal categories like "lunch", "dinner", "combo"
      - minDiscount (number): minimum discount percentage mentioned

      Only include keys where a value was found. Return ONLY the JSON object, no other text.
    `;

    try {
      console.log(`[QueryParser] Sending query to Groq: "${query}"`);
      
      const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              {
                role: "system",
                content: "You are a specialized query parser that extracts search filters and returns ONLY JSON.",
              },
              {
                role: "user",
                content: prompt,
              }
            ],
            temperature: 0.1,
            response_format: { type: "json_object" }
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) {
        console.warn("[QueryParser] No content in Groq response");
        return null;
      }

      console.log(`[QueryParser] Groq response: ${content.trim()}`);

      try {
        const parsed = JSON.parse(content);
        return parsed;
      } catch (e) {
        console.error("[QueryParser] Failed to parse JSON from Groq response:", e);
        // Attempt regex fallback if JSON parsing fails directly
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            return JSON.parse(jsonMatch[0]);
          } catch (innerE) {
            return null;
          }
        }
        return null;
      }
    } catch (error) {
      console.error("[QueryParser] Failed to parse query:", error);
      return null;
    }
  }
}

export const queryParserService = new QueryParserService();
