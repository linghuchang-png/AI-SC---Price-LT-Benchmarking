
import React, { useState, useMemo, useEffect } from 'react';
import { 
  TrendingUp, Clock, Database, Filter, Package, Truck, 
  Download, BrainCircuit, AlertCircle, Trash2, CheckCircle2, 
  History, Scale, Upload, Zap, Layers, RefreshCw, FileDown,
  XCircle, FileSpreadsheet, Settings2, AlertTriangle, CheckCircle, Info, Eraser, Files, Sparkles, Mail, Send, Copy, ClipboardCheck,
  Cpu, Activity, ShieldCheck, Key
} from 'lucide-react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Bar, ComposedChart, Line
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
  
  // Auth state
  const [isAiConnected, setIsAiConnected] = useState(false);
  
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

  // Check for API Key Connection
  useEffect(() => {
    const checkConnection = async () => {
      // 1. Check direct process.env (Standard Vercel Injection)
      const hasEnvKey = !!process.env.API_KEY && process.env.API_KEY.length > 5;
      
      // 2. Check AI Studio helper (Studio Preview Mode)
      const hasStudioKey = (window as any).aistudio ? await (window as any).aistudio.hasSelectedApiKey() : false;
      
      if (hasEnvKey || hasStudioKey) {
        setIsAiConnected(true);
      } else {
        setIsAiConnected(false);
      }
    };
    
    // Initial check + a small delay to handle Vercel hydration/injection timing
    checkConnection();
    const timer = setTimeout(checkConnection, 1000);
    return () => clearTimeout(timer);
  }, []);

  const handleConnectAi = async () => {
    const aiStudio = (window as any).aistudio;
    
    if (aiStudio) {
      try {
        await aiStudio.openSelectKey();
        setIsAiConnected(true);
        setError(null);
      } catch (err) {
        console.error("Key selection failed", err);
      }
    } else {
      // Fallback for when running directly on Vercel without Studio frame
      if (process.env.API_KEY) {
        setIsAiConnected(true);
        setError(null);
      } else {
        setError("API Key Missing: Please ensure the API_KEY environment variable is set in your Vercel Dashboard and the project has been re-deployed.");
      }
    }
  };

  const totalUploadedPoints = useMemo(() => {
    return uploadedForecasts.reduce((acc, f) => acc + f.forecast.length, 0);
  }, [uploadedForecasts]);

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
      setIsAiConnected(true); // Confirmation that key works
      setAllForecasts(prev => {
        const other = prev.filter(p => !(p.partNumber === result.partNumber && p.vendor === result.vendor && p.country === result.country));
        return [...other, result];
      });
      setForecast(result);
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("API Key") || msg.includes("401") || msg.includes("403")) {
        setIsAiConnected(false);
        setError("AI Connection Failed: The provided API Key is invalid or has expired.");
      } else {
        setError(msg || "An unexpected error occurred during forecasting.");
      }
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
      
      setIsAiConnected(true);
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
      setError(err.message || "Bulk processing encountered a failure.");
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
      setError("Failed to parse negotiation files.");
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const runBenchmark = async () => {
    if (proposedRates.length === 0) {
      setError("Input Required: Please upload negotiated rates first.");
      return;
    }
    
    const activeForecasts = forecastSource === 'system' ? allForecasts : uploadedForecasts;
    if (activeForecasts.length === 0) {
      setError(`Baseline Missing: Please ensure you have forecast data available.`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const results = await getBenchmarkAnalysis(proposedRates, activeForecasts, confidenceLevel);
      setIsAiConnected(true);
      setBenchmarks(results);
    } catch (err: any) {
      setError(err.message || "Benchmark analysis failed.");
    } finally {
      setLoading(false);
    }
  };

  const filteredHistory = useMemo(() => {
    return activeData
      .filter(d => d.partNumber === filters.partNumber && d.vendor === filters.vendor && d.country === filters.country)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [activeData, filters]);

  const combinedData = useMemo(() => {
    if (!forecast) return [];
    const history = filteredHistory.map(h => ({ date: h.date, price: h.usdPrice, leadTime: h.leadTimeDays, isForecast: false }));
    const future = forecast.forecast.map(f => ({ date: f.date, price: f.predictedPrice, leadTime: f.predictedLeadTime, isForecast: true }));
    return [...history, ...future];
  }, [filteredHistory, forecast]);

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
              <button onClick={() => setActiveTab('trends')} className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all ${activeTab === 'trends' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
                <History className="w-3.5 h-3.5" /> 1. Forecast & Trends
              </button>
              <button onClick={() => setActiveTab('benchmark')} className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all ${activeTab === 'benchmark' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
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
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">AI Connection</span>
               <button 
                 onClick={handleConnectAi}
                 className={`text-[10px] font-black uppercase flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all ${isAiConnected ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-rose-600 bg-rose-50 border-rose-100 hover:bg-rose-100'}`}
               >
                 {isAiConnected ? <ShieldCheck className="w-3 h-3" /> : <Key className="w-3 h-3 animate-pulse" />}
                 {isAiConnected ? 'Authenticated' : 'Connect API'}
               </button>
             </div>
             <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 rounded-xl text-white text-xs font-bold shadow-lg shadow-slate-200">
               <div className={`w-1.5 h-1.5 rounded-full ${isAiConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} /> Agent {isAiConnected ? 'Ready' : 'Paused'}
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
                <button onClick={handleCleanse} className="w-full py-3 bg-rose-50 border border-rose-100 text-rose-600 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-rose-100 transition-all">
                  <Trash2 className="w-4 h-4" /> Cleanse Outliers
                </button>
              )}

              <div className="space-y-4">
                <div className="p-5 bg-slate-900 rounded-2xl border border-slate-800 shadow-xl">
                  <label className="flex items-center gap-2 text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4">
                    <Cpu className="w-3 h-3" /> Intelligence Tier
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
                        </div>
                        {selectedModel === m && <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 pt-2">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Part Number</label>
                    <select value={filters.partNumber} onChange={(e) => setFilters(f => ({ ...f, partNumber: e.target.value }))} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="">Select Part...</option>
                      {availableParts.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Vendor</label>
                    <select value={filters.vendor} onChange={(e) => setFilters(f => ({ ...f, vendor: e.target.value }))} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="">Select Vendor...</option>
                      {availableVendors.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {data.length > 0 && activeTab === 'trends' && (
                <div className="pt-6 border-t border-slate-100 space-y-3">
                  <button 
                    onClick={handleRunForecast}
                    disabled={loading || !filters.partNumber || bulkLoading}
                    className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-xl ${loading ? 'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-100 shadow-indigo-200/50'}`}
                  >
                    {loading ? 'Processing...' : <><Zap className="w-5 h-5 text-amber-400" /> Run Forecast</>}
                  </button>
                  <button 
                    onClick={handleGenerateAllForecasts}
                    disabled={bulkLoading || loading}
                    className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all border-2 ${bulkLoading ? 'bg-slate-50 text-slate-400 border-slate-100 cursor-not-allowed' : 'bg-white text-indigo-600 border-indigo-100 hover:border-indigo-300 hover:bg-indigo-50/30'}`}
                  >
                    {bulkLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <><Layers className="w-4 h-4" /> Bulk Optimization</>}
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
                  <div className="flex-1">
                    <h3 className="text-sm font-black uppercase tracking-wider mb-1">{error ? 'Service Alert' : 'Success Notification'}</h3>
                    <p className="text-sm font-medium leading-relaxed">{error || emailModeStatus}</p>
                  </div>
                  <button onClick={() => { setError(null); setEmailModeStatus(null); }} className="font-bold p-1">✕</button>
                </div>
              )}

              {activeTab === 'trends' ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatsCard title="Data Points" value={filteredHistory.length} icon={<Database className="w-5 h-5 text-indigo-600" />} color="bg-indigo-50" />
                    <StatsCard title="Price Trend" value={forecast ? `$${forecast.summary.avgPredictedPrice.toFixed(2)}` : '---'} icon={<TrendingUp className="w-5 h-5 text-violet-600" />} color="bg-violet-50" trend={forecast?.summary.priceTrend as any} />
                    <StatsCard title="Lead Time" value={forecast ? `${forecast.summary.avgPredictedLeadTime.toFixed(0)}d` : '---'} icon={<Clock className="w-5 h-5 text-blue-600" />} color="bg-blue-50" trend={forecast?.summary.leadTimeTrend as any} />
                    <StatsCard title="Optimal Qty" value={forecast ? forecast.summary.optimizedOrderQuantity.toLocaleString() : '---'} icon={<Package className="w-5 h-5 text-emerald-600" />} color="bg-emerald-50" />
                  </div>

                  {forecast ? (
                    <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm animate-in fade-in duration-500">
                      <h3 className="text-lg font-bold text-slate-900 mb-8 flex items-center justify-between">
                        Consolidated Logistics View
                        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500 bg-indigo-50 px-3 py-1 rounded-full">{filters.partNumber}</span>
                      </h3>
                      <div className="h-[450px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={combinedData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} axisLine={false} tickLine={false} dy={10} />
                            <YAxis yAxisId="left" stroke="#94a3b8" fontSize={11} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                            <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" fontSize={11} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}d`} />
                            <Tooltip />
                            <Area yAxisId="left" type="monotone" dataKey="price" stroke="#4f46e5" strokeWidth={4} fill="#4f46e520" />
                            <Bar yAxisId="right" dataKey="leadTime" fill="#3b82f640" radius={[4,4,0,0]} barSize={20} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white p-16 rounded-3xl border border-dashed border-slate-300 flex flex-col items-center text-center">
                      <Zap className="w-12 h-12 text-slate-400 mb-4" />
                      <h3 className="text-xl font-black text-slate-900 mb-2">Initialize Analytics</h3>
                      <p className="text-slate-500 max-w-sm font-medium">Select a part and model from the control panel to generate predictive insights.</p>
                    </div>
                  )}
                </>
              ) : (
                /* TAB 2: BENCHMARK */
                <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
                  <div className="bg-white p-10 rounded-3xl border border-slate-200 shadow-sm text-center">
                    <Scale className="w-8 h-8 text-indigo-600 mx-auto mb-4" />
                    <h3 className="text-2xl font-black text-slate-900 tracking-tight">Strategy Benchmarking</h3>
                    <p className="text-slate-500 max-w-lg mx-auto mb-10 font-medium">Upload proposed vendor rates to compare against current AI market baselines.</p>
                    <div className="flex justify-center gap-4">
                      <label className="cursor-pointer px-6 py-4 bg-slate-900 text-white text-xs font-bold rounded-2xl hover:bg-slate-800 transition-all shadow-xl">
                        Import Proposed Rates (CSV)
                        <input type="file" className="hidden" accept=".csv" onChange={handleNegotiationUpload} />
                      </label>
                      <button onClick={runBenchmark} disabled={proposedRates.length === 0} className={`px-6 py-4 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all ${proposedRates.length === 0 ? 'bg-slate-100 text-slate-400' : 'bg-indigo-600 text-white shadow-xl hover:bg-indigo-700'}`}>
                        Run AI Comparison
                      </button>
                    </div>
                  </div>
                  
                  {benchmarks.length > 0 && (
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Target SKU</th>
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Price Status</th>
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Lead Time Status</th>
                            <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">AI Advisory</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {benchmarks.map((b, i) => (
                            <tr key={i} className="hover:bg-indigo-50/20">
                              <td className="px-8 py-6">
                                <div className="text-sm font-black text-slate-800">{b.partNumber}</div>
                                <div className="text-[10px] text-slate-400 uppercase tracking-widest">{b.vendor}</div>
                              </td>
                              <td className="px-8 py-6">
                                <span className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${b.priceStatus === 'favorable' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
                                  {b.priceStatus} (${b.proposedPrice})
                                </span>
                              </td>
                              <td className="px-8 py-6">
                                <span className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${b.leadTimeStatus === 'favorable' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>
                                  {b.leadTimeStatus} ({b.proposedLeadTime}d)
                                </span>
                              </td>
                              <td className="px-8 py-6 text-xs text-slate-600 leading-relaxed font-medium">{b.comment}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
