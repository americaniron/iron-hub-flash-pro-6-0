
import * as React from 'react';
import { User, CustomerAccount, SyncStatus, InvoiceData, ServiceItem, InvoiceTemplate, RecurringInvoice, PhotoMode } from '../types.ts';
import { Logo } from './Logo.tsx';
import { PartImage } from './PartImage.tsx';
import { exportInvoices } from '../services/exportService.ts';
import { hubApiFetch } from '../services/hubApi.ts';
import { invoiceWhatsAppMessage, whatsAppSendUrl } from '../services/whatsAppService.ts';
import { Copy, Download, FileSpreadsheet, FileText, Link2, MessageCircle } from 'lucide-react';

// --- High-Fidelity UI Components ---
const CustomSelect: React.FC<{
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}> = ({ options, value, onChange, placeholder }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-[56px] px-6 bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl text-[11px] font-black uppercase outline-none focus:bg-white focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all flex items-center justify-between text-left shadow-sm hover:border-slate-300"
      >
        <span className={selectedOption ? "text-cat-black" : "text-slate-500"}>{selectedLabel}</span>
        <svg className={`w-5 h-5 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"></path></svg>
      </button>
      {isOpen && (
        <div className="absolute top-full mt-3 w-full bg-white/90 backdrop-blur-xl rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.1)] border border-slate-200/60 p-2 z-50 animate-in fade-in zoom-in-95 max-h-60 overflow-y-auto custom-scrollbar">
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-3 text-[10px] font-black uppercase rounded-xl hover:bg-cat-yellow/10 hover:text-cat-black flex items-center justify-between transition-colors duration-200"
            >
              {option.label}
              {value === option.value && <svg className="w-4 h-4 text-cat-yellow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const SyncIndicator: React.FC<{ status: SyncStatus }> = ({ status }) => (
  <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full">
    <div className={`w-2 h-2 rounded-full ${status === 'syncing' ? 'bg-amber-500 animate-pulse' : status === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`} />
    <span className="text-[7px] font-black uppercase text-slate-500 tracking-widest">{status}</span>
  </div>
);

interface InvoiceSystemProps {
  currentUser: User;
  syncStatus: SyncStatus;
  customerAccounts: CustomerAccount[];
  allInvoices: InvoiceData[];
  onSaveInvoices: (invoices: InvoiceData[]) => Promise<boolean>;
  initialInvoice: InvoiceData | null;
  onClearInitialInvoice: () => void;
  customLogo: string | null;
  onSendInvoice: (invoice: InvoiceData, paymentUrl?: string) => void;
  templates: InvoiceTemplate[];
  onSaveTemplates: (templates: InvoiceTemplate[]) => void;
  recurringInvoices: RecurringInvoice[];
  onSaveRecurring: (recurring: RecurringInvoice[]) => void;
}

const DEFAULT_TEMPLATES: InvoiceTemplate[] = [
  { id: 'classic', name: 'Classic Iron', primaryColor: '#000000', accentColor: '#ffcd00', fontFamily: 'Plus Jakarta Sans', headerStyle: 'classic' as const, showLogo: true },
  { id: 'modern', name: 'Modern Tech', primaryColor: '#1e293b', accentColor: '#38bdf8', fontFamily: 'Inter', headerStyle: 'modern' as const, showLogo: true },
  { id: 'minimal', name: 'Minimalist', primaryColor: '#000000', accentColor: '#000000', fontFamily: 'JetBrains Mono', headerStyle: 'minimal' as const, showLogo: false },
];

const formatCurrency = (amount: number) => {
  return amount.toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });
};

const AddressBlock: React.FC<{ title: string; client?: CustomerAccount }> = ({ title, client }) => (
  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 text-[8px] h-full flex flex-col address-block print:flex-1 print:p-3 print:border-slate-300 print:rounded-lg">
    <h3 className="text-[7px] font-black uppercase tracking-[0.2em] text-cat-black mb-2 print:text-[7pt]">{title}</h3>
    {client ? (
      <div className="space-y-1">
        <p className="font-black text-cat-black text-[9px] uppercase print:text-[10pt]">{client.company}</p>
        <div className="text-slate-600 leading-relaxed uppercase print:text-[8pt] print:text-black">
          {client.billingAddress}<br />
          {client.billingCity}, {client.billingState} {client.billingZip}<br />
          {client.billingCountry}
        </div>
        <div className="pt-1 flex flex-col gap-0.5">
           {client.contactName && <p className="text-slate-500 font-bold uppercase print:text-[7pt]">ATTN: {client.contactName}</p>}
           {client.phone && <p className="text-slate-500 font-mono print:text-[7pt]">{client.phone}</p>}
        </div>
      </div>
    ) : (
      <div className="flex-grow flex items-center justify-center border-2 border-dashed border-slate-200 rounded-xl">
        <span className="text-[7px] font-black text-slate-300 uppercase tracking-widest">Client Required</span>
      </div>
    )}
  </div>
);

export const InvoiceSystem: React.FC<InvoiceSystemProps> = ({ currentUser, customerAccounts, allInvoices, onSaveInvoices, initialInvoice, onClearInitialInvoice, customLogo, onSendInvoice, templates, onSaveTemplates, recurringInvoices, onSaveRecurring, syncStatus }) => {
  
  const [activeTab, setActiveTab] = React.useState<'editor' | 'recurring'>('editor');
  const createNewInvoice = (clientId: string = ''): InvoiceData => ({
    id: `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
    date: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    items: [],
    taxRate: 7,
    discount: 0,
    notes: '',
    status: 'draft',
    total: 0,
    clientId: clientId,
  });

  const [currentInvoice, setCurrentInvoice] = React.useState<InvoiceData>(createNewInvoice());
  const [localValues, setLocalValues] = React.useState<Record<string, string>>({});
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>('classic');
  const [showExportMenu, setShowExportMenu] = React.useState(false);
  const [isSavingInvoice, setIsSavingInvoice] = React.useState(false);
  const [paymentLink, setPaymentLink] = React.useState<string | null>(null);
  const [paymentLinkInvoiceId, setPaymentLinkInvoiceId] = React.useState<string | null>(null);
  const [paymentLinkError, setPaymentLinkError] = React.useState<string | null>(null);
  const [isPreparingPaymentLink, setIsPreparingPaymentLink] = React.useState(false);

  const currentPaymentLink = paymentLinkInvoiceId === currentInvoice.id ? paymentLink : null;

  const activeTemplate = templates.find(t => t.id === selectedTemplateId) || DEFAULT_TEMPLATES[0];

  const subtotal = Math.round((currentInvoice.items || []).reduce((sum, item) => sum + item.hours * item.rate, 0) * 100) / 100;
  const taxableAmount = Math.round((currentInvoice.items || []).filter(i => i.taxable).reduce((sum, item) => sum + item.hours * item.rate, 0) * 100) / 100;
  const tax = Math.round(taxableAmount * (currentInvoice.taxRate / 100) * 100) / 100;
  const total = Math.round((subtotal + tax - currentInvoice.discount) * 100) / 100;
  
  React.useEffect(() => {
    setCurrentInvoice(prev => ({...prev, total: total}));
  }, [total]);

  React.useEffect(() => {
    if (initialInvoice) {
      setCurrentInvoice(initialInvoice);
      setPaymentLink(null);
      setPaymentLinkInvoiceId(null);
      setPaymentLinkError(null);
      onClearInitialInvoice();
    }
  }, [initialInvoice, onClearInitialInvoice]);
  
  React.useEffect(() => {
    const nextLocal: Record<string, string> = {};
    currentInvoice.items.forEach((item) => {
      nextLocal[`${item.id}-hours`] = item.hours.toString();
      nextLocal[`${item.id}-rate`] = item.rate.toString();
    });
    setLocalValues(nextLocal);
  }, [currentInvoice.items]);


  const handleAddItem = () => {
    setCurrentInvoice({
      ...currentInvoice,
      items: [...currentInvoice.items, { id: Date.now().toString(), description: '', hours: 1, rate: 125, taxable: true }]
    });
  };
  
  const handleSaveInvoice = async () => {
    if (isSavingInvoice) return;
    if (!currentInvoice.clientId) {
      alert("Please select a client before saving.");
      return;
    }
    const updatedInvoice = {...currentInvoice, status: 'unpaid' as 'unpaid'};
    const existingIndex = allInvoices.findIndex(inv => inv.id === updatedInvoice.id);
    let updatedInvoices;
    if (existingIndex > -1) {
        updatedInvoices = allInvoices.map(inv => inv.id === updatedInvoice.id ? updatedInvoice : inv);
    } else {
        updatedInvoices = [...allInvoices, updatedInvoice];
    }
    setIsSavingInvoice(true);
    try {
      const synchronized = await onSaveInvoices(updatedInvoices);
      if (!synchronized) return;
      alert(`Invoice ${updatedInvoice.id} synchronized successfully.`);
      setCurrentInvoice(updatedInvoice);
    } finally {
      setIsSavingInvoice(false);
    }
  };

  const preparePaymentLink = async (): Promise<string | null> => {
    if (currentPaymentLink) return currentPaymentLink;
    if (!currentInvoice.clientId) {
      setPaymentLinkError('Select a customer and synchronize the invoice before preparing payment.');
      return null;
    }
    setIsPreparingPaymentLink(true);
    setPaymentLinkError(null);
    try {
      const response = await hubApiFetch('/api/invoice-payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: currentInvoice.id }),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json().catch(() => ({})) as { url?: unknown; error?: unknown; message?: unknown };
      const url = typeof result.url === 'string' ? result.url : '';
      if (!response.ok || !url.startsWith('https://suite.fixmyiron.com/pay/')) {
        throw new Error(String(result.error || result.message || 'Secure payment link could not be prepared.'));
      }
      setPaymentLink(url);
      setPaymentLinkInvoiceId(currentInvoice.id);
      return url;
    } catch (error) {
      setPaymentLinkError(error instanceof Error ? error.message : 'Secure payment link could not be prepared.');
      return null;
    } finally {
      setIsPreparingPaymentLink(false);
    }
  };

  const handleSendInvoiceEmail = async () => {
    if (!allInvoices.some((invoice) => invoice.id === currentInvoice.id)) {
      setPaymentLinkError('Synchronize this invoice with IronSuite before sending it to a customer.');
      return;
    }
    const url = await preparePaymentLink();
    if (!url) return;
    onSendInvoice(currentInvoice, url);
  };

  const handlePreparePaymentLink = () => {
    void preparePaymentLink();
  };

  const handleCopyPaymentLink = () => {
    void copyPaymentLink();
  };

  const handleOpenInvoiceEmail = () => {
    void handleSendInvoiceEmail();
  };

  const handleShareInvoiceWhatsApp = () => {
    if (!selectedClient) {
      setPaymentLinkError('Select a customer before sharing this invoice.');
      return;
    }
    const phone = selectedClient.whatsapp || selectedClient.phone || '';
    if (!phone) {
      setPaymentLinkError('Add a WhatsApp or phone number to this customer before sharing the invoice.');
      return;
    }
    const message = invoiceWhatsAppMessage(currentInvoice, selectedClient.company || selectedClient.contactName || 'N/A', currentPaymentLink);
    window.open(whatsAppSendUrl(phone, message), '_blank', 'noopener,noreferrer');
  };

  const copyPaymentLink = async () => {
    const url = await preparePaymentLink();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setPaymentLinkError(null);
    } catch {
      setPaymentLinkError('The secure link is ready below. Copy it from the invoice before sharing.');
    }
  };

  const startNewInvoice = () => {
    setCurrentInvoice(createNewInvoice());
    setPaymentLink(null);
    setPaymentLinkInvoiceId(null);
    setPaymentLinkError(null);
  };

  const updateItem = (id: string, field: keyof ServiceItem, value: any) => {
    if (field === 'hours' || field === 'rate') {
      setLocalValues(prev => ({ ...prev, [`${id}-${field}`]: value }));
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        setCurrentInvoice(prev => ({
          ...prev,
          items: prev.items.map(item => item.id === id ? { ...item, [field]: numValue } : item)
        }));
      }
    } else {
       setCurrentInvoice(prev => ({
        ...prev,
        items: prev.items.map(item => item.id === id ? { ...item, [field]: value } : item)
      }));
    }
  };

  const handleBlur = (id: string, field: 'hours' | 'rate') => {
    const strValue = localValues[`${id}-${field}`] || '0';
    const numValue = parseFloat(strValue) || 0;
    const roundedValue = Math.round(numValue * 100) / 100;
    
    setLocalValues(prev => ({ ...prev, [`${id}-${field}`]: roundedValue.toString() }));
    setCurrentInvoice(prev => ({
      ...prev,
      items: prev.items.map(item => item.id === id ? { ...item, [field]: roundedValue } : item)
    }));
  };

  const deleteItem = (id: string) => {
    setCurrentInvoice({
      ...currentInvoice,
      items: currentInvoice.items.filter(item => item.id !== id)
    });
  };

  const handleSendReminder = (invoice: InvoiceData) => {
    void (async () => {
      const url = await preparePaymentLink();
      if (!url) return;
      const reminderInvoice: InvoiceData = {
        ...invoice,
        notes: `PAYMENT REMINDER: This is a friendly reminder that invoice ${invoice.id} is currently ${invoice.status}. Please settle the balance of $${formatCurrency(invoice.total)} at your earliest convenience.`
      };
      onSendInvoice(reminderInvoice, url);
    })();
  };

  const handleToggleRecurring = (invoice: InvoiceData) => {
    const existing = recurringInvoices.find(r => r.clientId === invoice.clientId && r.isActive);
    if (existing) {
      onSaveRecurring(recurringInvoices.filter(r => r.id !== existing.id));
      alert("Recurring schedule deactivated for this client.");
    } else {
      const newRecurring: RecurringInvoice = {
        id: `REC-${Date.now()}`,
        clientId: invoice.clientId,
        items: invoice.items,
        taxRate: invoice.taxRate,
        discount: invoice.discount,
        notes: invoice.notes,
        frequency: 'monthly',
        startDate: new Date().toISOString().split('T')[0],
        nextGeneration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        isActive: true,
        templateId: selectedTemplateId
      };
      onSaveRecurring([...recurringInvoices, newRecurring]);
      alert("Monthly recurring schedule established for this client.");
    }
  };

  const selectedClient = customerAccounts.find(c => c.id === currentInvoice.clientId);

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-8 space-y-8 animate-in fade-in print:max-w-none print:p-0">
      <div className="flex items-center justify-between no-print glass p-4 rounded-2xl border-t-4 border-t-cat-yellow shadow-sm sticky top-4 z-[100]">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setActiveTab('editor')}
            className={`px-6 py-2.5 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all ${activeTab === 'editor' ? 'bg-cat-black text-white shadow-lg' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
          >
            Invoice Editor
          </button>
          <button 
            onClick={() => setActiveTab('recurring')}
            className={`px-6 py-2.5 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all ${activeTab === 'recurring' ? 'bg-cat-black text-white shadow-lg' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
          >
            Recurring Schedules ({recurringInvoices.length})
          </button>
          
          <div className="relative">
            <button 
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="px-6 py-2.5 bg-white border border-slate-200 text-cat-black rounded-xl font-black text-[8px] uppercase tracking-widest hover:border-cat-yellow transition-all shadow-sm flex items-center gap-2"
            >
              <Download className="w-3 h-3" />
              Export Invoices
            </button>
            
            {showExportMenu && (
              <div className="absolute left-0 mt-2 w-40 bg-white rounded-xl shadow-2xl border border-slate-100 p-1.5 z-[110] animate-in fade-in zoom-in-95">
                <button 
                  onClick={() => { exportInvoices(allInvoices, 'excel'); setShowExportMenu(false); }}
                  className="w-full text-left px-3 py-2 text-[8px] font-black uppercase rounded-lg hover:bg-cat-yellow/10 hover:text-cat-black flex items-center gap-2 transition-colors"
                >
                  <FileSpreadsheet className="w-3 h-3 text-emerald-600" />
                  Excel (.xlsx)
                </button>
                <button 
                  onClick={() => { exportInvoices(allInvoices, 'csv'); setShowExportMenu(false); }}
                  className="w-full text-left px-3 py-2 text-[8px] font-black uppercase rounded-lg hover:bg-cat-yellow/10 hover:text-cat-black flex items-center gap-2 transition-colors"
                >
                  <FileText className="w-3 h-3 text-blue-600" />
                  CSV (.csv)
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
            <SyncIndicator status={syncStatus} />
        </div>
      </div>

      {activeTab === 'recurring' ? (
        <div className="space-y-8 animate-in slide-in-from-bottom-4">
          <div className="flex justify-between items-end">
            <div>
              <h2 className="text-3xl font-black uppercase tracking-tighter text-cat-black">Recurring Schedules</h2>
              <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-1">Automated Billing Management</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {recurringInvoices.length === 0 ? (
              <div className="col-span-full py-24 text-center bg-slate-50 rounded-[2.5rem] border-2 border-dashed border-slate-200">
                <p className="text-slate-400 font-black uppercase text-[8px] tracking-widest">No recurring schedules active</p>
              </div>
            ) : (
              recurringInvoices.map(rec => {
                const client = customerAccounts.find(c => c.id === rec.clientId);
                return (
                  <div key={rec.id} className="card-app p-8 border-l-4 border-l-emerald-500 hover:shadow-2xl transition-all">
                    <div className="flex justify-between items-start mb-6">
                      <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-[7px] font-black uppercase tracking-widest">Active</span>
                      <span className="text-[8px] font-mono font-black text-slate-400 uppercase">{rec.frequency}</span>
                    </div>
                    <h4 className="text-xl font-black uppercase text-cat-black mb-1.5 tracking-tight">{client?.company || 'Unknown Client'}</h4>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-6">Next: {rec.nextGeneration}</p>
                    <div className="space-y-3 mb-8 bg-slate-50 p-4 rounded-2xl">
                      {rec.items.slice(0, 2).map((item, i) => (
                        <div key={i} className="flex justify-between text-[8px] font-bold text-slate-500 uppercase">
                          <span className="truncate mr-2">{item.description}</span>
                          <span className="font-mono">${formatCurrency(item.hours * item.rate)}</span>
                        </div>
                      ))}
                      {rec.items.length > 2 && <p className="text-[7px] text-slate-400 font-black uppercase">+{rec.items.length - 2} more protocols</p>}
                    </div>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => handleToggleRecurring({ clientId: rec.clientId } as any)}
                        className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl text-[8px] font-black uppercase tracking-widest hover:bg-red-50 hover:text-red-600 transition-all btn-app"
                      >
                        Deactivate
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <>
          <style>{`
            .invoice-print-footer { display: none; }
            .print-footer { display: none; }
            .num-col { text-align: right !important; }

            /* html2pdf renders screen media rather than @media print. Keep its
               document clone compact and deterministic without changing the editor. */
            .printable-area.pdf-generation-mode {
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
                background: #fff !important;
            }
            .pdf-generation-mode .invoice-document {
                width: 100% !important;
                max-width: 100% !important;
                border-radius: 0 !important;
                box-shadow: none !important;
            }
            .pdf-generation-mode .print-root {
                padding: 30px 34px 24px !important;
            }
            .pdf-generation-mode .no-print {
                display: none !important;
            }
            .pdf-generation-mode .invoice-notes-print {
                display: block !important;
                font-size: 8px !important;
                line-height: 1.28 !important;
                padding: 10px !important;
                margin-top: 6px !important;
            }
            .pdf-generation-mode .invoice-print-footer {
                display: block !important;
                margin-top: 12px !important;
                padding-top: 8px !important;
                border-top: 1px solid #e5e7eb !important;
                font-size: 6px !important;
                line-height: 1.22 !important;
                color: #374151 !important;
                text-align: justify !important;
            }
            .pdf-generation-mode .invoice-payment-print {
                display: block !important;
                margin-top: 10px !important;
                padding: 9px 10px !important;
                border: 1px solid #86efac !important;
                background: #ecfdf5 !important;
                color: #14532d !important;
                font-size: 7px !important;
                line-height: 1.25 !important;
                overflow-wrap: anywhere !important;
            }
            .pdf-generation-mode .invoice-payment-print a {
                color: inherit !important;
                text-decoration: underline !important;
                overflow-wrap: anywhere !important;
            }
            .pdf-generation-mode .totals-container-print,
            .pdf-generation-mode .terms-box,
            .pdf-generation-mode .invoice-print-footer {
                break-inside: auto !important;
                page-break-inside: auto !important;
            }
            .pdf-generation-mode .summary-table,
            .pdf-generation-mode .address-block,
            .pdf-generation-mode tr {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
            }

            @media print {
                /* == INSTITUTIONAL GRADE PRODUCTION PRINT STYLESHEET V6 == */
                @page { size: LETTER; margin: 0.45in 0.5in 0.55in 0.5in !important; }
                *, *::before, *::after { box-sizing: border-box !important; }
                html, body {
                    width: 100% !important; height: auto !important; margin: 0 !important; padding: 0 !important;
                    background: white !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
                    color: #000 !important; font-family: 'Plus Jakarta Sans', sans-serif !important;
                    font-size: 8.5pt !important; line-height: 1.32 !important;
                }
                .no-print { display: none !important; }
                .print-root { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; }

                .invoice-document {
                    box-shadow: none !important; border: none !important; width: 100% !important;
                    border-radius: 0 !important; border-top: 8pt solid #ffcd00 !important;
                    position: relative; color: black !important;
                }

                /* Repeat table headers on every page; never split a row mid-cell */
                table { width: 100% !important; border-collapse: collapse !important; table-layout: fixed !important; }
                thead { display: table-header-group !important; }
                tfoot { display: table-footer-group !important; }
                tr { break-inside: avoid !important; page-break-inside: avoid !important; }
                /* Keep section headers attached to following content */
                h1, h2, h3, .section-header { break-after: avoid !important; page-break-after: avoid !important; }

                .print-footer {
                    display: block !important;
                    position: fixed;
                    bottom: 0.15in;
                    left: 0.5in;
                    right: 0.5in;
                    text-align: center;
                    font-size: 6.5pt !important;
                    color: #6c757d !important;
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                }
                .print-footer p {
                    margin: 0;
                    line-height: 1.2;
                }
                .totals-container-print {
                    display: flex !important;
                    flex-direction: row !important;
                    justify-content: space-between !important;
                    align-items: flex-start !important;
                    break-inside: auto !important;
                    page-break-inside: auto !important;
                    break-before: avoid !important;
                }
                .summary-table { width: 100% !important; break-inside: avoid !important; page-break-inside: avoid !important; }
                .terms-box { margin-top: 0 !important; break-inside: auto !important; page-break-inside: auto !important; }
                .line-item-desc { font-size: 8pt !important; }
                .address-block {
                    background: transparent !important;
                    border: 1px solid #eee !important;
                    break-inside: avoid !important;
                    page-break-inside: avoid !important;
                }
                /* Force flex on the on-screen Tailwind grid so Bill-To / Commercial blocks line up */
                .grid.grid-cols-2 { display: flex !important; flex-direction: row !important; gap: 0.25in !important; }
                .grid.grid-cols-2 > * { flex: 1 !important; }
                .invoice-print-footer {
                  display: block !important;
                  margin-top: 0.18in;
                  font-size: 6pt !important;
                  line-height: 1.22;
                  color: #444;
                  text-align: justify;
                  border-top: 1px solid #eee;
                  padding-top: 0.08in;
                  break-inside: auto !important;
                  page-break-inside: auto !important;
                }
                /* Crisp print rendering */
                body, body * { -webkit-font-smoothing: antialiased !important; text-rendering: geometricPrecision !important; }
                .tracking-widest { letter-spacing: 0.08em !important; }
                .tracking-tighter { letter-spacing: -0.01em !important; }
            }
          `}</style>
          <div className="flex justify-between items-end no-print">
            <div>
              <h2 className="text-3xl font-black uppercase text-cat-black tracking-tighter">Service Invoicing</h2>
              <p className="text-[8px] font-black uppercase text-slate-400 tracking-widest mt-1">Enterprise Engineering Dispatch</p>
            </div>
            <div className="flex flex-wrap justify-end gap-3">
               <button type="button" onClick={startNewInvoice} className="px-5 py-4 bg-white border border-slate-200 text-slate-700 rounded-xl font-black uppercase text-[8px] tracking-[0.2em] shadow-sm btn-app hover:border-slate-300">
                New Invoice
              </button>
               <button type="button" onClick={handleSaveInvoice} disabled={isSavingInvoice} className="px-6 py-4 bg-cat-black text-white rounded-xl font-black uppercase text-[8px] tracking-[0.2em] shadow-lg shadow-cat-black/10 btn-app hover:bg-cat-dark disabled:cursor-not-allowed disabled:opacity-60">
                {isSavingInvoice ? 'Synchronizing...' : 'Sync To Cloud'}
              </button>
              <button type="button" onClick={handlePreparePaymentLink} disabled={isPreparingPaymentLink || !currentInvoice.clientId} className="px-5 py-4 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl font-black uppercase text-[8px] tracking-[0.16em] shadow-sm btn-app hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 flex items-center gap-2">
                <Link2 className="w-3.5 h-3.5" />
                {isPreparingPaymentLink ? 'Preparing...' : currentPaymentLink ? 'Payment Link Ready' : 'Prepare Payment Link'}
              </button>
              {currentPaymentLink && (
                <button type="button" onClick={handleCopyPaymentLink} disabled={isPreparingPaymentLink} className="px-5 py-4 bg-white border border-emerald-200 text-emerald-800 rounded-xl font-black uppercase text-[8px] tracking-[0.16em] shadow-sm btn-app hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 flex items-center gap-2">
                  <Copy className="w-3.5 h-3.5" /> Copy Link
                </button>
              )}
              <button type="button" onClick={handleOpenInvoiceEmail} disabled={isPreparingPaymentLink} className="px-6 py-4 bg-emerald-600 text-white rounded-xl font-black uppercase text-[8px] tracking-[0.2em] shadow-lg shadow-emerald-600/10 btn-app hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                Send Invoice
              </button>
              <button type="button" onClick={handleShareInvoiceWhatsApp} disabled={!selectedClient} className="px-5 py-4 bg-[#25D366] text-white rounded-xl font-black uppercase text-[8px] tracking-[0.16em] shadow-sm btn-app hover:bg-[#1fb855] disabled:cursor-not-allowed disabled:opacity-60 flex items-center gap-2">
                <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
              </button>
              <button type="button" onClick={() => {
                try {
                  window.focus();
                  window.print();
                } catch {
                  alert("Printing is restricted in this preview. Please press Ctrl+P or open in a new tab.");
                }
              }} className="px-6 py-4 bg-cat-yellow text-cat-black rounded-xl font-black uppercase text-[8px] tracking-[0.2em] shadow-lg shadow-cat-yellow/10 btn-app">
                Execute Print
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 print:block">
            {/* CONFIG PANEL */}
            <div className="lg:col-span-4 space-y-8 no-print">
              <div className="card-app p-8 border-l-4 border-l-cat-yellow">
                <h3 className="text-[8px] font-black uppercase text-slate-400 mb-6 tracking-widest">Entity Protocol</h3>
                <div className="space-y-6">
                  <div>
                    <label className="text-[7px] font-black uppercase text-slate-500 ml-1">Select Partner</label>
                    <CustomSelect
                        value={currentInvoice.clientId}
                        onChange={(value) => setCurrentInvoice({...currentInvoice, clientId: value})}
                        placeholder="Choose Enterprise..."
                        options={customerAccounts.map(c => ({ value: c.id, label: c.company }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[7px] font-black uppercase text-slate-500 ml-1">Invoice ID</label>
                      <input className="w-full h-[48px] p-4 bg-slate-100 rounded-xl text-xs font-mono font-bold outline-none focus:ring-4 focus:ring-cat-yellow/10 focus:border-cat-yellow transition-all" value={currentInvoice.id} onChange={(e) => setCurrentInvoice({...currentInvoice, id: e.target.value})} />
                    </div>
                    <div>
                      <label className="text-[7px] font-black uppercase text-slate-500 ml-1">Due Date</label>
                      <input type="date" className="w-full h-[48px] p-4 bg-slate-100 rounded-xl text-xs font-bold outline-none focus:ring-4 focus:ring-cat-yellow/10 focus:border-cat-yellow transition-all" value={currentInvoice.dueDate} onChange={(e) => setCurrentInvoice({...currentInvoice, dueDate: e.target.value})} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="card-app p-8 border-l-4 border-l-slate-400">
                <h3 className="text-[8px] font-black uppercase text-slate-400 mb-6 tracking-widest">Adjustments</h3>
                <div className="space-y-6">
                  <div>
                    <label className="text-[7px] font-black uppercase text-slate-500 ml-1">Tax Variable (%)</label>
                    <input type="number" className="w-full h-[48px] p-4 bg-slate-100 rounded-xl text-xs font-mono font-bold outline-none focus:ring-4 focus:ring-cat-yellow/10 focus:border-cat-yellow transition-all" value={currentInvoice.taxRate} onChange={(e) => setCurrentInvoice({...currentInvoice, taxRate: parseFloat(e.target.value) || 0})} />
                  </div>
                  <div>
                    <label className="text-[7px] font-black uppercase text-slate-500 ml-1">Fixed Rebate ($)</label>
                    <input type="number" className="w-full h-[48px] p-4 bg-slate-100 rounded-xl text-xs font-mono font-bold outline-none focus:ring-4 focus:ring-cat-yellow/10 focus:border-cat-yellow transition-all" value={currentInvoice.discount} onChange={(e) => setCurrentInvoice({...currentInvoice, discount: parseFloat(e.target.value) || 0})} />
                  </div>
                </div>
              </div>

              <div className="card-app p-8 border-l-4 border-l-indigo-400">
                <h3 className="text-[8px] font-black uppercase text-slate-400 mb-6 tracking-widest">Template & Automation</h3>
                <div className="space-y-6">
                  <div>
                    <label className="text-[7px] font-black uppercase text-slate-500 ml-1">Invoice Style</label>
                    <CustomSelect
                        value={selectedTemplateId}
                        onChange={setSelectedTemplateId}
                        options={DEFAULT_TEMPLATES.map(t => ({ value: t.id, label: t.name }))}
                    />
                  </div>
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <div>
                      <p className="text-[8px] font-black uppercase text-cat-black">Recurring Billing</p>
                      <p className="text-[7px] text-slate-400 uppercase">Monthly Schedule</p>
                    </div>
                    <button 
                      onClick={() => handleToggleRecurring(currentInvoice)}
                      className={`w-12 h-6 rounded-full transition-all relative ${recurringInvoices.some(r => r.clientId === currentInvoice.clientId && r.isActive) ? 'bg-emerald-500' : 'bg-slate-300'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${recurringInvoices.some(r => r.clientId === currentInvoice.clientId && r.isActive) ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex items-start gap-3">
                      <Link2 className="mt-0.5 h-4 w-4 flex-none text-emerald-700" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-[8px] font-black uppercase text-emerald-900">Customer Payment Link</p>
                        <p className="mt-1 text-[7px] font-bold leading-relaxed text-emerald-800">Stripe Checkout offers the payment methods configured for this invoice. This is separate from subscription billing.</p>
                        {currentPaymentLink ? (
                          <button type="button" onClick={handleCopyPaymentLink} className="mt-3 text-left text-[7px] font-black uppercase tracking-wider text-emerald-800 underline decoration-emerald-400 underline-offset-2">
                            Copy secure payment link
                          </button>
                        ) : (
                          <button type="button" onClick={handlePreparePaymentLink} disabled={isPreparingPaymentLink || !currentInvoice.clientId} className="mt-3 text-left text-[7px] font-black uppercase tracking-wider text-emerald-800 underline decoration-emerald-400 underline-offset-2 disabled:opacity-50">
                            {isPreparingPaymentLink ? 'Preparing secure link...' : 'Prepare secure payment link'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  {paymentLinkError && <p role="alert" className="text-[7px] font-bold leading-relaxed text-red-600">{paymentLinkError}</p>}
                  {currentInvoice.status === 'unpaid' && (
                    <button 
                      onClick={() => handleSendReminder(currentInvoice)}
                      className="w-full py-4 bg-amber-100 text-amber-700 rounded-xl text-[7px] font-black uppercase tracking-widest hover:bg-amber-200 transition-all btn-app shadow-sm"
                    >
                      Send Payment Reminder
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="lg:col-span-8 printable-area">
                <div 
                  className="bg-white rounded-[2.5rem] shadow-3xl overflow-hidden border border-slate-200 invoice-document relative print:border-t-8" 
                  style={{ 
                    borderTop: `10px solid ${activeTemplate.accentColor}`,
                    fontFamily: activeTemplate.fontFamily 
                  }}
                  data-status={currentInvoice.status}
                >
                  <div className="p-12 print:p-0 print-root">
                      {/* Header */}
                      <div className="flex justify-between items-start mb-16 print:mb-6 print-header">
                        <div className="flex items-center gap-10 print:gap-4">
                          {activeTemplate.showLogo && (
                            <div className="w-28 h-28 bg-white rounded-3xl flex items-center justify-center p-5 print:w-28 print:h-28 print:rounded-none shadow-2xl shadow-slate-200/50 print:shadow-none border border-slate-100">
                              {customLogo ? <img src={customLogo} className="w-full h-full object-contain" alt="Custom Logo" /> : <Logo className="w-full h-full" />}
                            </div>
                          )}
                          <div>
                            <h2 className="text-3xl font-black uppercase tracking-tighter" style={{ color: activeTemplate.primaryColor }}>American Iron LLC</h2>
                            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-[0.4em] mt-1.5">Caterpillar Support & Logistics</p>
                            <div className="text-left text-[7px] text-slate-500 mt-4 uppercase font-bold leading-relaxed print:text-[6.5pt] print:text-black print:mt-1">
                              <p>13930 N. Dale Mabry HWY. Site 5. Tampa, FL. 33618</p>
                              <p>Tel (850) 777-3797  Fax. (813) 249-9730</p>
                              <p className="text-cat-yellow">www.AmericanIronUS.com</p>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <h1 className="text-8xl font-black uppercase tracking-tighter mb-2 opacity-100 select-none print:text-black" style={{ color: activeTemplate.primaryColor }}>Invoice</h1>
                          <div className="space-y-1.5 relative z-10 bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                            <p className="text-xs font-black uppercase text-slate-400">REF ID: <span className="font-mono ml-2 text-cat-black">{currentInvoice.id}</span></p>
                            <p className="text-xs font-black uppercase text-slate-400">Issue Date: <span className="font-mono ml-2 text-cat-black">{currentInvoice.date}</span></p>
                          </div>
                        </div>
                      </div>

                      {/* Address Blocks */}
                      <div className="grid grid-cols-2 print:flex print:flex-row gap-8 mb-16 print:mb-6">
                         <AddressBlock title="Bill To Protocol" client={selectedClient} />
                         <div className="bg-slate-50 p-8 rounded-3xl border border-slate-200 text-[8px] h-full flex flex-col print:flex-1 print:p-3 print:border-slate-300 print:rounded-lg">
                           <h3 className="text-[7px] font-black uppercase tracking-[0.2em] text-cat-black mb-4 print:text-[7pt]">Commercial Detail</h3>
                           <div className="grid grid-cols-1 gap-3 text-xs">
                              <p className="font-black uppercase text-slate-400">Due Date: <span className="text-cat-black font-bold ml-2">{currentInvoice.dueDate}</span></p>
                              <p className="font-black uppercase text-slate-400">Status: <span className={`ml-2 font-black px-2 py-0.5 rounded ${currentInvoice.status === 'paid' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>{currentInvoice.status}</span></p>
                           </div>
                         </div>
                      </div>

                      {/* Line Items */}
                      <table className="w-full border-collapse table-fixed mb-12 print:mb-6">
                        <colgroup>
                          <col style={{ width: '52%' }} />
                          <col style={{ width: '16%' }} />
                          <col style={{ width: '16%' }} />
                          <col style={{ width: '16%' }} />
                        </colgroup>
                        <thead>
                          <tr className="text-[8px] font-black uppercase tracking-widest print:text-[6px]" style={{ backgroundColor: activeTemplate.primaryColor, color: activeTemplate.accentColor }}>
                            <th className="py-4 px-6 first:rounded-l-2xl print:rounded-none text-left" style={{ color: activeTemplate.accentColor }}>Description of Service</th>
                            <th className="py-4 px-2 text-right num-col" style={{ color: activeTemplate.accentColor }}>Hours/Qty</th>
                            <th className="py-4 px-6 text-right num-col" style={{ color: activeTemplate.accentColor }}>Rate</th>
                            <th className="py-4 px-6 last:rounded-r-2xl print:rounded-none text-right num-col" style={{ color: activeTemplate.accentColor }}>Line Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentInvoice.items.map((item, idx) => (
                            <tr key={item.id} className="border-b border-slate-100 group transition-all hover:bg-slate-50/50">
                              <td className="py-6 px-6 align-top">
                                <div className="flex items-start gap-4 w-full">
                                  {(item.imageUrl || (item.originalImages && item.originalImages.length > 0)) && (
                                    <div className="w-16 h-16 bg-white border border-slate-200 rounded-xl overflow-hidden flex-shrink-0 shadow-sm part-img-container transition-transform group-hover:scale-105 print:mr-2 print:shadow-none print:rounded-none">
                                      <PartImage 
                                        partNo={item.id} 
                                        photoMode={item.imageUrl ? PhotoMode.AI : PhotoMode.EXTRACT} 
                                        originalImages={item.originalImages || []} 
                                        aiImageUrl={item.imageUrl}
                                        isGenerating={false} 
                                      />
                                    </div>
                                  )}
                                  <div className="flex-grow min-w-0 pt-1">
                                    <input 
                                      className="w-full bg-transparent border-none text-[9px] font-bold uppercase outline-none focus:text-cat-black print:text-black line-item-desc placeholder:text-slate-300"
                                      placeholder="Describe component/service..."
                                      value={item.description}
                                      onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="py-6 px-2 align-top pt-7">
                                <input type="text" className="w-full bg-transparent border-none text-[8px] font-mono font-bold text-right outline-none print:text-black num-col" value={localValues[`${item.id}-hours`] || ''} onChange={(e) => updateItem(item.id, 'hours', e.target.value)} onBlur={() => handleBlur(item.id, 'hours')} />
                              </td>
                              <td className="py-6 px-6 align-top pt-7">
                                <input type="text" className="w-full bg-transparent border-none text-[8px] font-mono font-bold text-right outline-none print:text-black num-col" value={localValues[`${item.id}-rate`] || ''} onChange={(e) => updateItem(item.id, 'rate', e.target.value)} onBlur={() => handleBlur(item.id, 'rate')} />
                              </td>
                              <td className="py-6 px-6 align-top pt-7"><input readOnly className="w-full bg-transparent border-none text-[8px] font-mono font-black text-right outline-none print:text-black num-col" value={`${formatCurrency(item.hours * item.rate)}`} /></td>
                              <td className="w-0 no-print pt-7"><button onClick={() => deleteItem(item.id)} className="p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">✕</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                       <button onClick={handleAddItem} className="w-full py-5 border-2 border-dashed border-slate-200 rounded-2xl text-[8px] font-black uppercase text-slate-400 hover:border-cat-yellow hover:text-cat-black hover:bg-cat-yellow/5 transition-all no-print">
                        Add Service Protocol Line
                      </button>

                      {/* Summary Section */}
                      <div className="grid grid-cols-12 gap-12 mt-12 totals-container-print">
                        <div className="col-span-7 print:w-[58%]">
                          <div className="space-y-4 terms-box">
                             <div className="text-[8px] text-slate-400 uppercase font-black tracking-widest print:text-black">Notes & Terms</div>
                             <div className="invoice-notes-print hidden print:block text-[8pt] text-slate-600 leading-relaxed italic p-4 border border-slate-200 rounded-lg">
                                {currentInvoice.notes || "All services are billed at standard shop rates. Parts are subject to standard warranty. American Iron LLC is not liable for incidental or consequential damages."}
                             </div>
                             <textarea className="w-full bg-slate-50 rounded-3xl p-8 text-[8px] font-bold uppercase leading-relaxed text-slate-600 h-40 resize-none no-print border-none focus:bg-white transition-all shadow-inner focus:ring-4 focus:ring-cat-yellow/5" placeholder="Enter special instructions..." value={currentInvoice.notes} onChange={(e) => setCurrentInvoice({...currentInvoice, notes: e.target.value})} />
                          </div>
                        </div>

                        <div className="col-span-5 print:w-[42%]">
                          <table className="w-full summary-table">
                             <tbody className="space-y-2">
                                 <tr className="text-[8px] print:text-[7pt]"><td className="py-1 uppercase tracking-wider font-bold text-slate-400 print:text-slate-700">Subtotal</td><td className="py-1 font-mono font-bold text-cat-black num-col">{`${formatCurrency(subtotal)}`}</td></tr>
                                 <tr className="text-[8px] print:text-[7pt]"><td className="py-1 uppercase tracking-wider font-bold text-slate-400 print:text-slate-700">{`Tax (${currentInvoice.taxRate}%)`}</td><td className="py-1 font-mono font-bold text-cat-black num-col">{`${formatCurrency(tax)}`}</td></tr>
                                 {currentInvoice.discount > 0 && (<tr className="text-[8px] print:text-[7pt]"><td className="py-1 uppercase tracking-wider font-bold text-slate-400 print:text-slate-700">Rebate</td><td className="py-1 font-mono font-bold text-cat-black num-col">{`-${formatCurrency(currentInvoice.discount)}`}</td></tr>)}
                                 <tr className="text-lg print:text-[10pt]"><td className="pt-4 border-t-4 uppercase tracking-tighter font-black" style={{ borderTopColor: activeTemplate.primaryColor, color: activeTemplate.primaryColor }}>Total Due</td><td className="pt-4 border-t-4 font-mono font-black num-col" style={{ borderTopColor: activeTemplate.primaryColor, color: activeTemplate.primaryColor }}>{`${formatCurrency(total)}`}</td></tr>
                             </tbody>
                          </table>
                           <div className="mt-8 p-6 rounded-2xl print:p-3 print:mt-3 shadow-2xl shadow-slate-200 print:shadow-none print:border print:border-black print:rounded-lg" style={{ backgroundColor: activeTemplate.primaryColor, color: activeTemplate.accentColor }}>
                              <p className="text-[7px] font-black uppercase tracking-[0.3em] opacity-60 mb-1.5 print:opacity-100" style={{ color: activeTemplate.accentColor }}>Commercial Terms</p>
                              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: activeTemplate.accentColor }}>NET 30 DAYS</p>
                           </div>
                           {currentPaymentLink && (
                             <div className="invoice-payment-print hidden print:block">
                               <p className="font-black uppercase tracking-wider">Secure online payment</p>
                               <p className="mt-1">Choose a payment method through Stripe:</p>
                               <a href={currentPaymentLink}>{currentPaymentLink}</a>
                             </div>
                           )}
                        </div>
                      </div>
                      
                      <div className="invoice-print-footer">
                        <p className="font-sans">
                          <strong>NEW PARTS TERMS / WARRANTY DISCLAIMER / LIMITATION OF LIABILITY:</strong> ALL PRODUCTS SOLD BY AMERICAN IRON LLC ARE BRAND NEW. EXCEPT AS EXPRESSLY STATED IN WRITING BY SELLER, SELLER DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING ANY IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. ANY WARRANTY COVERAGE OFFERED WITH THE PRODUCT (IF ANY) IS PROVIDED SOLELY BY THE PRODUCT’S MANUFACTURER AND IS GOVERNED BY THE MANUFACTURER’S WARRANTY TERMS, PROCEDURES, AND LIMITATIONS; SELLER DOES NOT CONTROL MANUFACTURER WARRANTY DETERMINATIONS. BUYER IS SOLELY RESPONSIBLE FOR CONFIRMING PART NUMBER ACCURACY, COMPATIBILITY, SERIAL-NUMBER RANGE/APPLICATION, AND PROPER INSTALLATION. SELLER SHALL NOT BE LIABLE FOR LABOR, REMOVAL/INSTALLATION, TRAVEL, TOWING, FREIGHT, DOWNTIME, LOSS OF PROFITS, LOSS OF USE, OR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES. SELLER’S MAXIMUM LIABILITY FOR ANY CLAIM IS LIMITED TO THE INVOICE PRICE PAID FOR THE SPECIFIC ITEM(S) GIVING RISE TO THE CLAIM, AT SELLER’S OPTION. TITLE AND RISK OF LOSS TRANSFER UPON PICKUP OR TENDER TO CARRIER UNLESS OTHERWISE AGREED IN WRITING.
                        </p>
                      </div>
                  </div>
                  
                  <div className="print-footer">
                      <p>13930 N. DALE MABRY HWY. SITE 5. TAMPA, FL. 33618</p>
                      <p>TEL (850) 777-3797 FAX. (813) 249-9730</p>
                      <p>WWW.AMERICANIRONUS.COM</p>
                  </div>
                </div>
            </div>
          </div>
        </>
      )}

      {/* Print Footer */}
    </div>
  );
};
