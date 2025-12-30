
export interface HistoricalData {
  id: string;
  partNumber: string;
  country: string;
  usdPrice: number;
  quantity: number;
  leadTimeDays: number;
  vendor: string;
  date: string; // ISO format
  isOutlier?: boolean;
}

export interface NegotiatedRate {
  partNumber: string;
  vendor: string;
  country: string;
  proposedPrice: number;
  proposedLeadTime: number;
}

export interface BenchmarkResult {
  partNumber: string;
  vendor: string;
  country: string;
  proposedPrice: number;
  proposedLeadTime: number;
  priceStatus: 'favorable' | 'warning' | 'critical' | 'anomaly';
  leadTimeStatus: 'favorable' | 'warning' | 'critical' | 'anomaly';
  confidenceMatch: boolean;
  comment: string;
}

export interface ForecastPoint {
  date: string;
  predictedPrice: number;
  predictedLeadTime: number;
  confidenceIntervalUpper: number;
  confidenceIntervalLower: number;
}

export interface ForecastResult {
  partNumber: string;
  vendor: string;
  country: string;
  forecast: ForecastPoint[];
  summary: {
    avgPredictedPrice: number;
    avgPredictedLeadTime: number;
    priceTrend: 'up' | 'down' | 'stable';
    leadTimeTrend: 'up' | 'down' | 'stable';
    optimizedOrderQuantity: number;
  };
}

export interface FilterState {
  partNumber: string;
  vendor: string;
  country: string;
}

export type ConfidenceLevel = 90 | 95 | 99;
