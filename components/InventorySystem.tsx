import React, { useState, useEffect } from 'react';
import { InventoryPart, User } from '../types.ts';
import { dbService } from '../services/dbService.ts';
import { exportInventory } from '../services/exportService.ts';
import { Download, FileJson, FileSpreadsheet, FileText } from 'lucide-react';

interface InventorySystemProps {
  currentUser: User;
}

export const InventorySystem: React.FC<InventorySystemProps> = ({ currentUser }) => {
  const [inventory, setInventory] = useState<InventoryPart[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);

  useEffect(() => {
    loadInventory();
  }, [currentUser]);

  const loadInventory = async () => {
    setIsLoading(true);
    try {
      const data = await dbService.getInventory(currentUser.username);
      setInventory(data);
    } catch (error) {
      console.error("Failed to load inventory:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(inventory, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `iron-hub-inventory-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string);
        if (Array.isArray(importedData)) {
          await dbService.saveInventory(currentUser.username, importedData);
          setInventory(importedData);
          alert("Inventory imported successfully.");
        } else {
          throw new Error("Invalid format");
        }
      } catch (error) {
        alert("Failed to import inventory. Please ensure it is a valid JSON array of parts.");
      }
    };
    reader.readAsText(file);
  };

  const filteredInventory = inventory.filter(part => 
    part.partNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
    part.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    part.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="max-w-[1200px] mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter text-cat-black">Parts Database</h1>
          <p className="text-slate-500 text-sm font-bold uppercase tracking-widest mt-1">Global Inventory Index</p>
        </div>
        <div className="flex gap-4 relative">
          <div className="relative">
            <button 
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="px-6 py-3 bg-white border border-slate-200 text-cat-black rounded-xl font-black text-[10px] uppercase tracking-widest hover:border-cat-yellow transition-all shadow-sm flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export Data
            </button>
            
            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-slate-100 p-2 z-50 animate-in fade-in zoom-in-95">
                <button 
                  onClick={() => { exportInventory(inventory, 'excel'); setShowExportMenu(false); }}
                  className="w-full text-left px-4 py-3 text-[10px] font-black uppercase rounded-xl hover:bg-cat-yellow/10 hover:text-cat-black flex items-center gap-3 transition-colors"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  Excel (.xlsx)
                </button>
                <button 
                  onClick={() => { exportInventory(inventory, 'csv'); setShowExportMenu(false); }}
                  className="w-full text-left px-4 py-3 text-[10px] font-black uppercase rounded-xl hover:bg-cat-yellow/10 hover:text-cat-black flex items-center gap-3 transition-colors"
                >
                  <FileText className="w-4 h-4 text-blue-600" />
                  CSV (.csv)
                </button>
                <button 
                  onClick={() => { handleExport(); setShowExportMenu(false); }}
                  className="w-full text-left px-4 py-3 text-[10px] font-black uppercase rounded-xl hover:bg-cat-yellow/10 hover:text-cat-black flex items-center gap-3 transition-colors"
                >
                  <FileJson className="w-4 h-4 text-amber-600" />
                  JSON (.json)
                </button>
              </div>
            )}
          </div>
          
          <label className="px-6 py-3 bg-cat-black text-cat-yellow rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-cat-dark transition-all shadow-xl cursor-pointer flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
            Import JSON
            <input type="file" accept=".json" className="hidden" onChange={handleImport} />
          </label>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <div className="relative max-w-md">
            <input 
              type="text" 
              placeholder="Search by Part No, SKU, or Description..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-cat-yellow focus:ring-4 focus:ring-cat-yellow/10 transition-all"
            />
            <svg className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-500 w-24">Image</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-500">SKU (AI)</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-500">Part No</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-500">Description</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-500 text-right">Original Price</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-slate-500 font-medium">Loading inventory...</td>
                </tr>
              ) : filteredInventory.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-slate-500 font-medium">No parts found in inventory.</td>
                </tr>
              ) : (
                filteredInventory.map((part) => (
                  <tr key={part.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                    <td className="p-4">
                      {part.imageUrl ? (
                        <div className="w-12 h-12 rounded-lg border border-slate-200 overflow-hidden bg-white">
                          <img src={part.imageUrl} alt={part.partNo} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-lg border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-400">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      <span className="font-mono text-xs font-bold text-cat-black bg-slate-100 px-2 py-1 rounded">{part.id}</span>
                    </td>
                    <td className="p-4 font-bold text-cat-black">{part.partNo}</td>
                    <td className="p-4 text-sm text-slate-600">{part.description}</td>
                    <td className="p-4 text-right font-mono font-bold text-cat-black">
                      ${part.originalPrice.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
