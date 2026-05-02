
import React, { useState, useRef, useEffect } from 'react';
import { AppConfig, ClientInfo, ParseMode, QuoteItem, CustomerAccount, User, PhotoMode, SavedQuote, SyncStatus } from '../types.ts';
import { parseTextData, parsePdfFile, parseExcelFile } from '../services/parserService.ts';
import { performIntelligentTask } from '../services/claudeService.ts';
import { Logo } from './Logo.tsx';
import { Country, City } from 'country-state-city';

// --- High-Fidelity UI Components ---

const CustomSelect: React.FC<{
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}> = ({ options, value, onChange, placeholder }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [ref]);

  const selectedOption = options.find(opt => opt.value === value);
  const selectedLabel = selectedOption ? selectedOption.label : placeholder || 'Select...';

  const filteredOptions = options.filter(opt => opt.label.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setIsOpen(!isOpen); setSearch(""); }}
        className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl text-[13px] font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all flex items-center justify-between text-left shadow-sm hover:border-slate-300"
      >
        <span className={selectedOption ? "text-cat-black" : "text-slate-400"}>{selectedLabel}</span>
        <svg className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"></path></svg>
      </button>
      {isOpen && (
        <div className="absolute top-full mt-2 w-full bg-white rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.08)] border border-slate-100 p-2 z-50 animate-in fade-in zoom-in-95 duration-200">
          {options.length > 10 && (
            <div className="mb-2 px-2">
              <input 
                type="text" 
                placeholder="Search..." 
                className="w-full h-[36px] px-3 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-lg text-[12px] font-bold focus:bg-white outline-none focus:border-cat-yellow transition-all"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          <div className="max-h-[240px] overflow-y-auto pr-1 custom-scrollbar">
            {filteredOptions.length > 0 ? filteredOptions.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-4 py-3 text-[13px] font-bold rounded-xl flex items-center justify-between transition-all ${value === option.value ? 'bg-cat-yellow/10 text-cat-black' : 'text-slate-600 hover:bg-slate-50 hover:text-cat-black'}`}
              >
                {option.label}
                {value === option.value && <svg className="w-4 h-4 text-cat-yellow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
              </button>
            )) : (
              <div className="px-4 py-3 text-[12px] text-slate-400 font-bold text-center">No results found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const Switch: React.FC<{ enabled: boolean; onChange: (enabled: boolean) => void; }> = ({ enabled, onChange }) => {
    return (
        <button
            type="button"
            onClick={() => onChange(!enabled)}
            className={`relative inline-flex items-center h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-cat-yellow/30 ${enabled ? 'bg-cat-black' : 'bg-slate-200'}`}
        >
            <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-300 ease-in-out ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
            />
        </button>
    );
};

// --- Main Panel ---

interface ConfigPanelProps {
  itemsCount: number;
  onDataLoaded: (items: QuoteItem[]) => void;
  onConfigChange: (config: AppConfig) => void;
  onClientChange: (info: ClientInfo) => void;
  onAnalyze: (thinking?: boolean) => void;
  onSaveQuote: () => void;
  onLoadQuote: (file: File) => void;
  onSaveDraft: (options: any) => void;
  onResumeDraft: () => void;
  onCommitToCloud: () => void;
  onPrint: () => void;
  onEmailDispatch: () => void;
  onWhatsAppQuote: () => void;
  onConvertToInvoice: () => void;
  onGenerateAllImages: () => void;
  onExportData: () => void;
  onDownloadImagePool: () => void;
  onImportData: (file: File) => void;
  hasDraft: boolean;
  isAnalyzing: boolean;
  isGeneratingImages: boolean;
  config: AppConfig;
  client: ClientInfo;
  customLogo: string | null;
  onLogoUpload: (logo: string) => void;
  onRefreshId?: () => void;
  addressBook: CustomerAccount[];
  onSaveToBook: (client: ClientInfo) => void;
  onDeleteFromBook: (id: string) => void;
  quoteHistory: SavedQuote[];
  onLoadFromArchive: (quote: SavedQuote) => void;
  onDeleteFromArchive: (id: string) => void;
  currentUser: User;
  onLogout: () => void;
  syncStatus: SyncStatus;
}

const SectionTitle: React.FC<{ title: string; subtitle?: string; colorClass?: string }> = ({ title, subtitle, colorClass = "text-cat-black" }) => (
  <div className="section-header">
    <div>
      <h3 className={`text-[13px] font-black uppercase tracking-[0.2em] ${colorClass}`}>{title}</h3>
      {subtitle && <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">{subtitle}</p>}
    </div>
  </div>
);

const AppInput: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
  <div className={`space-y-2 ${className}`}>
    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">{label}</label>
    {children}
  </div>
);

export const ConfigPanel: React.FC<ConfigPanelProps> = (props) => {
  const [activeTab, setActiveTab] = useState<ParseMode>(ParseMode.PDF);
  const [textInput, setTextInput] = useState("");
  const [status, setStatus] = useState("Idle");
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [bookSearch, setBookSearch] = useState("");
  const [useThinking, setUseThinking] = useState(false);
  const [intelTask, setIntelTask] = useState("");
  const [intelResult, setIntelResult] = useState("");
  const [isIntelWorking, setIsIntelWorking] = useState(false);
  const [shippingSameAsBilling, setShippingSameAsBilling] = useState(true);
  const [isSavedToBook, setIsSavedToBook] = useState(false);

  const countryOptions = Country.getAllCountries().map(c => ({ value: c.isoCode, label: c.name }));
  const billingCityOptions = props.client.billingCountry ? City.getCitiesOfCountry(props.client.billingCountry)?.map(c => ({ value: c.name, label: c.name })) || [] : [];
  const shippingCityOptions = props.client.shippingCountry ? City.getCitiesOfCountry(props.client.shippingCountry)?.map(c => ({ value: c.name, label: c.name })) || [] : [];

  useEffect(() => {
    if (shippingSameAsBilling) {
      props.onClientChange({
        ...props.client,
        shippingAddress: props.client.billingAddress,
        shippingCity: props.client.billingCity,
        shippingState: props.client.billingState,
        shippingZip: props.client.billingZip,
        shippingCountry: props.client.billingCountry,
      });
    }
  }, [shippingSameAsBilling, props.client.billingAddress, props.client.billingCity, props.client.billingState, props.client.billingZip, props.client.billingCountry]);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const localLoadInputRef = useRef<HTMLInputElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const handleLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        if (loadEvent.target?.result) {
          props.onLogoUpload(loadEvent.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLocalFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      props.onLoadQuote(file);
      if (event.target) event.target.value = ''; // Reset input
    }
  };

  const handleImportFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      props.onImportData(file);
      if (event.target) event.target.value = ''; // Reset input so same file can be selected again
    }
  };

  const handleSaveToDirectory = () => {
    if (props.client.company) {
      props.onSaveToBook(props.client);
      setIsSavedToBook(true);
      setTimeout(() => setIsSavedToBook(false), 2000);
    }
  };

  const handleProcess = async (file?: File) => {
    setStatus("Processing");
    try {
        if (activeTab === ParseMode.PASTE) {
            const items = parseTextData(textInput);
            if (items.length > 0) props.onDataLoaded(items);
        } else if (activeTab === ParseMode.PDF) {
            const pdfFile = file || pdfInputRef.current?.files?.[0];
            if (pdfFile) {
                const { items } = await parsePdfFile(pdfFile);
                if (items.length > 0) props.onDataLoaded(items);
            }
        } else if (activeTab === ParseMode.EXCEL) {
            const excelFile = file || excelInputRef.current?.files?.[0];
            if (excelFile) {
                const items = await parseExcelFile(excelFile);
                if (items.length > 0) props.onDataLoaded(items);
            }
        }
        setStatus("Complete");
    } catch (err) {
        console.error("Parsing Error:", err);
        setStatus("Error");
    } finally {
        setTimeout(() => setStatus("Idle"), 3000);
    }
  };

  const toggleDocumentMode = (isInvoice: boolean) => {
    props.onConfigChange({...props.config, isInvoice});
    if (props.onRefreshId) props.onRefreshId();
  };
  
  const handleClientSelect = (selectedValue: string) => {
    const selectedAccount = props.addressBook.find(acc => acc.id === selectedValue);
    if (selectedAccount) {
        props.onClientChange(selectedAccount);
    }
  };


  return (
    <div className="max-w-[1200px] mx-auto px-4 py-8 no-print fade-in space-y-8">
      <input
        type="file"
        ref={localLoadInputRef}
        className="hidden"
        accept=".json"
        onChange={handleLocalFileSelected}
      />
      <input
        type="file"
        ref={importFileRef}
        className="hidden"
        accept=".json"
        onChange={handleImportFileSelected}
      />
      {/* Heavy Duty Header */}
      <header className="glass p-6 rounded-2xl flex items-center justify-between shadow-sm sticky top-4 z-[100] border-t-4 border-t-cat-yellow">
        <div className="flex items-center gap-6">
          <button 
            onClick={() => logoInputRef.current?.click()}
            className="w-14 h-14 bg-white rounded-xl flex items-center justify-center shadow-sm border border-slate-200 hover:border-cat-yellow transition-all group relative"
            title="Upload Custom Logo"
          >
            {props.customLogo ? <img src={props.customLogo} className="h-10 w-auto object-contain" /> : <Logo className="h-10" />}
            <div className="absolute inset-0 bg-cat-black/70 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <svg className="w-5 h-5 text-cat-yellow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
            </div>
            <input 
              type="file" 
              ref={logoInputRef} 
              className="hidden" 
              accept="image/png, image/jpeg, image/svg+xml"
              onChange={handleLogoChange}
            />
          </button>
          <div>
            <h1 className="text-lg font-black uppercase tracking-tight text-cat-black leading-tight">Iron Hub Portal</h1>
            <div className="flex items-center gap-2 mt-1">
              <div className={`w-2.5 h-2.5 rounded-full ${props.syncStatus === 'stable' ? 'bg-emerald-500' : 'bg-cat-yellow animate-pulse'}`}></div>
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                {props.syncStatus === 'stable' ? 'Cloud Synced' : 'Syncing...'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={props.onDownloadImagePool} title="Download Parts Image Pool" className="p-3 bg-slate-100 text-slate-600 hover:text-white hover:bg-emerald-600 rounded-xl btn-app transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
          </button>
          <button onClick={props.onExportData} title="Export All Data" className="p-3 bg-slate-100 text-slate-600 hover:text-white hover:bg-cat-black rounded-xl btn-app transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V3"></path></svg>
          </button>
          <button onClick={() => importFileRef.current?.click()} title="Import All Data" className="p-3 bg-slate-100 text-slate-600 hover:text-white hover:bg-cat-black rounded-xl btn-app transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-6">
          <div className="card-app p-6 border-l-4 border-l-cat-black">
            <SectionTitle title="Intake Center" subtitle="Manifest synchronization" />
            <div className="flex gap-2 p-1 bg-slate-100 rounded-xl mb-6">
              {[ParseMode.PDF, ParseMode.EXCEL, ParseMode.PASTE].map(mode => (
                <button 
                  key={mode} 
                  onClick={() => setActiveTab(mode)} 
                  className={`flex-1 py-2.5 text-[10px] font-black uppercase rounded-lg transition-all ${activeTab === mode ? 'bg-white text-cat-black shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <div className="mb-6">
              {activeTab === ParseMode.PASTE ? (
                <textarea 
                  value={textInput} 
                  onChange={(e) => setTextInput(e.target.value)} 
                  className="w-full h-40 p-4 bg-slate-50 rounded-xl text-xs font-mono border-2 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/10 focus:border-cat-yellow transition-all resize-none" 
                  placeholder="Enter manifest strings..." 
                />
              ) : (
                <div 
                  onClick={() => activeTab === ParseMode.PDF ? pdfInputRef.current?.click() : excelInputRef.current?.click()} 
                  className="w-full h-40 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-white hover:border-cat-yellow transition-all group"
                >
                  <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-slate-300 group-hover:text-cat-black shadow-sm transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Load {activeTab} Payload</p>
                    <p className="text-[8px] font-bold text-slate-400 uppercase mt-1">Auto-indexing enabled</p>
                  </div>
                  <input ref={pdfInputRef} type="file" className="hidden" accept=".pdf" onChange={(e) => handleProcess(e.target.files?.[0])} />
                  <input ref={excelInputRef} type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={(e) => handleProcess(e.target.files?.[0])} />
                </div>
              )}
            </div>

            <button 
              onClick={() => handleProcess()} 
              className="w-full py-4 bg-cat-black text-white font-black text-[11px] uppercase tracking-[0.2em] rounded-xl hover:bg-cat-dark btn-app shadow-lg shadow-cat-black/10"
            >
              {status === "Processing" ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Syncing Data...</span>
                </div>
              ) : "Process Manifest"}
            </button>
          </div>

          <div className="card-app p-6 bg-cat-yellow text-cat-black border-none shadow-xl shadow-cat-yellow/10">
            <div className="flex justify-between items-center mb-6">
              <SectionTitle title="Smart Analytics" subtitle="Thinking mode enabled" colorClass="text-cat-black" />
              <Switch enabled={useThinking} onChange={setUseThinking} />
            </div>
            <div className="space-y-4">
              <input 
                value={intelTask} 
                onChange={(e) => setIntelTask(e.target.value)} 
                className="w-full h-[48px] p-4 bg-white/40 rounded-xl text-xs font-bold placeholder:text-cat-black/40 focus:bg-white/60 outline-none border-none transition-all shadow-inner" 
                placeholder="Command AI Engine..." 
              />
              <button 
                disabled={isIntelWorking} 
                className="w-full py-4 bg-cat-black text-white font-black text-[10px] uppercase tracking-widest rounded-xl btn-app shadow-lg"
              >
                {isIntelWorking ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Working...</span>
                  </div>
                ) : "Dispatch Task"}
              </button>
              {intelResult && (
                <div className="p-4 bg-white/40 rounded-xl text-[10px] leading-relaxed italic border border-cat-black/5 font-bold animate-in fade-in slide-in-from-top-2">
                  {intelResult}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 space-y-6">
          <div className="card-app p-6 border-l-4 border-l-cat-yellow">
            <div className="flex justify-between items-center mb-6">
              <SectionTitle title="Partner Manifest" subtitle="Identity details" />
              <div className="flex gap-2">
                <button 
                  onClick={handleSaveToDirectory} 
                  disabled={!props.client.company || isSavedToBook}
                  className={`text-[9px] font-black uppercase px-4 py-2 rounded-lg btn-app transition-all disabled:opacity-50 ${isSavedToBook ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {isSavedToBook ? 'Saved ✓' : 'Save to Directory'}
                </button>
                <button onClick={() => setShowAddressBook(true)} className="text-[9px] font-black uppercase text-cat-black bg-cat-yellow px-4 py-2 rounded-lg btn-app">Directory</button>
              </div>
            </div>
            
            <div className="mb-4 pb-4 border-b border-slate-100">
                <AppInput label="Load Partner from Directory">
                     <CustomSelect
                        value={props.client.id || ''}
                        onChange={handleClientSelect}
                        placeholder="Select an existing partner..."
                        options={props.addressBook
                            .sort((a, b) => a.company.localeCompare(b.company))
                            .map(acc => ({
                                value: acc.id,
                                label: `${acc.company} (${acc.contactName || 'No Contact'})`
                            }))
                        }
                    />
                </AppInput>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <AppInput label="Enterprise Name"><input className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.client.company} onChange={(e) => props.onClientChange({...props.client, company: e.target.value})} /></AppInput>
              <AppInput label="Access Account"><input className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-mono font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.client.accountNumber} onChange={(e) => props.onClientChange({...props.client, accountNumber: e.target.value})} /></AppInput>
              <AppInput label="Contact Name"><input className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.client.contactName} onChange={(e) => props.onClientChange({...props.client, contactName: e.target.value})} /></AppInput>
              <AppInput label="Contact Email"><input className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.client.email} onChange={(e) => props.onClientChange({...props.client, email: e.target.value})} /></AppInput>
              <AppInput label="Contact Phone Number"><input className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.client.phone} onChange={(e) => props.onClientChange({...props.client, phone: e.target.value})} /></AppInput>
            </div>
            
            <div className="pt-4 border-t border-slate-100 space-y-4">
              <SectionTitle title="Billing Address" subtitle="Primary legal address" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <AppInput label="Address Line" className="md:col-span-2"><input className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.client.billingAddress} onChange={(e) => props.onClientChange({...props.client, billingAddress: e.target.value})} /></AppInput>
                 <AppInput label="Country">
                   <CustomSelect
                     value={props.client.billingCountry || ''}
                     onChange={(val) => props.onClientChange({...props.client, billingCountry: val, billingCity: ''})}
                     placeholder="Select Country..."
                     options={countryOptions}
                   />
                 </AppInput>
                 <AppInput label="City">
                   {billingCityOptions.length > 0 ? (
                     <CustomSelect
                       value={props.client.billingCity || ''}
                       onChange={(val) => props.onClientChange({...props.client, billingCity: val})}
                       placeholder="Select City..."
                       options={billingCityOptions}
                     />
                   ) : (
                     <input className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.client.billingCity} onChange={(e) => props.onClientChange({...props.client, billingCity: e.target.value})} />
                   )}
                 </AppInput>
                 <AppInput label="State/Province"><input className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.client.billingState} onChange={(e) => props.onClientChange({...props.client, billingState: e.target.value})} /></AppInput>
                 <AppInput label="ZIP/Postal Code"><input className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.client.billingZip} onChange={(e) => props.onClientChange({...props.client, billingZip: e.target.value})} /></AppInput>
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-slate-100 space-y-4">
               <div className="flex items-center justify-between">
                 <SectionTitle title="Shipping Address" subtitle="Final destination" />
                 <div className="flex items-center gap-3">
                    <label className="text-[10px] font-black uppercase text-slate-600">Same as Billing</label>
                    <Switch enabled={shippingSameAsBilling} onChange={setShippingSameAsBilling} />
                 </div>
               </div>
              {!shippingSameAsBilling && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-300">
                  <AppInput label="Address Line" className="md:col-span-2"><input className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.client.shippingAddress} onChange={(e) => props.onClientChange({...props.client, shippingAddress: e.target.value})} /></AppInput>
                  <AppInput label="Country">
                    <CustomSelect
                      value={props.client.shippingCountry || ''}
                      onChange={(val) => props.onClientChange({...props.client, shippingCountry: val, shippingCity: ''})}
                      placeholder="Select Country..."
                      options={countryOptions}
                    />
                  </AppInput>
                  <AppInput label="City">
                    {shippingCityOptions.length > 0 ? (
                      <CustomSelect
                        value={props.client.shippingCity || ''}
                        onChange={(val) => props.onClientChange({...props.client, shippingCity: val})}
                        placeholder="Select City..."
                        options={shippingCityOptions}
                      />
                    ) : (
                      <input className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.client.shippingCity} onChange={(e) => props.onClientChange({...props.client, shippingCity: e.target.value})} />
                    )}
                  </AppInput>
                  <AppInput label="State/Province"><input className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.client.shippingState} onChange={(e) => props.onClientChange({...props.client, shippingState: e.target.value})} /></AppInput>
                  <AppInput label="ZIP/Postal Code"><input className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.client.shippingZip} onChange={(e) => props.onClientChange({...props.client, shippingZip: e.target.value})} /></AppInput>
                </div>
              )}
            </div>

          </div>

          <div className="card-app p-6 border-l-4 border-l-slate-200">
            <SectionTitle title="Commercial Config" subtitle="Logistics parameters" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <AppInput label="Price Increase %">
                <input type="number" className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-mono font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.config.markupPercentage} onChange={(e) => props.onConfigChange({...props.config, markupPercentage: parseFloat(e.target.value) || 0})} />
              </AppInput>
              <AppInput label="Loyalty Discount %">
                <input type="number" className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-mono font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.config.discountPercentage} onChange={(e) => props.onConfigChange({...props.config, discountPercentage: parseFloat(e.target.value) || 0})} />
              </AppInput>
              <AppInput label="Credit / Refund ($)">
                <input type="number" step="0.01" className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-mono font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.config.creditOrRefund || ''} onChange={(e) => props.onConfigChange({...props.config, creditOrRefund: parseFloat(e.target.value) || 0})} />
              </AppInput>
              <AppInput label={`Freight Rate / ${props.config.weightUnit}`}>
                <input type="number" step="0.1" className="w-full h-[48px] px-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-mono font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all shadow-sm hover:border-slate-300" value={props.config.logisticsRate} onChange={(e) => props.onConfigChange({...props.config, logisticsRate: parseFloat(e.target.value) || 0})} />
              </AppInput>
              <AppInput label="System Units">
                <CustomSelect
                  value={props.config.weightUnit}
                  onChange={(value) => props.onConfigChange({...props.config, weightUnit: value as 'LBS' | 'KG'})}
                  options={[
                    { value: "LBS", label: "LBS (Pounds)"},
                    { value: "KG", label: "KG (Kilograms)"},
                  ]}
                />
              </AppInput>
              <AppInput label="Document Language">
                <CustomSelect
                  value={props.config.documentLanguage}
                  onChange={(value) => props.onConfigChange({...props.config, documentLanguage: value as 'en' | 'ar'})}
                  options={[
                    { value: "en", label: "English"},
                    { value: "ar", label: "Arabic (العربية)"},
                  ]}
                />
              </AppInput>
              <AppInput label="Image Mode">
                 <CustomSelect
                    value={props.config.photoMode}
                    onChange={(value) => props.onConfigChange({...props.config, photoMode: value as PhotoMode})}
                    options={[
                        { value: PhotoMode.NONE, label: "No Image" },
                        { value: PhotoMode.EXTRACT, label: "Extracted from PDF" },
                        { value: PhotoMode.AI, label: "AI Generated" },
                    ]}
                 />
              </AppInput>
              {props.config.photoMode === PhotoMode.AI && (
                <AppInput label="AI Image Resolution">
                  <div className="flex gap-1 p-1 bg-slate-100 rounded-xl h-[48px]">
                    {(['1K', '2K', '4K'] as const).map(size => (
                      <button 
                        key={size}
                        onClick={() => props.onConfigChange({...props.config, imageSize: size})}
                        className={`flex-1 text-[9px] font-black uppercase rounded-lg transition-all ${props.config.imageSize === size ? 'bg-white text-cat-black shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </AppInput>
              )}
              <AppInput label="Payment Terms">
                <CustomSelect
                  value={props.config.paymentTerms || ''}
                  onChange={(val) => props.onConfigChange({...props.config, paymentTerms: val})}
                  placeholder="Select Payment Terms..."
                  options={[
                    { value: 'PIA (Payment in Advance)', label: 'PIA (Payment in Advance)' },
                    { value: 'CIA (Cash in Advance)', label: 'CIA (Cash in Advance)' },
                    { value: 'COD (Cash on Delivery)', label: 'COD (Cash on Delivery)' },
                    { value: 'CWO (Cash with Order)', label: 'CWO (Cash with Order)' },
                    { value: 'Net 7', label: 'Net 7' },
                    { value: 'Net 10', label: 'Net 10' },
                    { value: 'Net 15', label: 'Net 15' },
                    { value: 'Net 30', label: 'Net 30' },
                    { value: 'Net 60', label: 'Net 60' },
                    { value: 'Net 90', label: 'Net 90' },
                    { value: 'EOM (End of Month)', label: 'EOM (End of Month)' },
                    { value: '1% 10 Net 30', label: '1% 10 Net 30' },
                    { value: '2% 10 Net 30', label: '2% 10 Net 30' },
                    { value: 'LC (Letter of Credit)', label: 'LC (Letter of Credit)' },
                    { value: 'TT (Telegraphic Transfer)', label: 'TT (Telegraphic Transfer)' },
                    { value: 'DP (Documents against Payment)', label: 'DP (Documents against Payment)' },
                    { value: 'DA (Documents against Acceptance)', label: 'DA (Documents against Acceptance)' }
                  ]}
                />
              </AppInput>
              <div className="md:col-span-2 lg:col-span-3">
                <AppInput label="Document Mode">
                  <div className="flex gap-1 p-1 bg-slate-100 rounded-xl h-[48px]">
                    <button 
                      onClick={() => toggleDocumentMode(false)}
                      className={`flex-1 text-[9px] font-black uppercase rounded-lg transition-all ${!props.config.isInvoice ? 'bg-white text-cat-black shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      Quote
                    </button>
                    <button 
                      onClick={() => toggleDocumentMode(true)}
                      className={`flex-1 text-[9px] font-black uppercase rounded-lg transition-all ${props.config.isInvoice ? 'bg-white text-cat-black shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      Invoice
                    </button>
                  </div>
                </AppInput>
              </div>
              <div className="md:col-span-2 lg:col-span-3">
                <AppInput label="Special Instructions">
                  <textarea 
                    className="w-full h-24 p-4 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-xl text-[13px] font-medium focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all resize-none shadow-sm hover:border-slate-300" 
                    value={props.config.specialInstructions || ''} 
                    onChange={(e) => props.onConfigChange({...props.config, specialInstructions: e.target.value})}
                    placeholder="e.g. FOB Riverview. Component validation required."
                  />
                </AppInput>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card-app p-6 border-l-4 border-l-slate-400">
        <SectionTitle title="Vault Archive" subtitle="Load from engineering records" />
        <div className="max-h-80 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
          {props.quoteHistory.length === 0 ? (
            <div className="text-center py-12 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">No Saved Quotes Found in Cloud</p>
            </div>
          ) : (
            props.quoteHistory.map(q => (
              <div 
                key={q.id} 
                onClick={() => props.onLoadFromArchive(q)} 
                className="p-5 bg-slate-50 rounded-2xl hover:bg-white hover:shadow-md hover:border-cat-yellow border-2 border-transparent transition-all cursor-pointer group flex justify-between items-center"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-400 group-hover:text-cat-black shadow-sm transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                  </div>
                  <div>
                    <h4 className="text-[12px] font-black uppercase text-slate-900 group-hover:text-cat-black transition-colors">{q.title}</h4>
                    <p className="text-[9px] text-slate-400 font-bold uppercase mt-1 group-hover:text-cat-black/60 transition-colors">
                      {new Date(q.timestamp).toLocaleDateString()} • BY {q.author}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm font-mono font-black text-slate-600 group-hover:text-cat-black transition-colors">${(q.total ?? 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 glass p-3 rounded-full shadow-2xl z-[150] flex items-center gap-3 border-2 border-cat-yellow/20">
        <button onClick={() => props.onAnalyze(useThinking)} disabled={props.isAnalyzing || props.itemsCount === 0} className="w-14 h-14 bg-cat-yellow text-cat-black rounded-full flex items-center justify-center btn-app group shadow-lg shadow-cat-yellow/20">
          {props.isAnalyzing ? <div className="w-6 h-6 border-2 border-cat-black/20 border-t-cat-black rounded-full animate-spin"></div> : <svg className="w-6 h-6 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>}
        </button>
        {props.config.photoMode === PhotoMode.AI && (
          <button onClick={props.onGenerateAllImages} disabled={props.isGeneratingImages || props.itemsCount === 0} className="px-6 py-4 bg-cat-yellow text-cat-black text-[11px] font-black uppercase tracking-widest rounded-full btn-app flex items-center gap-2 shadow-lg shadow-cat-yellow/20">
            {props.isGeneratingImages ? <div className="w-4 h-4 border-2 border-cat-black/20 border-t-cat-black rounded-full animate-spin"></div> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>}
            {props.isGeneratingImages ? 'Generating...' : 'AI Images'}
          </button>
        )}
        <div className="h-8 w-[1px] bg-slate-200"></div>
        <button onClick={props.onConvertToInvoice} disabled={props.itemsCount === 0} className="px-6 py-4 bg-indigo-600 text-white text-[11px] font-black uppercase tracking-widest rounded-full btn-app flex items-center gap-2 shadow-lg shadow-indigo-600/20">
          Invoice
        </button>
        <button onClick={props.onPrint} disabled={props.itemsCount === 0} className="px-6 py-4 bg-white text-cat-black text-[11px] font-black uppercase tracking-widest rounded-full btn-app hover:bg-cat-yellow flex items-center gap-2 shadow-lg">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2-2v4a2 2 0 002 2h2"></path></svg>
          Print
        </button>
        <button onClick={props.onEmailDispatch} disabled={props.itemsCount === 0} className="px-6 py-4 bg-cat-yellow text-cat-black text-[11px] font-black uppercase tracking-widest rounded-full btn-app flex items-center gap-2 shadow-lg shadow-cat-yellow/20">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2-2v10a2 2 0 002 2z"></path></svg>
          Send
        </button>
        <button onClick={props.onWhatsAppQuote} disabled={props.itemsCount === 0} className="px-6 py-4 bg-[#25D366] text-white text-[11px] font-black uppercase tracking-widest rounded-full btn-app flex items-center gap-2 shadow-lg shadow-[#25D366]/20">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          WhatsApp
        </button>
        <div className="h-8 w-[1px] bg-slate-200"></div>
        <button 
          onClick={props.onCommitToCloud} 
          disabled={props.itemsCount === 0} 
          className="px-6 py-4 bg-white text-cat-black text-[11px] font-black uppercase tracking-widest rounded-full btn-app hover:bg-cat-yellow flex items-center gap-2 shadow-lg"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
          Cloud
        </button>
        <button 
          onClick={() => localLoadInputRef.current?.click()}
          className="px-6 py-4 bg-white text-cat-black text-[11px] font-black uppercase tracking-widest rounded-full btn-app hover:bg-cat-yellow flex items-center gap-2 shadow-lg"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
          Load
        </button>
        <button 
          onClick={props.onSaveQuote} 
          disabled={props.itemsCount === 0} 
          className="px-6 py-4 bg-white text-cat-black text-[11px] font-black uppercase tracking-widest rounded-full btn-app hover:bg-cat-yellow flex items-center gap-2 shadow-lg"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V3"></path></svg>
          Save
        </button>
      </div>

      {showAddressBook && (
        <div className="fixed inset-0 bg-cat-black/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-3xl overflow-hidden animate-in zoom-in-95 duration-200 border-4 border-cat-yellow">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <SectionTitle title="Directory" subtitle="Network partners" />
              <button onClick={() => setShowAddressBook(false)} className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 btn-app">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <input type="text" placeholder="Search directory..." className="w-full h-[46px] p-3.5 bg-slate-100 rounded-xl text-xs font-bold outline-none border-2 border-slate-200 focus:border-cat-yellow text-slate-900 placeholder:text-slate-400" value={bookSearch} onChange={(e) => setBookSearch(e.target.value)} />
              <div className="max-h-[50vh] overflow-y-auto space-y-1.5">
                {props.addressBook.filter(c => c.company.toLowerCase().includes(bookSearch.toLowerCase())).map(saved => (
                  <div key={saved.id} className="p-3.5 bg-slate-50 rounded-lg hover:bg-slate-100 transition-all flex justify-between items-center group/item">
                    <div onClick={() => { props.onClientChange(saved); setShowAddressBook(false); }} className="flex-grow cursor-pointer">
                      <h4 className="text-[11px] font-black uppercase text-cat-black">{saved.company}</h4>
                      <p className="text-[9px] text-slate-500 font-bold uppercase">{saved.contactName}</p>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); props.onDeleteFromBook(saved.id); }}
                      className="p-2 text-slate-300 hover:text-red-500 transition-all opacity-0 group-hover/item:opacity-100"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
