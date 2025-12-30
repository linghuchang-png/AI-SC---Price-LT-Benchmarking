
import React, { useRef } from 'react';
import { Upload, FileText, Download, Table } from 'lucide-react';
import { parseCSV, generateSampleData, generateSampleCSV } from '../services/dataService';
import { HistoricalData } from '../types';

interface DataUploadProps {
  onDataLoaded: (data: HistoricalData[]) => void;
}

const DataUpload: React.FC<DataUploadProps> = ({ onDataLoaded }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length > 0) {
        onDataLoaded(parsed);
      } else {
        alert("Could not parse CSV. Please ensure the headers match the template.");
      }
    };
    reader.readAsText(file);
  };

  const handleSampleData = () => {
    const sample = generateSampleData(150);
    onDataLoaded(sample);
  };

  const handleDownloadTemplate = (e: React.MouseEvent) => {
    e.stopPropagation();
    const csv = generateSampleCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "procurement_history_template.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      <div 
        className="bg-white p-10 rounded-2xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center space-y-6 hover:border-indigo-400 hover:bg-slate-50/50 transition-all cursor-pointer group" 
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="bg-indigo-50 p-5 rounded-2xl group-hover:scale-110 group-hover:bg-indigo-100 transition-all duration-300">
          <Upload className="w-10 h-10 text-indigo-600" />
        </div>
        
        <div className="text-center max-w-sm">
          <h3 className="text-xl font-bold text-slate-900">Import Procurement Records</h3>
          <p className="text-slate-500 text-sm mt-2 leading-relaxed">
            Drag and drop your file here or click to browse. Supports CSV files containing part numbers, pricing, and lead times.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <button 
            className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all active:scale-95"
          >
            Choose CSV File
          </button>
          
          <button 
            onClick={handleDownloadTemplate}
            className="bg-white text-slate-700 border border-slate-200 px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-95"
            title="Download a pre-formatted template with 100 rows of sample data"
          >
            <Download className="w-4 h-4 text-slate-500" />
            Download Template
          </button>
        </div>

        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept=".csv"
          onChange={handleFileUpload}
        />
      </div>

      <div className="flex items-center justify-center gap-3">
        <div className="h-px bg-slate-200 flex-1"></div>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Or test immediately</span>
        <div className="h-px bg-slate-200 flex-1"></div>
      </div>

      <div className="flex justify-center">
        <button 
          onClick={(e) => { e.stopPropagation(); handleSampleData(); }}
          className="group flex items-center gap-2 text-slate-500 hover:text-indigo-600 font-bold text-xs transition-colors"
        >
          <Table className="w-3.5 h-3.5" />
          Populate App with 150 Synthetic Data Points
        </button>
      </div>
    </div>
  );
};

export default DataUpload;
