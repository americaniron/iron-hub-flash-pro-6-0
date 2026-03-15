import React, { useState, useEffect } from 'react';
import { InventoryPart, QuoteItem, User } from '../types.ts';
import { dbService } from '../services/dbService.ts';

interface InventoryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (part: InventoryPart) => void;
  currentUser: User;
}

export const InventoryPicker: React.FC<InventoryPickerProps> = ({ isOpen, onClose, onSelect, currentUser }) => {
  const [inventory, setInventory] = useState<InventoryPart[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadInventory();
    }
  }, [isOpen, currentUser]);

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

  const filteredInventory = inventory.filter(part => 
    part.partNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
    part.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    part.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
      <div className="absolute inset-0 bg-cat-black/60 backdrop-blur-md" onClick={onClose}></div>
      
      <div className="relative w-full max-w-4xl bg-white rounded-[2.5rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-white/20">
        {/* Header */}
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div>
            <h2 className="text-2xl font-black uppercase tracking-tighter text-cat-black">Inventory Index</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Select Engineering Unit to Add</p>
          </div>
          <button onClick={onClose} className="w-12 h-12 rounded-full bg-white shadow-lg border border-slate-200 flex items-center justify-center hover:bg-cat-black hover:text-white transition-all">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        {/* Search */}
        <div className="p-6 border-b border-slate-100">
          <div className="relative">
            <input 
              type="text" 
              placeholder="Search by Part No, SKU, or Description..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-cat-black outline-none focus:bg-white focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm"
            />
            <svg className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </div>
        </div>

        {/* List */}
        <div className="flex-grow overflow-y-auto p-6 custom-scrollbar">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-12 h-12 border-4 border-slate-100 border-t-cat-black rounded-full animate-spin mb-4"></div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Syncing Global Inventory...</p>
            </div>
          ) : filteredInventory.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-slate-400 font-bold uppercase tracking-widest text-[11px]">No matching units found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredInventory.map((part) => (
                <button 
                  key={part.id}
                  onClick={() => onSelect(part)}
                  className="flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-2xl hover:border-cat-yellow hover:shadow-xl hover:scale-[1.02] transition-all text-left group"
                >
                  <div className="w-16 h-16 rounded-xl border border-slate-100 overflow-hidden bg-slate-50 flex-shrink-0">
                    {part.imageUrl ? (
                      <img src={part.imageUrl} alt={part.partNo} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-grow min-w-0">
                    <div className="flex justify-between items-start">
                      <span className="text-[10px] font-black text-cat-black bg-cat-yellow/20 px-2 py-0.5 rounded uppercase tracking-widest">{part.partNo}</span>
                      <span className="text-[11px] font-mono font-bold text-cat-black">${part.originalPrice.toFixed(2)}</span>
                    </div>
                    <p className="text-[12px] font-bold text-slate-600 mt-1 truncate">{part.description}</p>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">ID: {part.id}</p>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 group-hover:bg-cat-black group-hover:text-cat-yellow transition-all">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4"></path></svg>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
