
import { HistoricalData, NegotiatedRate, ForecastResult, ForecastPoint } from '../types';

export const cleanseOutliers = (data: HistoricalData[]): { cleansed: HistoricalData[], outlierCount: number } => {
  if (data.length < 4) return { cleansed: data, outlierCount: 0 };

  const values = data.map(d => d.usdPrice).sort((a, b) => a - b);
  const q1 = values[Math.floor(values.length / 4)];
  const q3 = values[Math.floor(values.length * (3 / 4))];
  const iqr = q3 - q1;
  const minBound = q1 - 1.5 * iqr;
  const maxBound = q3 + 1.5 * iqr;

  const cleansed = data.filter(d => d.usdPrice >= minBound && d.usdPrice <= maxBound);
  return { cleansed, outlierCount: data.length - cleansed.length };
};

export const generateSampleData = (count: number = 100): HistoricalData[] => {
  const parts = ['SKU-1001', 'SKU-2045', 'SKU-5098', 'CHIP-M2', 'BOLT-X9', 'SENSOR-A7', 'CABLE-CAT6'];
  const vendors = ['GlobalLogistics Inc', 'AsiaDirect Mfg', 'EuroParts SE', 'TechSupply Co', 'Vertex Systems'];
  const countries = ['USA', 'China', 'Germany', 'Vietnam', 'Mexico', 'India', 'Brazil'];
  
  const data: HistoricalData[] = [];
  const now = new Date();
  const combos = parts.length * 2;
  const rowsPerCombo = Math.max(1, Math.floor(count / combos));

  parts.forEach(part => {
    const partVendors = [vendors[Math.floor(Math.random() * vendors.length)]];
    if (Math.random() > 0.5) partVendors.push(vendors[Math.floor(Math.random() * vendors.length)]);

    partVendors.forEach(vendor => {
      const country = countries[Math.floor(Math.random() * countries.length)];
      const basePrice = 40 + Math.random() * 300;
      const baseLeadTime = 10 + Math.random() * 50;
      
      for (let i = rowsPerCombo; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const seasonality = Math.sin((date.getMonth() / 11) * Math.PI) * 15;
        const inflation = (rowsPerCombo - i) * 0.5;
        
        // Add occasional deliberate outliers
        const multiplier = (Math.random() > 0.96) ? 2.5 : 1;

        data.push({
          id: crypto.randomUUID(),
          partNumber: part,
          country: country,
          vendor: vendor,
          usdPrice: parseFloat(((basePrice + seasonality + inflation + (Math.random() * 8 - 4)) * multiplier).toFixed(2)),
          quantity: Math.floor(Math.random() * 1000) + 100,
          leadTimeDays: Math.floor(baseLeadTime + (Math.random() * 10 - 5)),
          date: date.toISOString().split('T')[0]
        });
      }
    });
  });
  
  return data.slice(0, count);
};

export const generateNegotiationSampleCSV = (): string => {
  const headers = ['Part Number', 'Vendor', 'Country', 'Proposed Price', 'Proposed Lead Time'];
  const samples = [
    ['SKU-1001', 'GlobalLogistics Inc', 'USA', '145.00', '14'],
    ['SKU-2045', 'AsiaDirect Mfg', 'China', '88.50', '35'],
    ['CHIP-M2', 'TechSupply Co', 'Vietnam', '210.00', '21']
  ];
  return [headers.join(','), ...samples.map(r => r.join(','))].join('\n');
};

export const generateForecastTemplateCSV = (): string => {
  const headers = ['Part Number', 'Vendor', 'Country', 'Date', 'Predicted Price', 'Predicted Lead Time', 'Confidence Upper', 'Confidence Lower'];
  const sampleDate = new Date().toISOString().split('T')[0];
  const samples = [
    ['SKU-1001', 'GlobalLogistics Inc', 'USA', sampleDate, '140.00', '15', '145.00', '135.00'],
    ['SKU-2045', 'AsiaDirect Mfg', 'China', sampleDate, '90.00', '30', '95.00', '85.00']
  ];
  return [headers.join(','), ...samples.map(r => r.join(','))].join('\n');
};

