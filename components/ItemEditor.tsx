
import React, { useState, useEffect } from 'react';
import { QuoteItem, AppConfig, InventoryPart, User } from '../types.ts';
import { InventoryPicker } from './InventoryPicker.tsx';

interface ItemEditorProps {
  items: QuoteItem[];
  config: AppConfig;
  onUpdate: (items: QuoteItem[]) => void;
  onDeleteItem: (index: number) => void;
  currentUser: User | null;
}

export const ItemEditor: React.FC<ItemEditorProps> = ({ items, config, onUpdate, onDeleteItem, currentUser }) => {
  // Use local state to manage string values for inputs to allow typing decimals like "10."
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  useEffect(() => {
    // Sync local values when items change externally (e.g. on load or blur)
    const nextLocal: Record<string, string> = {};
    items.forEach((item, idx) => {
      nextLocal[`${idx}-unitPrice`] = item.unitPrice.toString();
      nextLocal[`${idx}-weight`] = item.weight.toString();
      nextLocal[`${idx}-coreDeposit`] = (item.coreDeposit || 0).toString();
    });
    setLocalValues(nextLocal);
  }, [items]);

  const handleChange = (index: number, field: keyof QuoteItem, value: any) => {
    const newItems = [...items];
    
    if (field === 'qty') {
      newItems[index] = { ...newItems[index], [field]: parseInt(value) || 0 };
      onUpdate(newItems);
    } else if (field === 'unitPrice' || field === 'weight' || field === 'coreDeposit') {
      // Update local string state immediately to allow natural typing
      setLocalValues(prev => ({ ...prev, [`${index}-${field}`]: value }));
      
      // Update real state if it's a valid number
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        newItems[index] = { ...newItems[index], [field]: numValue };
        onUpdate(newItems);
      }
    } else {
      newItems[index] = { ...newItems[index], [field]: value };
      onUpdate(newItems);
    }
  };

  const handleBlur = (index: number, field: keyof QuoteItem, value: string) => {
    if (field === 'unitPrice' || field === 'weight' || field === 'coreDeposit') {
      const newItems = [...items];
      // Apply professional rounding on blur to normalize the data
      const roundedValue = Math.round((parseFloat(value) || 0) * 100) / 100;
      newItems[index] = { ...newItems[index], [field]: roundedValue };
      onUpdate(newItems);
      
      // Update local value to the rounded string
      setLocalValues(prev => ({ ...prev, [`${index}-${field}`]: roundedValue.toString() }));
    }
  };
  
  const handleAddItem = () => {
    const newItem: QuoteItem = {
      qty: 1,
      partNo: 'NEW-ITEM',
      desc: 'ENTER DESCRIPTION',
      weight: 0,
      unitPrice: 0,
      coreDeposit: 0,
      originalImages: [],
    };
    onUpdate([...items, newItem]);
  };

  const handleSelectFromInventory = (part: InventoryPart) => {
    const newItem: QuoteItem = {
      qty: 1,
      partNo: part.partNo,
      desc: part.description,
      weight: 0,
      unitPrice: part.originalPrice,
      coreDeposit: 0,
      originalImages: part.originalImages || [],
      aiImageUrl: part.imageUrl
    };
    onUpdate([...items, newItem]);
    setIsPickerOpen(false);
  };


  if (items.length === 0) return null;

  return (
    <div className="max-w-[1200px] mx-auto px-4 mb-20 no-print fade-in delay-100">
      <div className="card-app p-8 border-t-[6px] border-t-cat-black shadow-[0_10px_40px_rgba(0,0,0,0.04)]">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h3 className="text-[14px] font-black uppercase tracking-[0.2em] text-cat-black">Operational Manifest</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1.5">Inspecting {items.length} Engineering Units</p>
          </div>
          <div className="flex gap-4">
            {currentUser && (
              <button 
                onClick={() => setIsPickerOpen(true)}
                className="px-4 py-2 bg-cat-black text-cat-yellow text-[10px] font-black uppercase tracking-widest rounded-xl border border-cat-black hover:bg-cat-gray transition-all shadow-xl flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                Browse Inventory
              </button>
            )}
            <div className="px-4 py-2 bg-cat-yellow/10 text-[10px] font-black text-cat-black uppercase tracking-widest rounded-xl border border-cat-yellow/20">
              Validated Status
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {items.map((item, idx) => (
            <div key={idx} className="group p-6 bg-slate-50/80 rounded-2xl border border-slate-200/60 hover:border-cat-yellow hover:bg-white hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all duration-300 flex flex-col md:flex-row gap-6 items-center">
              <div className="w-10 h-10 bg-cat-black rounded-xl flex items-center justify-center text-[11px] font-mono font-bold text-cat-yellow shadow-inner flex-shrink-0">
                {(idx + 1).toString().padStart(2, '0')}
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 flex-grow w-full">
                <div className="md:col-span-3 space-y-1.5">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Serial/Part#</span>
                  <input 
                    className="w-full h-[40px] bg-white border border-slate-200 rounded-lg font-mono font-bold text-[13px] text-cat-black outline-none uppercase px-3 focus:ring-2 focus:ring-cat-yellow/30 focus:border-cat-yellow transition-all shadow-sm"
                    value={item.partNo}
                    onChange={(e) => handleChange(idx, 'partNo', e.target.value)}
                  />
                </div>
                <div className="md:col-span-4 space-y-1.5">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Component Desc</span>
                  <input 
                    className="w-full h-[40px] bg-white border border-slate-200 rounded-lg text-[13px] font-bold text-cat-black outline-none uppercase px-3 focus:ring-2 focus:ring-cat-yellow/30 focus:border-cat-yellow transition-all shadow-sm"
                    value={item.desc}
                    onChange={(e) => handleChange(idx, 'desc', e.target.value)}
                  />
                </div>
                <div className="md:col-span-5 grid grid-cols-5 gap-4">
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Qty</span>
                    <input 
                      type="number"
                      className="w-full h-[40px] bg-white border border-slate-200 rounded-lg font-mono font-bold text-[13px] text-cat-black outline-none text-center focus:ring-2 focus:ring-cat-yellow/30 focus:border-cat-yellow transition-all shadow-sm"
                      value={item.qty}
                      onChange={(e) => handleChange(idx, 'qty', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Unit Val ($)</span>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-[12px]">$</span>
                      <input 
                        type="text"
                        className="w-full h-[40px] bg-white border border-slate-200 rounded-lg font-mono font-bold text-[13px] text-cat-black outline-none text-right pl-7 pr-3 focus:ring-2 focus:ring-cat-yellow/30 focus:border-cat-yellow transition-all shadow-sm"
                        value={localValues[`${idx}-unitPrice`] || item.unitPrice.toString()}
                        onChange={(e) => handleChange(idx, 'unitPrice', e.target.value)}
                        onBlur={(e) => handleBlur(idx, 'unitPrice', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Wgt</span>
                    <input 
                      type="text"
                      className="w-full h-[40px] bg-white border border-slate-200 rounded-lg font-mono font-bold text-[13px] text-cat-black outline-none text-right px-3 focus:ring-2 focus:ring-cat-yellow/30 focus:border-cat-yellow transition-all shadow-sm"
                      value={localValues[`${idx}-weight`] || item.weight.toString()}
                      onChange={(e) => handleChange(idx, 'weight', e.target.value)}
                      onBlur={(e) => handleBlur(idx, 'weight', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Core ($)</span>
                    <input 
                      type="text"
                      className="w-full h-[40px] bg-white border border-slate-200 rounded-lg font-mono font-bold text-[13px] text-cat-black outline-none text-right px-3 focus:ring-2 focus:ring-cat-yellow/30 focus:border-cat-yellow transition-all shadow-sm"
                      value={localValues[`${idx}-coreDeposit`] || (item.coreDeposit || 0).toString()}
                      onChange={(e) => handleChange(idx, 'coreDeposit', e.target.value)}
                      onBlur={(e) => handleBlur(idx, 'coreDeposit', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <button 
                onClick={() => onDeleteItem(idx)}
                className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-red-500 rounded-xl transition-all btn-app flex-shrink-0"
                title="Remove Item"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
              </button>
            </div>
          ))}
        </div>
        <button 
          onClick={handleAddItem}
          className="w-full mt-6 py-5 border-2 border-dashed border-slate-200 rounded-2xl text-[11px] font-black uppercase tracking-widest text-slate-400 hover:border-cat-yellow hover:text-cat-black hover:bg-cat-yellow/5 transition-all duration-300"
        >
          + Add Engineering Unit
        </button>
      </div>

      {currentUser && (
        <InventoryPicker 
          isOpen={isPickerOpen}
          onClose={() => setIsPickerOpen(false)}
          onSelect={handleSelectFromInventory}
          currentUser={currentUser}
        />
      )}
    </div>
  );
};