
import React, { useState, useMemo, useEffect } from 'react';
import { 
  BarChart3, TrendingUp, Clock, Database, Filter, Package, Truck, 
  Download, BrainCircuit, AlertCircle, Trash2, CheckCircle2, 
  BarChart, History, Scale, Upload, Zap, Layers, RefreshCw, FileDown,
  Table, XCircle, FileSpreadsheet, Settings2, AlertTriangle, CheckCircle, Info, Eraser, Files, Sparkles, Mail, Send, Copy, ClipboardCheck,
  ChevronRight, Cpu, Activity
} from 'lucide-react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Bar, ComposedChart, Line, LineChart
} from 'recharts';

import { HistoricalData, ForecastResult, FilterState, NegotiatedRate, BenchmarkResult, ConfidenceLevel } from './types';
import DataUpload from './components/DataUpload';
import StatsCard from './components/StatsCard';
import { getForecastFromAI, getBenchmarkAnalysis, getBulkForecastsFromAI } from './services/geminiService';
import { cleanseOutliers, parseNegotiationCSV, generateNegotiationSampleCSV, parseForecastCSV, generateForecastTemplateCSV } from './services/dataService';

type ModelType = 'gemini-3-flash-preview' | 'gemini-3-pro-preview' | 'gemini-flash-lite-latest';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'trends' | 'benchmark'>('trends');
  const [data, setData] = useState<HistoricalData[]>([]);
  const [cleansedData, setCleansedData] = useState<HistoricalData[]>([]);
  const [outlierCount, setOutlierCount] = useState(0);
  const [isCleansed, setIsCleansed] = useState(false);
  
  // Tab 1 state
  const [selectedModel, setSelectedModel] = useState<ModelType>('gemini-3-flash-preview');
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [allForecasts, setAllForecasts] = useState<ForecastResult[]>([]); 
  const [uploadedForecasts, setUploadedForecasts] = useState<ForecastResult[]>([]);
  const [forecastSource, setForecastSource] = useState<'system' | 'upload'>('system');
  
  const [loading, setLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({ partNumber: '', vendor: '', country: '' });

  // Benchmark specific state
  const [proposedRates, setProposedRates] = useState<NegotiatedRate[]>([]);
  const [benchmarks, setBenchmarks] = useState<BenchmarkResult[]>([]);
  const [confidenceLevel, setConfidenceLevel] = useState<ConfidenceLevel>(95);
  const [showAttentionOnly, setShowAttentionOnly] = useState(false);
  const [emailRecipients, setEmailRecipients] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [emailModeStatus, setEmailModeStatus] = useState<string | null>(null);

  const activeData = isCleansed ? cleansedData : data;

  // --- DYNAMIC FILTER LOGIC ---
  const availableParts = useMemo(() => {
    let filtered = activeData;
    if (filters.vendor) filtered = filtered.filter(d => d.vendor === filters.vendor);
    if (filters.country) filtered = filtered.filter(d => d.country === filters.country);
    return Array.from(new Set(filtered.map(d => d.partNumber))).sort();
  }, [activeData, filters.vendor, filters.country]);

  const availableVendors = useMemo(() => {
    let filtered = activeData;
    if (filters.partNumber) filtered = filtered.filter(d => d.partNumber === filters.partNumber);
    if (filters.country) filtered = filtered.filter(d => d.country === filters.country);
    return Array.from(new Set(filtered.map(d => d.vendor))).sort();
  }, [activeData, filters.partNumber, filters.country]);

  const availableCountries = useMemo(() => {
    let filtered = activeData;
    if (filters.partNumber) filtered = filtered.filter(d => d.partNumber === filters.partNumber);
    if (filters.vendor) filtered = filtered.filter(d => d.vendor === filters.vendor);
    return Array.from(new Set(filtered.map(d => d.country))).sort();
  }, [activeData, filters.partNumber, filters.vendor]);

  // AUTO-DISPLAY cached forecasts when filters change
  useEffect(() => {
    if (filters.partNumber && filters.vendor && filters.country) {
      const existing = allForecasts.find(f => 
        f.partNumber === filters.partNumber && 
        f.vendor === filters.vendor && 
        f.country === filters.country
      );
      if (existing) {
        setForecast(existing);
      } else {
        setForecast(null);
      }
    }
  }, [filters, allForecasts]);

  useEffect(() => {
    if (activeData.length === 0) return;
    setFilters(prev => {
      let next = { ...prev };
      let changed = false;
      if (next.partNumber && availableParts && !availableParts.includes(next.partNumber)) { next.partNumber = ''; changed = true; }
      if (next.vendor && availableVendors && !availableVendors.includes(next.vendor)) { next.vendor = ''; changed = true; }
      if (next.country && availableCountries && !availableCountries.includes(next.country)) { next.country = ''; changed = true; }
      return changed ? next : prev;
    });
  }, [availableParts, availableVendors, availableCountries, activeData.length]);

  const handleCleanse = () => {
    const { cleansed, outlierCount: count } = cleanseOutliers(data);
    setCleansedData(cleansed);
    setOutlierCount(count);
    setIsCleansed(true);
    setForecast(null);
    setAllForecasts([]); 
  };

  const handleRunForecast = async () => {
    if (!filters.partNumber || !filters.vendor || !filters.country) return;
    setLoading(true);
    setError(null);
    setActiveTab('trends');
    try {
      const result = await getForecastFromAI(activeData, filters, selectedModel);
      setAllForecasts(prev => {
        const other = prev.filter(p => !(p.partNumber === result.partNumber && p.vendor === result.vendor && p.country === result.country));
        return [...other, result];
      });
      setForecast(result);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred during forecasting.");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateAllForecasts = async () => {
    if (activeData.length === 0) return;
    
    const combinations: FilterState[] = [];
    const parts = Array.from(new Set(activeData.map(d => d.partNumber)));
    parts.forEach(p => {
      const filteredByP = activeData.filter(d => d.partNumber === p);
      const vendorsByP = Array.from(new Set(filteredByP.map(d => d.vendor)));
      vendorsByP.forEach(v => {
        const countriesByPV = Array.from(new Set(filteredByP.filter(d => d.vendor === v).map(d => d.country)));
        countriesByPV.forEach(c => {
          combinations.push({ partNumber: p, vendor: v, country: c });
        });
      });
    });

    setBulkLoading(true);
    setBulkProgress(0);
    setError(null);
    
    try {
      const results = await getBulkForecastsFromAI(activeData, combinations, (processedCount) => {
        setBulkProgress(Math.round((processedCount / combinations.length) * 100));
      }, selectedModel);
      
      setAllForecasts(results);
      
      if (results.length > 0) {
        const first = results[0];
        setActiveTab('trends');
        setFilters({
          partNumber: first.partNumber,
          vendor: first.vendor,
          country: first.country
        });
        setForecast(first);
      }
    } catch (err: any) {
      setError(err.message || "Bulk processing encountered a critical failure.");
    } finally {
      setBulkLoading(false);
      setBulkProgress(0);
    }
  };

  const handleNegotiationUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setLoading(true);
    const allParsed: NegotiatedRate[] = [];
    
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const text = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.readAsText(file);
        });
        const parsed = parseNegotiationCSV(text);
        allParsed.push(...parsed);
      }
      setProposedRates(prev => [...prev, ...allParsed]);
      setError(null);
      setBenchmarks([]); 
    } catch (err: any) {
      setError("Failed to parse one or more negotiation files.");
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const handleForecastUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        const parsed = parseForecastCSV(text);
        if (parsed.length === 0) throw new Error("Could not parse any valid forecasts from CSV.");
        setUploadedForecasts(parsed);
        setForecastSource('upload');
        setError(null);
      } catch (err: any) {
        setError(err.message || "Failed to parse Forecast CSV.");
      }
    };
    reader.readAsText(file);
  };

  const runBenchmark = async () => {
    if (proposedRates.length === 0) {
      setError("Input Required: Please upload negotiated rates first.");
      return;
    }
    
    const activeForecasts = forecastSource === 'system' ? allForecasts : uploadedForecasts;
    if (activeForecasts.length === 0) {
      setError(`Baseline Missing: Please ensure you have ${forecastSource === 'system' ? 'system forecasts' : 'uploaded forecast data'} available.`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const results = await getBenchmarkAnalysis(proposedRates, activeForecasts, confidenceLevel);
      setBenchmarks(results);
    } catch (err: any) {
      setError(err.message || "Benchmark analysis failed due to an AI engine error.");
    } finally {
      setLoading(false);
    }
  };

  const exportForecasts = () => {
    if (allForecasts.length === 0) return;
    const headers = ["Part Number", "Vendor", "Country", "Date", "Predicted Price", "Predicted Lead Time", "Confidence Upper", "Confidence Lower"];
    const rows: any[] = [];
    allForecasts.forEach(f => {
      f.forecast.forEach(pt => {
        rows.push([
          `"${f.partNumber}"`, `"${f.vendor}"`, `"${f.country}"`, pt.date, pt.predictedPrice, pt.predictedLeadTime, pt.confidenceIntervalUpper, pt.confidenceIntervalLower
        ]);
      });
    });
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ProcureForecasts_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const exportBenchmarks = () => {
    if (benchmarks.length === 0) return;
    const headers = ["Part Number", "Vendor", "Country", "Proposed Price", "Proposed Lead Time", "Price Status", "Lead Time Status", "AI Comment"];
    const rows = benchmarks.map(b => [
      `"${b.partNumber}"`, `"${b.vendor}"`, `"${b.country}"`, b.proposedPrice, b.proposedLeadTime, b.priceStatus, b.leadTimeStatus, `"${b.comment}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ProcureBenchmark_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const downloadNegotiationTemplate = () => {
    const csv = generateNegotiationSampleCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "negotiation_template.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadForecastTemplate = () => {
    const csv = generateForecastTemplateCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "forecast_baseline_template.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getRichTableHtml = (attentionRequired: BenchmarkResult[]) => {
    const getHexColor = (status: string) => {
      switch(status) {
        case 'anomaly': return '#8b5cf6'; // violet
        case 'critical': return '#e11d48'; // rose
        case 'warning': return '#d97706'; // amber
        case 'favorable': return '#10b981'; // emerald
        default: return '#64748b'; // slate
      }
    };

    const introHtml = `<p>Hi there,</p><p>Please be noted that during recent catalog/PIR upload, we've identified some pricing and/or lead time beyond the normal range. appreciate if you could have a review and advise</p>`;
    const closingHtml = `<p>Thank you,<br>GPS</p>`;
    
    let tableHtml = `
      <table style="width:100%; border-collapse: collapse; font-family: sans-serif; margin: 20px 0; border: 1px solid #e2e8f0;">
        <thead>
          <tr style="background-color: #f8fafc;">
            <th style="padding: 12px; border: 1px solid #e2e8f0; text-align: left; font-size: 13px;">Part Number</th>
            <th style="padding: 12px; border: 1px solid #e2e8f0; text-align: left; font-size: 13px;">Vendor / Country</th>
            <th style="padding: 12px; border: 1px solid #e2e8f0; text-align: center; font-size: 13px;">Proposed Price</th>
            <th style="padding: 12px; border: 1px solid #e2e8f0; text-align: center; font-size: 13px;">Lead Time</th>
            <th style="padding: 12px; border: 1px solid #e2e8f0; text-align: left; font-size: 13px;">AI Recommendation</th>
          </tr>
        </thead>
        <tbody>
    `;

    attentionRequired.forEach(b => {
      tableHtml += `
        <tr>
          <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold; font-size: 13px;">${b.partNumber}</td>
          <td style="padding: 12px; border: 1px solid #e2e8f0; font-size: 12px;">${b.vendor} (${b.country})</td>
          <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: center;">
            <span style="background-color: ${getHexColor(b.priceStatus)}15; color: ${getHexColor(b.priceStatus)}; padding: 4px 8px; border-radius: 6px; font-weight: bold; font-size: 12px; border: 1px solid ${getHexColor(b.priceStatus)}30; display: inline-block;">
              $${b.proposedPrice.toFixed(2)}
            </span>
          </td>
          <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: center;">
            <span style="background-color: ${getHexColor(b.leadTimeStatus)}15; color: ${getHexColor(b.leadTimeStatus)}; padding: 4px 8px; border-radius: 6px; font-weight: bold; font-size: 12px; border: 1px solid ${getHexColor(b.leadTimeStatus)}30; display: inline-block;">
              ${b.proposedLeadTime}d
            </span>
          </td>
          <td style="padding: 12px; border: 1px solid #e2e8f0; font-size: 11px; color: #475569; line-height: 1.4;">${b.comment}</td>
        </tr>
      `;
    });

    tableHtml += `</tbody></table>`;
    return `<html><body>${introHtml}${tableHtml}${closingHtml}</body></html>`;
  };

  const handleCopyRichReport = async () => {
    const attentionRequired = benchmarks.filter(b => 
      b.priceStatus === 'warning' || b.priceStatus === 'critical' || b.priceStatus === 'anomaly' ||
      b.leadTimeStatus === 'warning' || b.leadTimeStatus === 'critical' || b.leadTimeStatus === 'anomaly'
    );

    if (attentionRequired.length === 0) {
      alert("No items requiring attention found to report.");
      return;
    }

    const fullHtml = getRichTableHtml(attentionRequired);
    
    try {
      const blob = new Blob([fullHtml], { type: 'text/html' });
      const plainText = fullHtml.replace(/<[^>]*>?/gm, '').replace(/\n\s*\n/g, '\n').trim();
      const data = [new ClipboardItem({ 
        'text/html': blob, 
        'text/plain': new Blob([plainText], { type: 'text/plain' }) 
      })];
      await navigator.clipboard.write(data);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 3000);
      return true;
    } catch (err) {
      console.error("Failed to copy HTML: ", err);
      return false;
    }
  };

  const handleSendEmail = async () => {
    const attentionRequired = benchmarks.filter(b => 
      b.priceStatus === 'warning' || b.priceStatus === 'critical' || b.priceStatus === 'anomaly' ||
      b.leadTimeStatus === 'warning' || b.leadTimeStatus === 'critical' || b.leadTimeStatus === 'anomaly'
    );

    if (attentionRequired.length === 0) {
      alert("No items requiring attention to email.");
      return;
    }

    const copied = await handleCopyRichReport();

    const intro = "Hi there,\n\nPlease be noted that during recent catalog/PIR upload, we've identified some pricing and/or lead time beyond the normal range. appreciate if you could have a review and advise\n\n[PRO TIP: Formatted colorful table is in your clipboard! Just press Ctrl+V / Cmd+V here to paste it!]\n\n";
    const closing = "\nThank you,\nGPS";
    
    const summaryList = attentionRequired.map(b => 
      `- ${b.partNumber} ($${b.proposedPrice.toFixed(2)}): ${b.priceStatus.toUpperCase()} status. ${b.comment}`
    ).join('\n');

    const body = intro + summaryList + closing;
    const subject = `ACTION REQUIRED: Procurement Pricing & Lead Time Variance - ${attentionRequired.length} SKU(s)`;
    
    setEmailModeStatus("Rich report copied! Opening email client...");
    setTimeout(() => setEmailModeStatus(null), 4000);

    const mailto = `mailto:${emailRecipients}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  };

  const filteredBenchmarks = useMemo(() => {
    if (!showAttentionOnly) return benchmarks;
    return benchmarks.filter(b => 
      b.priceStatus === 'warning' || b.priceStatus === 'critical' || b.priceStatus === 'anomaly' ||
      b.leadTimeStatus === 'warning' || b.leadTimeStatus === 'critical' || b.leadTimeStatus === 'anomaly'
    );
  }, [benchmarks, showAttentionOnly]);

  const filteredHistory = useMemo(() => {
    return activeData
      .filter(d => d.partNumber === filters.partNumber && d.vendor === filters.vendor && d.country === filters.country)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [activeData, filters]);

  const activeBaseline = useMemo(() => {
    const source = forecastSource === 'system' ? allForecasts : uploadedForecasts;
    return source.find(f => 
      f.partNumber === filters.partNumber && 
      f.vendor === filters.vendor && 
      f.country === filters.country
    );
  }, [forecastSource, allForecasts, uploadedForecasts, filters]);

  const combinedData = useMemo(() => {
    if (!forecast) return [];
    const history = filteredHistory.map(h => ({ date: h.date, price: h.usdPrice, leadTime: h.leadTimeDays, isForecast: false }));
    const future = forecast.forecast.map(f => ({ date: f.date, price: f.predictedPrice, leadTime: f.predictedLeadTime, isForecast: true }));
    return [...history, ...future];
  }, [filteredHistory, forecast]);

  const baselinePreviewData = useMemo(() => {
    if (!activeBaseline) return [];
    // Show last 3 historical + first 3 forecast
    const history = filteredHistory.slice(-3).map(h => ({ 
      val: h.usdPrice, 
      lt: h.leadTimeDays, 
      type: 'H',
      high: h.usdPrice,
      low: h.usdPrice
    }));
    const future = activeBaseline.forecast.slice(0, 3).map(f => ({ 
      val: f.predictedPrice, 
      lt: f.predictedLeadTime, 
      high: f.confidenceIntervalUpper,
      low: f.confidenceIntervalLower,
      type: 'F' 
    }));
    return [...history, ...future];
  }, [activeBaseline, filteredHistory]);

  const getStatusIcon = (status: string) => {
    switch(status) {
      case 'favorable': return <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />;
      case 'warning': return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />;
      case 'critical': return <AlertCircle className="w-3.5 h-3.5 text-rose-500" />;
      case 'anomaly': return <Sparkles className="w-3.5 h-3.5 text-violet-500" />;
      default: return null;
    }
  };

  const getStatusColorClass = (status: string) => {
    switch(status) {
      case 'favorable': return 'bg-emerald-50 border-emerald-100 text-emerald-700';
      case 'warning': return 'bg-amber-50 border-amber-100 text-amber-700';
      case 'critical': return 'bg-rose-50 border-rose-100 text-rose-700';
      case 'anomaly': return 'bg-violet-50 border-violet-100 text-violet-700';
      default: return 'bg-slate-50 border-slate-100 text-slate-500';
    }
  };

  const totalUploadedPoints = useMemo(() => {
    return uploadedForecasts.reduce((acc, f) => acc + f.forecast.length, 0);
  }, [uploadedForecasts]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 px-8 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2.5 rounded-xl shadow-lg shadow-indigo-100">
            <BrainCircuit className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">PredictaProcure AI</h1>
            <div className="flex gap-4 mt-0.5">
              <button 
                onClick={() => setActiveTab('trends')}
                className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all ${activeTab === 'trends' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <History className="w-3.5 h-3.5" /> 1. Forecast & Trends
              </button>
              <button 
                onClick={() => setActiveTab('benchmark')}
                className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all ${activeTab === 'benchmark' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <Scale className="w-3.5 h-3.5" /> 2. Negotiation Benchmark
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
           {isCleansed && <div className="px-3 py-1 bg-emerald-50 border border-emerald-100 rounded-full text-[10px] font-bold text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3"/> {outlierCount} Outliers Cleansed</div>}
           <div className="h-8 w-px bg-slate-100" />
           <div className="flex items-center gap-3">
             <div className="flex flex-col items-end">
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Repository</span>
               <span className="text-xs font-black text-indigo-600">{allForecasts.length} Active Models</span>
             </div>
             <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 rounded-xl text-white text-xs font-bold">
               <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> AI Agent Ready
             </div>
           </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 bg-white border-r border-slate-200 p-6 overflow-y-auto shrink-0 z-30 flex flex-col">
          <div className="flex items-center gap-2 mb-8">
            <Filter className="w-5 h-5 text-indigo-600" />
            <h2 className="font-bold text-slate-900 text-sm uppercase tracking-wider">Control Panel</h2>
          </div>

          {(data.length === 0 && activeTab === 'trends') ? (
            <div className="text-center py-12 px-4 bg-slate-50 rounded-2xl border border-slate-200">
              <Database className="w-12 h-12 text-slate-300 mx-auto mb-4 opacity-50" />
              <p className="text-xs font-medium text-slate-500 leading-relaxed">Please begin by uploading historical procurement data.</p>
            </div>
          ) : (
            <div className="space-y-6 flex-1">
              {data.length > 0 && !isCleansed && (
                <button 
                  onClick={handleCleanse}
                  className="w-full py-3 bg-rose-50 border border-rose-100 text-rose-600 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-rose-100 transition-all"
                >
                  <Trash2 className="w-4 h-4" /> Cleanse Outliers
                </button>
              )}

              <div className="space-y-4">
                <div className="p-5 bg-slate-900 rounded-2xl border border-slate-800 shadow-xl">
                  <label className="flex items-center gap-2 text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4">
                    <Cpu className="w-3 h-3" /> Select AI Intelligence Level
                  </label>
                  <div className="flex flex-col gap-2">
                    {(['gemini-3-flash-preview', 'gemini-3-pro-preview', 'gemini-flash-lite-latest'] as ModelType[]).map(m => (
                      <button
                        key={m}
                        onClick={() => setSelectedModel(m)}
                        className={`group relative px-4 py-3 rounded-xl text-left transition-all border-2 flex items-center justify-between ${selectedModel === m ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg' : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'}`}
                      >
                        <div>
                          <div className={`text-[11px] font-black uppercase tracking-wider ${selectedModel === m ? 'text-white' : 'text-slate-200'}`}>
                            {m.split('-')[1].toUpperCase()} {m.split('-')[2]?.toUpperCase() || ''}
                          </div>
                          <div className="text-[9px] opacity-60 mt-0.5 font-medium">
                            {m.includes('pro') ? 'Deep Reasoning' : m.includes('lite') ? 'Ultra Low Latency' : 'Balanced Performance'}
                          </div>
                        </div>
                        {selectedModel === m && <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400" />}
                      </button>
                    ))}
                  </div>
                </div>

                {data.length > 0 && (
                  <div className="space-y-4 pt-2">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Part Number</label>
                      <select 
                        value={filters.partNumber} 
                        onChange={(e) => setFilters(f => ({ ...f, partNumber: e.target.value }))}
                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">Select Part...</option>
                        {availableParts && availableParts.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Vendor</label>
                      <select 
                        value={filters.vendor} 
                        onChange={(e) => setFilters(f => ({ ...f, vendor: e.target.value }))}
                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">Select Vendor...</option>
                        {availableVendors && availableVendors.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Country</label>
                      <select 
                        value={filters.country} 
                        onChange={(e) => setFilters(f => ({ ...f, country: e.target.value }))}
                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">Select Country...</option>
                        {availableCountries && availableCountries.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {activeTab === 'benchmark' && (
                <div className="space-y-6">
                  <div className="p-5 bg-indigo-50 rounded-2xl border border-indigo-100">
                    <label className="block text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-3">Benchmark Precision</label>
                    <div className="flex flex-col gap-2">
                      {[90, 95, 99].map(lvl => (
                        <button 
                          key={lvl}
                          onClick={() => setConfidenceLevel(lvl as ConfidenceLevel)}
                          className={`px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-between ${confidenceLevel === lvl ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-indigo-600 hover:bg-indigo-100 border border-indigo-100'}`}
                        >
                          {lvl}% Confidence Level
                          {confidenceLevel === lvl && <CheckCircle2 className="w-3 h-3" />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                      <Mail className="w-3 h-3 text-indigo-500" /> Report Distribution
                    </label>
                    <textarea
                      placeholder="Enter emails (comma separated)"
                      value={emailRecipients}
                      onChange={(e) => setEmailRecipients(e.target.value)}
                      className="w-full p-3 bg-white border border-slate-200 rounded-xl text-[10px] font-medium outline-none focus:ring-2 focus:ring-indigo-500 h-20 resize-none"
                    />
                    <p className="text-[9px] text-slate-400 mt-2 leading-tight italic">Enter recipient emails for formal review alerts.</p>
                  </div>
                </div>
              )}

              {data.length > 0 && activeTab === 'trends' && (
                <div className="pt-6 border-t border-slate-100 space-y-3">
                  <button 
                    onClick={handleRunForecast}
                    disabled={loading || !filters.partNumber || bulkLoading}
                    className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-xl ${loading ? 'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-100 shadow-indigo-200/50'}`}
                  >
                    {loading ? 'Thinking...' : <><Zap className="w-5 h-5 text-amber-400" /> Run Forecast</>}
                  </button>

                  <button 
                    onClick={handleGenerateAllForecasts}
                    disabled={bulkLoading || loading}
                    className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all border-2 ${bulkLoading ? 'bg-slate-50 text-slate-400 border-slate-100 cursor-not-allowed' : 'bg-white text-indigo-600 border-indigo-100 hover:border-indigo-300 hover:bg-indigo-50/30'}`}
                  >
                    {bulkLoading ? (
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex items-center gap-2">
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Batch Process...
                        </div>
                        <div className="w-32 h-1 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500" style={{ width: `${bulkProgress}%` }}></div>
                        </div>
                      </div>
                    ) : (
                      <><Layers className="w-4 h-4" /> Bulk Optimization</>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </aside>

        <main className="flex-1 overflow-y-auto p-10 bg-slate-50/50">
          {activeTab === 'trends' && data.length === 0 ? (
            <div className="max-w-4xl mx-auto space-y-12">
              <div className="text-center">
                <h2 className="text-4xl font-black text-slate-900 mb-4 tracking-tight">Supply Chain Intelligence</h2>
                <p className="text-slate-500 text-lg max-w-xl mx-auto leading-relaxed font-medium">Automate procurement forecasting and benchmark negotiation strategies with advanced AI.</p>
              </div>
              <DataUpload onDataLoaded={(newData) => { setData(newData); setIsCleansed(false); setAllForecasts([]); }} />
            </div>
          ) : (
            <div className="max-w-7xl mx-auto space-y-10">
              {(error || emailModeStatus) && (
                <div className={`p-5 rounded-2xl flex items-start gap-4 shadow-sm animate-in fade-in duration-300 ${error ? 'bg-rose-50 border border-rose-100 text-rose-700' : 'bg-emerald-50 border border-emerald-100 text-emerald-700'}`}>
                  {error ? <XCircle className="w-6 h-6 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" />}
                  <div className="flex-1">
                    <h3 className="text-sm font-black uppercase tracking-wider mb-1">{error ? 'Service Alert' : 'Success Notification'}</h3>
                    <p className="text-sm font-medium leading-relaxed">{error || emailModeStatus}</p>
                  </div>
                  <button onClick={() => { setError(null); setEmailModeStatus(null); }} className="font-bold p-1">✕</button>
                </div>
              )}

              {activeTab === 'trends' ? (
                <>
                  <div className="flex items-center justify-between">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 flex-1">
                      <StatsCard title="Data History" value={filteredHistory.length} icon={<Database className="w-5 h-5 text-indigo-600" />} color="bg-indigo-50" subtext={isCleansed ? "Outliers Removed" : "Raw Samples"} />
                      <StatsCard title="Price Projection" value={forecast ? `$${forecast.summary.avgPredictedPrice.toFixed(2)}` : '---'} icon={<TrendingUp className="w-5 h-5 text-violet-600" />} color="bg-violet-50" trend={forecast?.summary.priceTrend as any} />
                      <StatsCard title="Lead Time Forecast" value={forecast ? `${forecast.summary.avgPredictedLeadTime.toFixed(0)}d` : '---'} icon={<Clock className="w-5 h-5 text-blue-600" />} color="bg-blue-50" trend={forecast?.summary.leadTimeTrend as any} />
                      <StatsCard title="Optimal Order" value={forecast ? forecast.summary.optimizedOrderQuantity.toLocaleString() : '---'} icon={<Package className="w-5 h-5 text-emerald-600" />} color="bg-emerald-50" />
                    </div>
                    {allForecasts.length > 0 && (
                      <button 
                        onClick={exportForecasts}
                        className="ml-6 flex items-center gap-2 px-6 py-4 bg-slate-900 text-white text-xs font-bold rounded-2xl hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
                      >
                        <FileDown className="w-5 h-5" /> Export Repository
                      </button>
                    )}
                  </div>

                  {forecast ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm animate-in fade-in duration-500">
                        <h3 className="text-lg font-bold text-slate-900 mb-8 flex items-center justify-between">
                          Price Trend Visualization
                          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500 bg-indigo-50 px-3 py-1 rounded-full">{filters.partNumber}</span>
                        </h3>
                        <div className="h-[350px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={combinedData}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                              <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} axisLine={false} tickLine={false} dy={10} tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, {month:'short'})}/>
                              <YAxis stroke="#94a3b8" fontSize={11} axisLine={false} tickLine={false} tickFormatter={(val) => `$${val}`} />
                              <Tooltip contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'}} />
                              <Area type="monotone" dataKey="price" stroke="#4f46e5" strokeWidth={4} fill="#4f46e520" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm animate-in fade-in duration-500">
                        <h3 className="text-lg font-bold text-slate-900 mb-8 flex items-center justify-between">
                          Lead Time Forecast
                          <span className="text-[10px] font-black uppercase tracking-widest text-blue-500 bg-blue-50 px-3 py-1 rounded-full">{filters.vendor}</span>
                        </h3>
                        <div className="h-[350px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={combinedData}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                              <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} axisLine={false} tickLine={false} dy={10} />
                              <YAxis stroke="#94a3b8" fontSize={11} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}d`} />
                              <Bar dataKey="leadTime" barSize={32} radius={[8,8,0,0]} fill="#3b82f640" />
                              <Line type="monotone" dataKey="leadTime" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, fill: '#3b82f6' }} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white p-16 rounded-3xl border border-dashed border-slate-300 flex flex-col items-center text-center">
                      <div className="bg-slate-100 p-6 rounded-full mb-6">
                        <Zap className="w-12 h-12 text-slate-400" />
                      </div>
                      <h3 className="text-xl font-black text-slate-900 mb-2">Ready for Insights?</h3>
                      <p className="text-slate-500 max-w-sm font-medium">Use the control panel to select an AI model and run a forecast. You can also batch process all SKU combinations at once.</p>
                    </div>
                  )}
                </>
              ) : (
                /* TAB 2: BENCHMARK */
                <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
                  <div className="bg-white p-10 rounded-3xl border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-center gap-2 mb-4">
                      <Scale className="w-6 h-6 text-indigo-600" />
                      <h3 className="text-2xl font-black text-slate-900 tracking-tight">Negotiation Benchmark Center</h3>
                    </div>
                    <p className="text-slate-500 mb-10 text-center max-w-lg mx-auto font-medium">Benchmark proposed rates against AI baselines for Price and Lead Time, identifying potential outliers and strategy errors.</p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                      <div className="space-y-4 border-r border-slate-100 pr-10">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <Truck className="w-4 h-4 text-slate-400" />
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Step 1: Upload Negotiations</h4>
                          </div>
                          {proposedRates.length > 0 && (
                            <button 
                              onClick={() => setProposedRates([])}
                              className="text-[10px] font-black text-rose-500 hover:text-rose-700 uppercase tracking-widest transition-colors flex items-center gap-1"
                            >
                              <Eraser className="w-3 h-3" /> Clear
                            </button>
                          )}
                        </div>
                        <div className="flex flex-col gap-3">
                          <label className={`cursor-pointer px-6 py-5 rounded-2xl font-black text-sm flex items-center justify-center gap-3 transition-all border-2 ${proposedRates.length > 0 ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-slate-50 border-slate-200 hover:border-indigo-300 text-slate-600'}`}>
                            <Files className="w-5 h-5" /> {proposedRates.length > 0 ? `${proposedRates.length} Rates Loaded` : 'Bulk Import (CSV)'}
                            <input type="file" className="hidden" accept=".csv" multiple onChange={handleNegotiationUpload} />
                          </label>
                          <button 
                            onClick={downloadNegotiationTemplate} 
                            className="text-slate-400 text-[10px] font-bold flex items-center justify-center gap-2 hover:text-indigo-600 transition-all"
                          >
                            <Download className="w-3.5 h-3.5" /> Download Template
                          </button>
                        </div>
                      </div>

                      <div className="space-y-4 pl-0">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <Settings2 className="w-4 h-4 text-slate-400" />
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Step 2: Compare Baseline</h4>
                          </div>
                        </div>
                        <div className="flex flex-col gap-4">
                          <div className="flex bg-slate-100 p-1 rounded-xl">
                            <button 
                              onClick={() => setForecastSource('system')}
                              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${forecastSource === 'system' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                              <BrainCircuit className="w-4 h-4" /> System
                            </button>
                            <button 
                              onClick={() => setForecastSource('upload')}
                              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${forecastSource === 'upload' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                              <FileSpreadsheet className="w-4 h-4" /> Custom
                            </button>
                          </div>

                          <div className="space-y-4">
                            {/* Baseline Data Preview Snippet */}
                            <div className={`p-4 rounded-xl border-2 transition-all ${activeBaseline ? 'bg-slate-50 border-slate-100' : 'bg-slate-50/50 border-slate-100 border-dashed'}`}>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                                  <Activity className="w-3 h-3 text-indigo-500" /> 
                                  Baseline Snippet: {filters.partNumber || 'No Part Selected'}
                                </span>
                                {activeBaseline && (
                                  <span className="text-[8px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded uppercase">
                                    {forecastSource} Ready
                                  </span>
                                )}
                              </div>
                              
                              {activeBaseline ? (
                                <div className="grid grid-cols-2 gap-4 h-16">
                                  <div className="flex flex-col">
                                    <span className="text-[8px] font-bold text-slate-400 uppercase mb-1">Price Trend</span>
                                    <ResponsiveContainer width="100%" height="100%">
                                      <ComposedChart data={baselinePreviewData}>
                                        <XAxis dataKey="type" hide />
                                        <YAxis hide domain={['auto', 'auto']} />
                                        <Area type="monotone" dataKey="high" stroke="none" fill="#6366f1" fillOpacity={0.1} isAnimationActive={false} />
                                        <Line type="monotone" dataKey="val" stroke="#6366f1" strokeWidth={2} dot={false} isAnimationActive={false} />
                                      </ComposedChart>
                                    </ResponsiveContainer>
                                  </div>
                                  <div className="flex flex-col">
                                    <span className="text-[8px] font-bold text-slate-400 uppercase mb-1">Lead Time</span>
                                    <ResponsiveContainer width="100%" height="100%">
                                      <ComposedChart data={baselinePreviewData}>
                                        <XAxis dataKey="type" hide />
                                        <YAxis hide domain={['auto', 'auto']} />
                                        <Line type="stepAfter" dataKey="lt" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
                                      </ComposedChart>
                                    </ResponsiveContainer>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex flex-col items-center justify-center h-16 text-center">
                                  <Info className="w-4 h-4 text-slate-300 mb-1" />
                                  <p className="text-[9px] text-slate-400 font-medium leading-tight">Select SKU in sidebar to<br/>preview baseline intelligence.</p>
                                </div>
                              )}
                            </div>

                            {forecastSource === 'system' ? (
                              <div className={`p-3 rounded-xl border flex items-center justify-center gap-3 transition-all ${allForecasts.length > 0 ? 'bg-emerald-50/50 border-emerald-100 text-emerald-700 shadow-sm' : 'bg-slate-50 border-slate-100 text-slate-400 opacity-60'}`}>
                                {allForecasts.length > 0 ? (
                                  <><CheckCircle2 className="w-4 h-4" /><span className="text-[10px] font-black uppercase tracking-widest">{allForecasts.length} Models Active</span></>
                                ) : (
                                  <><AlertCircle className="w-4 h-4" /><span className="text-[10px] font-black uppercase tracking-widest">No Intelligence Data</span></>
                                )}
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <label className={`flex-1 cursor-pointer px-4 py-3 rounded-xl font-black text-xs flex items-center justify-center gap-3 transition-all border-2 ${uploadedForecasts.length > 0 ? 'bg-violet-50 border-violet-200 text-violet-700' : 'bg-slate-50 border-slate-200 hover:border-indigo-300 text-slate-600'}`}>
                                    <Upload className="w-4 h-4" /> {uploadedForecasts.length > 0 ? `${uploadedForecasts.length} SKUs Loaded` : 'Import Base'}
                                    <input type="file" className="hidden" accept=".csv" onChange={handleForecastUpload} />
                                  </label>
                                  {uploadedForecasts.length > 0 && (
                                    <button 
                                      onClick={() => setUploadedForecasts([])}
                                      className="p-3 bg-rose-50 border border-rose-100 text-rose-500 rounded-xl hover:bg-rose-100 transition-all shadow-sm"
                                      title="Clear Uploaded Baselines"
                                    >
                                      <Eraser className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                                {uploadedForecasts.length > 0 && (
                                  <div className="px-2 flex justify-between items-center text-[9px] font-black text-violet-400 uppercase tracking-widest">
                                    <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> Total Points: {totalUploadedPoints}</span>
                                    <CheckCircle className="w-3 h-3" />
                                  </div>
                                )}
                                <button onClick={downloadForecastTemplate} className="text-slate-400 text-[9px] font-bold hover:text-indigo-600 transition-all w-full text-center">
                                  Download Baseline CSV Format
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-12 pt-8 border-t border-slate-50 flex flex-col items-center">
                      <button 
                        onClick={runBenchmark}
                        disabled={loading || proposedRates.length === 0}
                        className={`px-16 py-4 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-2xl transition-all active:scale-95 ${loading ? 'bg-slate-300 shadow-none cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200/50'}`}
                      >
                        {loading ? 'AI Processing...' : 'Start Comparative Benchmark'}
                      </button>
                    </div>
                  </div>

                  {benchmarks.length > 0 && (
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div>
                          <h4 className="font-black text-slate-900 flex items-center gap-2 uppercase tracking-wider text-sm">
                            <Scale className="w-4 h-4 text-indigo-600" /> Negotiation Matrix
                          </h4>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                            {forecastSource === 'system' ? 'AI Baseline' : 'Manual Baseline'} • {confidenceLevel}% Confidence
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <button 
                            onClick={() => setShowAttentionOnly(!showAttentionOnly)}
                            className={`flex items-center gap-2 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl border-2 transition-all ${showAttentionOnly ? 'bg-amber-600 border-amber-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-amber-200 hover:bg-amber-50'}`}
                          >
                            <AlertTriangle className={`w-4 h-4 ${showAttentionOnly ? 'text-white' : 'text-amber-500'}`} />
                            Attention
                          </button>
                          
                          <div className="h-8 w-px bg-slate-200 hidden md:block" />
                          
                          <button 
                            onClick={exportBenchmarks}
                            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-all shadow-lg"
                          >
                            <FileDown className="w-4 h-4" /> CSV
                          </button>

                          <button 
                            onClick={handleCopyRichReport}
                            className={`flex items-center gap-2 px-4 py-2.5 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg ${copySuccess ? 'bg-emerald-600 shadow-emerald-100' : 'bg-violet-600 hover:bg-violet-700 shadow-violet-100'}`}
                            title="Copy colorful HTML report to clipboard"
                          >
                            {copySuccess ? <ClipboardCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            Copy Rich
                          </button>

                          <button 
                            onClick={handleSendEmail}
                            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                          >
                            <Send className="w-4 h-4" /> Email Alert
                          </button>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="bg-slate-50/50">
                              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Part & Vendor</th>
                              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Negotiated Price</th>
                              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Lead Time</th>
                              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">AI Strategic Feedback</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredBenchmarks.length > 0 ? filteredBenchmarks.map((b, i) => {
                              const isNoHistory = b.comment?.toLowerCase().includes('no history') || b.comment?.toLowerCase().includes('no comparative baseline');
                              return (
                                <tr key={i} className="group hover:bg-indigo-50/20 transition-all">
                                  <td className="px-8 py-6">
                                    <div className="text-sm font-black text-slate-800 tracking-tight">{b.partNumber}</div>
                                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{b.vendor} • {b.country}</div>
                                  </td>
                                  <td className="px-8 py-6 text-center">
                                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-black border-2 transition-colors min-w-[110px] justify-center ${getStatusColorClass(isNoHistory ? 'default' : b.priceStatus)}`}>
                                      {getStatusIcon(isNoHistory ? '' : b.priceStatus)}
                                      ${(b.proposedPrice || 0).toFixed(2)}
                                    </div>
                                  </td>
                                  <td className="px-8 py-6 text-center">
                                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-black border-2 transition-colors min-w-[90px] justify-center ${getStatusColorClass(isNoHistory ? 'default' : b.leadTimeStatus)}`}>
                                      {getStatusIcon(isNoHistory ? '' : b.leadTimeStatus)}
                                      {b.proposedLeadTime || 0}d
                                    </div>
                                  </td>
                                  <td className="px-8 py-6">
                                    <div className="flex gap-4 items-start bg-slate-50/50 p-4 rounded-xl group-hover:bg-white transition-all border border-transparent group-hover:border-slate-100">
                                      <div className="mt-0.5 bg-indigo-600 p-1.5 rounded-lg shadow-sm shrink-0">
                                        <BrainCircuit className="w-3 h-3 text-white" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className={`text-[11px] leading-relaxed font-semibold ${isNoHistory ? 'text-slate-400 italic' : 'text-slate-600'}`}>
                                          {b.comment || "Analysis unavailable."}
                                        </p>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              );
                            }) : (
                              <tr>
                                <td colSpan={4} className="px-8 py-20 text-center">
                                  <div className="flex flex-col items-center gap-3 text-slate-400 opacity-60">
                                    <Info className="w-10 h-10" />
                                    <p className="text-sm font-bold uppercase tracking-widest">No matching benchmark results</p>
                                    <button onClick={() => setShowAttentionOnly(false)} className="text-indigo-600 text-[10px] font-black uppercase tracking-widest hover:underline">Clear Filter</button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
