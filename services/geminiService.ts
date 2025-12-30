
import { GoogleGenAI, Type } from "@google/genai";
import { HistoricalData, ForecastResult, NegotiatedRate, BenchmarkResult, ConfidenceLevel, FilterState } from "../types";

/**
 * Custom error handler to categorize Gemini API errors
 */
const handleAIError = (error: any): never => {
  console.error("AI Service Error:", error);
  const msg = error?.message?.toLowerCase() || "";

  if (msg.includes("429") || msg.includes("quota") || msg.includes("rate limit")) {
    throw new Error("AI Rate Limit Exceeded: The system is currently busy. Please wait a moment before trying again.");
  }
  if (msg.includes("503") || msg.includes("unavailable") || msg.includes("overloaded")) {
    throw new Error("AI Service Unavailable: The prediction engine is temporarily offline. Please try again in a few minutes.");
  }
  if (msg.includes("api key") || msg.includes("401") || msg.includes("403")) {
    throw new Error("Authentication Error: The AI service could not verify your credentials. Please check your configuration.");
  }
  if (error instanceof SyntaxError) {
    throw new Error("Data Interpretation Error: The AI returned an invalid response format. This may happen with highly unusual data patterns.");
  }
  
  throw new Error(`AI System Error: ${error?.message || "An unexpected error occurred while processing your request."}`);
};