export const generateSampleCSV = (): string => {
  const data = generateSampleData(100);
  const headers = ['Part Number', 'Country', 'USD Pricing', 'Quantity', 'Lead Time (Days)', 'Vendor', 'Date'];
  const rows = data.map(d => [
    `"${d.partNumber}"`, `"${d.country}"`, d.usdPrice, d.quantity, d.leadTimeDays, `"${d.vendor}"`, d.date
  ]);
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
};

export const parseNegotiationCSV = (csvText: string): NegotiatedRate[] => {
  const lines = csvText.split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const obj: any = {};
    headers.forEach((header, i) => obj[header] = values[i]);
    return {
      partNumber: obj['part number'] || obj['partnumber'],
      vendor: obj['vendor'],
      country: obj['country'],
      proposedPrice: parseFloat(obj['proposed price'] || obj['price'] || 0),
      proposedLeadTime: parseInt(obj['proposed lead time'] || obj['lead time'] || 0)
    };
  });
};

export const parseForecastCSV = (csvText: string): ForecastResult[] => {
  const lines = csvText.split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  
  const rawPoints = lines.slice(1).filter(l => l.trim()).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const obj: any = {};
    headers.forEach((header, i) => obj[header] = values[i]);
    return {
      partNumber: obj['part number'] || obj['partnumber'],
      vendor: obj['vendor'],
      country: obj['country'],
      date: obj['date'],
      predictedPrice: parseFloat(obj['predicted price'] || 0),
      predictedLeadTime: parseInt(obj['predicted lead time'] || 0),
      confidenceIntervalUpper: parseFloat(obj['confidence upper'] || 0),
      confidenceIntervalLower: parseFloat(obj['confidence lower'] || 0)
    };
  });

  // Group by Part-Vendor-Country
  const groups = new Map<string, ForecastResult>();
  rawPoints.forEach(p => {
    const key = `${p.partNumber}|${p.vendor}|${p.country}`;
    if (!groups.has(key)) {
      groups.set(key, {
        partNumber: p.partNumber,
        vendor: p.vendor,
        country: p.country,
        forecast: [],
        summary: {
          avgPredictedPrice: 0,
          avgPredictedLeadTime: 0,
          priceTrend: 'stable',
          leadTimeTrend: 'stable',
          optimizedOrderQuantity: 0
        }
      });
    }
    const res = groups.get(key)!;
    res.forecast.push({
      date: p.date,
      predictedPrice: p.predictedPrice,
      predictedLeadTime: p.predictedLeadTime,
      confidenceIntervalUpper: p.confidenceIntervalUpper,
      confidenceIntervalLower: p.confidenceIntervalLower
    });
  });

  // Calculate summaries for grouped items
  groups.forEach(res => {
    const prices = res.forecast.map(f => f.predictedPrice);
    const leadTimes = res.forecast.map(f => f.predictedLeadTime);
    res.summary.avgPredictedPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    res.summary.avgPredictedLeadTime = leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length;
    // Simple trend detection
    if (prices.length > 1) {
      const diff = prices[prices.length - 1] - prices[0];
      res.summary.priceTrend = diff > 0 ? 'up' : diff < 0 ? 'down' : 'stable';
    }
  });

  return Array.from(groups.values());
};

export const parseCSV = (csvText: string): HistoricalData[] => {
  const lines = csvText.split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[()]/g, ''));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const obj: any = {};
    headers.forEach((header, i) => obj[header] = values[i]);
    return {
      id: crypto.randomUUID(),
      partNumber: obj['part number'] || obj['partnumber'] || obj['sku'],
      country: obj['country'],
      usdPrice: parseFloat(obj['usd pricing'] || obj['usd price'] || obj['price'] || 0),
      quantity: parseInt(obj['quantity'] || obj['qty'] || 0),
      leadTimeDays: parseInt(obj['lead time days'] || obj['lead time'] || obj['leadtime'] || 0),
      vendor: obj['vendor'],
      date: obj['date'] || new Date().toISOString()
    } as HistoricalData;
  });
};
