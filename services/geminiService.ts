
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

  // Calculate some basic statistics to help ground the AI
  const prices = contextData.map(d => d.usdPrice);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const lastPrice = prices[prices.length - 1];
  const volatility = Math.sqrt(prices.map(x => Math.pow(x - avgPrice, 2)).reduce((a, b) => a + b) / prices.length) / avgPrice;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: `Historical Statistics: AvgPrice=${avgPrice.toFixed(2)}, Volatility=${(volatility * 100).toFixed(1)}%, LastPrice=${lastPrice.toFixed(2)}. Context (JSON): ${JSON.stringify(contextData.slice(-36))}`,
      config: {
        systemInstruction: `You are an expert Lead Supply Chain Data Scientist. Generate a high-accuracy 12-month monthly forecast for USD Price and Lead Time for Part: ${filters.partNumber}.
        
        FORECASTING METHODOLOGY (ENSEMBLE APPROACH):
        1. Apply Triple Exponential Smoothing (Holt-Winters) to capture seasonality and trend.
        2. Perform Linear Regression for long-term trend extrapolation.
        3. Use Mean Reversion logic if volatility is high (>15%).
        4. Ensemble: Weigh the models (40% Smoothing, 40% Regression, 20% Mean Reversion).
        
        Output MUST be valid JSON matching the requested schema. Confidence intervals must expand over time (uncertainty increases).`,
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
    if (!text) throw new Error("Empty AI Response.");
    
    const parsed = JSON.parse(text);
    return { ...parsed, vendor: filters.vendor, country: filters.country, partNumber: filters.partNumber };
  } catch (err) {
    return handleAIError(err);
  }
};

export const getBulkForecastsFromAI = async (
  historicalData: HistoricalData[],
  combinations: FilterState[],
  onProgress: (index: number) => void,
  model: string = 'gemini-3-flash-preview'
): Promise<ForecastResult[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const BATCH_SIZE = 8;
  const results: ForecastResult[] = [];

  for (let i = 0; i < combinations.length; i += BATCH_SIZE) {
    const batch = combinations.slice(i, i + BATCH_SIZE);
    
    const batchData = batch.map(combo => {
      const data = historicalData
        .filter(d => d.partNumber === combo.partNumber && d.vendor === combo.vendor && d.country === combo.country)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(-12);
      return { combo, history: data };
    });

    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: `Batch: ${JSON.stringify(batchData)}`,
        config: {
          systemInstruction: `Perform ensemble statistical forecasting for this batch. Analyze price elasticity and lead time stability for each. Output a JSON array of ForecastResult objects.`,
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
      console.warn(`Batch failed:`, err);
    }
    
    onProgress(Math.min(i + BATCH_SIZE, combinations.length));
    await new Promise(r => setTimeout(r, 100)); 
  }

  return results;
};

export const getBenchmarkAnalysis = async (
  negotiated: NegotiatedRate[],
  forecasts: ForecastResult[],
  confidenceLevel: ConfidenceLevel = 95
): Promise<BenchmarkResult[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
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
      range: [f.summary.avgPredictedLeadTime * 0.8, f.summary.avgPredictedLeadTime * 1.2],
      trend: f.summary.leadTimeTrend
    }
  }));

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: `Proposed: ${JSON.stringify(negotiated)}\nBaselines: ${JSON.stringify(baselineContext)}`,
      config: {
        systemInstruction: `Evaluate procurement negotiations using a ${confidenceLevel}% confidence boundary. 
        Compare 'Proposed' vs 'Baselines'. If the Proposed Price is significantly higher than the Baseline Range, flag as 'critical'. If it's lower, flag as 'anomaly' or 'favorable'.
        Provide expert reasoning for each SKU in the comment field.`,
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
            }
          }
        }
      }
    });

    return JSON.parse(response.text || "[]");
  } catch (err) {
    return handleAIError(err);
  }
};