// Fix: Always initialize GoogleGenAI inside functions to ensure the most up-to-date API key is used
export const getForecastFromAI = async (
  historicalData: HistoricalData[],
  filters: FilterState,
  model: string = 'gemini-3-flash-preview'
): Promise<ForecastResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const contextData = historicalData
    .filter(d => d.partNumber === filters.partNumber && d.vendor === filters.vendor && d.country === filters.country)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (contextData.length === 0) throw new Error("Missing Historical Data: No records found matching the selected filters.");
  if (contextData.length < 3) throw new Error("Insufficient Data: At least 3 historical points are required for a reliable AI forecast.");

  // Fix: Move task instructions to systemInstruction for better model adherence
  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: `Historical Context (JSON): ${JSON.stringify(contextData.slice(-24))}`,
      config: {
        systemInstruction: `You are a supply chain analyst. Generate a 12-month monthly forecast for BOTH USD Price and Lead Time (Days) based on the provided historical data for Part: ${filters.partNumber}, Vendor: ${filters.vendor}, Country: ${filters.country}. Ensure confidence intervals reflect data volatility. Output MUST be valid JSON matching the requested schema.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            partNumber: { type: Type.STRING },
            forecast: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING },
                  predictedPrice: { type: Type.NUMBER },
                  predictedLeadTime: { type: Type.NUMBER },
                  confidenceIntervalUpper: { type: Type.NUMBER },
                  confidenceIntervalLower: { type: Type.NUMBER }
                }
              }
            },
            summary: {
              type: Type.OBJECT,
              properties: {
                avgPredictedPrice: { type: Type.NUMBER },
                avgPredictedLeadTime: { type: Type.NUMBER },
                priceTrend: { type: Type.STRING },
                leadTimeTrend: { type: Type.STRING },
                optimizedOrderQuantity: { type: Type.NUMBER }
              }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("Empty AI Response: The engine failed to generate content.");
    
    const parsed = JSON.parse(text);
    return { ...parsed, vendor: filters.vendor, country: filters.country, partNumber: filters.partNumber };
  } catch (err) {
    return handleAIError(err);
  }
};

// Fix: Always initialize GoogleGenAI inside functions
export const getBulkForecastsFromAI = async (
  historicalData: HistoricalData[],
  combinations: FilterState[],
  onProgress: (index: number) => void,
  model: string = 'gemini-3-flash-preview'
): Promise<ForecastResult[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const BATCH_SIZE = 10;
  const results: ForecastResult[] = [];

  for (let i = 0; i < combinations.length; i += BATCH_SIZE) {
    const batch = combinations.slice(i, i + BATCH_SIZE);
    
    const batchData = batch.map(combo => {
      const data = historicalData
        .filter(d => d.partNumber === combo.partNumber && d.vendor === combo.vendor && d.country === combo.country)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(-6);
      return { combo, history: data };
    });

    // Fix: Using systemInstruction for bulk instructions
    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: `Bulk Data Batch: ${JSON.stringify(batchData)}`,
        config: {
          systemInstruction: `Generate pricing and lead-time forecasts for this batch of procurement items. Return an array of ForecastResult JSON objects.`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                partNumber: { type: Type.STRING },
                vendor: { type: Type.STRING },
                country: { type: Type.STRING },
                forecast: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      date: { type: Type.STRING },
                      predictedPrice: { type: Type.NUMBER },
                      predictedLeadTime: { type: Type.NUMBER },
                      confidenceIntervalUpper: { type: Type.NUMBER },
                      confidenceIntervalLower: { type: Type.NUMBER }
                    }
                  }
                },
                summary: {
                  type: Type.OBJECT,
                  properties: {
                    avgPredictedPrice: { type: Type.NUMBER },
                    avgPredictedLeadTime: { type: Type.NUMBER },
                    priceTrend: { type: Type.STRING },
                    leadTimeTrend: { type: Type.STRING },
                    optimizedOrderQuantity: { type: Type.NUMBER }
                  }
                }
              }
            }
          }
        }
      });

      const text = response.text;
      if (text) {
        const batchResults = JSON.parse(text) as ForecastResult[];
        results.push(...batchResults);
      }
    } catch (err) {
      console.warn(`Bulk processing batch failure at index ${i}:`, err);
      const msg = (err as any)?.message?.toLowerCase() || "";
      if (msg.includes("429") || msg.includes("401") || msg.includes("api key")) {
        return handleAIError(err);
      }
    }
    
    onProgress(Math.min(i + BATCH_SIZE, combinations.length));
    await new Promise(r => setTimeout(r, 100)); 
  }

  if (results.length === 0 && combinations.length > 0) {
    throw new Error("Bulk Analysis Failed: The AI engine was unable to process any of the requested data batches.");
  }

  return results;
};

// Fix: Using gemini-3-pro-preview for complex benchmarking logic and moving protocol to systemInstruction
export const getBenchmarkAnalysis = async (
  negotiated: NegotiatedRate[],
  forecasts: ForecastResult[],
  confidenceLevel: ConfidenceLevel = 95
): Promise<BenchmarkResult[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  if (negotiated.length === 0) throw new Error("Invalid Input: No negotiated rates provided for benchmarking.");

  const baselineContext = forecasts.map(f => ({ 
    part: f.partNumber, 
    vendor: f.vendor,
    country: f.country,
    pricing: {
      avg: f.summary.avgPredictedPrice,
      range: [f.forecast[0]?.confidenceIntervalLower, f.forecast[0]?.confidenceIntervalUpper]
    },
    logistics: {
      avgLeadTime: f.summary.avgPredictedLeadTime,
      range: [f.summary.avgPredictedLeadTime * 0.6, f.summary.avgPredictedLeadTime * 1.4],
      trend: f.summary.leadTimeTrend
    }
  }));

  // Fix: Evaluation logic belongs in systemInstruction
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview', // Complex Text Task
      contents: `Negotiations: ${JSON.stringify(negotiated)}\nBaselines: ${JSON.stringify(baselineContext)}`,
      config: {
        systemInstruction: `Benchmark proposed negotiated rates against AI-generated Baseline Forecasts using a ${confidenceLevel}% Confidence Level.
        
        EVALUATION PROTOCOL:
        1. PRICE STATUS:
           - 'anomaly': Proposed Price < Baseline Pricing Lower Range.
           - 'favorable': Baseline Lower Range <= Proposed Price <= Baseline Avg Pricing.
           - 'warning': Proposed Price > Baseline Avg but < Baseline Upper Range.
           - 'critical': Proposed Price >= Baseline Upper Range.
        
        2. LEAD TIME STATUS:
           - 'anomaly': Proposed Lead Time < 60% of Baseline Avg Lead Time.
           - 'favorable': 60% of Baseline Avg <= Proposed Lead Time <= Baseline Avg Lead Time.
           - 'warning': Proposed Lead Time > Baseline Avg by up to 20%.
           - 'critical': Proposed Lead Time > Baseline Avg by more than 20%.

        3. RULES:
           - No history: status 'favorable', comment "No comparative baseline available".
           - Provide strategic AI Feedback in comments.
           - Return ONLY a JSON array of BenchmarkResult objects.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              partNumber: { type: Type.STRING },
              vendor: { type: Type.STRING },
              country: { type: Type.STRING },
              proposedPrice: { type: Type.NUMBER },
              proposedLeadTime: { type: Type.NUMBER },
              priceStatus: { type: Type.STRING },
              leadTimeStatus: { type: Type.STRING },
              confidenceMatch: { type: Type.BOOLEAN },
              comment: { type: Type.STRING }
            },
            required: ["partNumber", "vendor", "country", "proposedPrice", "proposedLeadTime", "priceStatus", "leadTimeStatus", "confidenceMatch", "comment"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("Empty AI Response: The benchmarking engine returned no content.");
    
    return JSON.parse(text);
  } catch (err) {
    return handleAIError(err);
  }
};
