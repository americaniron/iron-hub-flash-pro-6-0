
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { User, CustomerAccount, InvoiceData, Payment, SavedQuote } from '../types.ts';
import { PaymentReceipt } from './PaymentReceipt.tsx';
import { exportContacts } from '../services/exportService.ts';
import { Download, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';

// --- High-Fidelity UI Components ---
const CustomSelect: React.FC<{
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}> = ({ options, value, onChange, placeholder, className }) => {
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
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-full min-h-[46px] px-3.5 bg-slate-100 border-2 border-transparent text-slate-900 rounded-xl text-xs font-bold focus:bg-white outline-none focus:ring-2 focus:ring-cat-yellow/30 focus:border-cat-yellow transition-all flex items-center justify-between text-left"
      >
        <span className={selectedOption ? "text-cat-black" : "text-slate-500"}>{selectedLabel}</span>
        <svg className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"></path></svg>
      </button>
      {isOpen && (
        <div className="absolute top-full mt-2 w-full bg-white rounded-xl shadow-2xl border p-1.5 z-10 animate-in fade-in zoom-in-95 max-h-60 overflow-y-auto">
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-xs font-bold rounded-lg hover:bg-slate-100 flex items-center justify-between transition-colors"
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

interface AccountsSystemProps {
    currentUser: User;
    accounts: CustomerAccount[];
    invoices: InvoiceData[];
    payments: Payment[];
    quoteHistory: SavedQuote[];
    onSavePayments: (payments: Payment[]) => void;
    onSaveAccounts: (accounts: CustomerAccount[]) => Promise<void>;
    onDeleteAccount: (accountId: string) => void;
    onNewDocument: (customerId: string, type: 'quote' | 'invoice') => void;
}

const StatCard: React.FC<{ label: string; value: string; icon: React.ReactNode; color?: string }> = ({ label, value, icon, color = 'emerald' }) => {
    const colorClasses = {
        emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-l-emerald-500' },
        amber: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-l-amber-500' },
        indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-l-indigo-500' },
    };
    const c = colorClasses[color as keyof typeof colorClasses] || colorClasses.emerald;

    return (
        <div className={`p-6 rounded-2xl flex items-center gap-5 border-l-4 shadow-sm ${c.bg} ${c.border} transition-all hover:shadow-md`}>
            <div className={`w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm ${c.text}`}>{icon}</div>
            <div>
                <div className={`text-2xl font-black font-mono text-slate-900 tracking-tighter`}>{value}</div>
                <div className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mt-0.5">{label}</div>
            </div>
        </div>
    );
};

const AppInput: React.FC<{ label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void; isTextarea?: boolean; className?: string; }> = ({ label, value, onChange, isTextarea = false, className }) => (
    <div className={`space-y-2 ${className}`}>
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">{label}</label>
        {isTextarea ? (
            <textarea value={value} onChange={onChange} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/10 focus:border-cat-yellow transition-all h-32 resize-none shadow-inner" />
        ) : (
            <input value={value} onChange={onChange} className="w-full h-[48px] p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold focus:bg-white outline-none focus:ring-4 focus:ring-cat-yellow/10 focus:border-cat-yellow transition-all shadow-inner" />
        )}
    </div>
);

const PaymentReceiptModal: React.FC<{
  payment: Payment;
  account: CustomerAccount;
  invoice?: InvoiceData;
  onClose: () => void;
}> = ({ payment, account, invoice, onClose }) => {

  const handlePrint = () => {
    try {
      window.focus();
      window.print();
      if (window.self !== window.top) {
        console.warn("Print triggered in iframe context.");
      }
    } catch (e) {
      alert("Printing is restricted in this preview. Please press Ctrl+P or open in a new tab.");
    }
  };

  const handleEmail = () => {
    const subject = `Payment Receipt from American Iron LLC (Ref: ${payment.id})`;
    const body = `Dear ${account.contactName || account.company},

Thank you for your payment of $${payment.amount.toFixed(2)} received on ${payment.date}.
This payment has been applied to Invoice #${payment.invoiceId}.

We appreciate your business.

Sincerely,
The American Iron Team`;

    window.location.href = `mailto:${account.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[300] flex items-center justify-center p-4 no-print">
      <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[95vh]">
        <div className="p-6 border-b flex justify-between items-center bg-slate-50">
            <h3 className="text-lg font-black uppercase tracking-wider text-slate-800">Payment Receipt</h3>
            <div className="flex gap-2">
                <button onClick={handleEmail} className="px-5 py-2.5 bg-cat-yellow text-cat-black text-[10px] font-bold uppercase rounded-lg btn-app">Email Receipt</button>
                <button onClick={handlePrint} className="px-5 py-2.5 bg-cat-black text-white text-[10px] font-bold uppercase rounded-lg btn-app">Print / Save PDF</button>
                <button onClick={onClose} className="p-2.5 bg-slate-200 text-slate-600 rounded-lg btn-app">✕</button>
            </div>
        </div>
        <div className="flex-grow overflow-y-auto">
            <PaymentReceipt payment={payment} account={account} invoice={invoice} />
        </div>
      </div>
    </div>
  );
};

const ImportModal: React.FC<{
  onClose: () => void;
  onImport: (file: File) => Promise<void>;
}> = ({ onClose, onImport }) => {
    const [file, setFile] = useState<File | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFile(e.target.files[0]);
        }
    };

    const handleImportClick = async () => {
        if (!file) {
            alert("Please select a file.");
            return;
        }
        setIsLoading(true);
        await onImport(file);
        setIsLoading(false);
    };

    return (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[300] flex items-center justify-center p-4 no-print">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b flex justify-between items-center bg-slate-50">
                <h3 className="text-lg font-black uppercase tracking-wider text-slate-800">Import Customer Accounts</h3>
                <button onClick={onClose} className="p-2.5 bg-slate-200 text-slate-600 rounded-lg btn-app">✕</button>
            </div>
            <div className="p-8 space-y-6">
                <div>
                    <h4 className="font-bold text-sm mb-2">Instructions</h4>
                    <p className="text-xs text-slate-600">Upload a CSV or Excel file. The system will auto-detect columns like 'Company', 'Contact', 'Email', etc.</p>
                </div>
                
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cat-yellow file:text-cat-black hover:file:bg-cat-yellow/80"/>
                
                {file && <p className="text-xs text-slate-500 font-bold">Selected: {file.name}</p>}

                <button 
                    onClick={handleImportClick} 
                    disabled={isLoading || !file}
                    className="w-full py-4 bg-cat-black text-white rounded-xl font-black uppercase text-[10px] tracking-[0.2em] shadow-xl btn-app hover:bg-cat-gray disabled:bg-slate-300"
                >
                    {isLoading ? 'Processing...' : 'Import Data'}
                </button>
            </div>
          </div>
        </div>
    );
};

const Dashboard: React.FC<{ 
  invoices: InvoiceData[]; 
  payments: Payment[]; 
  accounts: CustomerAccount[];
  onSelectAccount: (id: string) => void;
}> = ({ invoices, payments, accounts, onSelectAccount }) => {
  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0,0,0,0);
    
    const unpaidInvoices = invoices.filter(i => i.status !== 'paid');
    const totalReceivables = unpaidInvoices.reduce((sum, i) => sum + i.total, 0);
    const overdueInvoices = unpaidInvoices.filter(i => new Date(i.dueDate) < today);
    const totalOverdue = overdueInvoices.reduce((sum, i) => sum + i.total, 0);
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const collectedLast30Days = payments.filter(p => new Date(p.date) >= thirtyDaysAgo).reduce((sum, p) => sum + p.amount, 0);

    const accountBalances = accounts.map(acc => {
      const accInvoices = invoices.filter(i => i.clientId === acc.id);
      const accPayments = payments.filter(p => p.clientId === acc.id);
      const balance = accInvoices.reduce((sum, i) => sum + i.total, 0) - accPayments.reduce((sum, p) => sum + p.amount, 0);
      return { ...acc, balance };
    });

    const topDebtors = accountBalances.filter(a => a.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 5);
    
    return { totalReceivables, totalOverdue, collectedLast30Days, topDebtors, overdueInvoices };
  }, [invoices, payments, accounts]);

  const getAccountById = (id: string) => accounts.find(a => a.id === id);

  return (
    <div className="space-y-8 animate-in fade-in">
        <h2 className="text-3xl font-black uppercase text-cat-black tracking-tighter">Financial Dashboard</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <StatCard label="Total Receivables" value={`${stats.totalReceivables.toLocaleString('en-US', {minimumFractionDigits: 2})}`} icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v.01M12 6v-1.667a1.667 1.667 0 01.425-1.142A1.667 1.667 0 0112 3c1.657 0 3 1.343 3 3s-1.343 3-3 3m0 0c-1.11 0-2.08-.402-2.599-1M12 12V7m0 5v.01M12 18v-1.667a1.667 1.667 0 00-.425-1.142A1.667 1.667 0 0012 15c-1.657 0-3-1.343-3-3s1.343-3 3-3"></path></svg>} color="indigo" />
            <StatCard label="Total Overdue" value={`${stats.totalOverdue.toLocaleString('en-US', {minimumFractionDigits: 2})}`} icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>} color="amber" />
            <StatCard label="Collected (30 Days)" value={`${stats.collectedLast30Days.toLocaleString('en-US', {minimumFractionDigits: 2})}`} icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>} color="emerald" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="card-app p-8">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6">Priority: Overdue Invoices</h3>
                <div className="space-y-3 max-h-80 overflow-y-auto custom-scrollbar pr-2">
                    {stats.overdueInvoices.length > 0 ? stats.overdueInvoices.map(inv => (
                        <div key={inv.id} className="p-4 bg-amber-50 rounded-2xl flex justify-between items-center text-xs border border-amber-100 transition-all hover:bg-amber-100/50">
                            <div>
                                <p className="font-black text-amber-900 uppercase tracking-tight">{getAccountById(inv.clientId)?.company}</p>
                                <p className="text-amber-600 font-mono text-[10px] mt-0.5">{inv.id} &bull; Due: {inv.dueDate}</p>
                            </div>
                            <p className="font-mono font-black text-amber-900">${(inv.total ?? 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                        </div>
                    )) : <p className="text-center text-xs text-slate-400 py-16 font-bold uppercase tracking-widest">No overdue invoices. System nominal.</p>}
                </div>
            </div>
            <div className="card-app p-8">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6">Top Accounts by Balance</h3>
                <div className="space-y-3 max-h-80 overflow-y-auto custom-scrollbar pr-2">
                    {stats.topDebtors.length > 0 ? stats.topDebtors.map(acc => (
                         <div key={acc.id} onClick={() => onSelectAccount(acc.id)} className="p-4 bg-indigo-50 rounded-2xl flex justify-between items-center text-xs cursor-pointer hover:bg-indigo-100 transition-all border border-indigo-100">
                            <p className="font-black text-indigo-900 uppercase tracking-tight">{acc.company}</p>
                            <p className="font-mono font-black text-indigo-900">${acc.balance.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                        </div>
                    )) : <p className="text-center text-xs text-slate-400 py-16 font-bold uppercase tracking-widest">All accounts settled.</p>}
                </div>
            </div>
        </div>
    </div>
  );
};

const CustomerProfile: React.FC<{ 
    account: CustomerAccount,
    invoices: InvoiceData[],
    payments: Payment[],
    quotes: SavedQuote[],
    onSave: (updatedAccount: CustomerAccount) => void,
    onDelete: () => void,
    onAddPayment: (payment: Omit<Payment, 'id' | 'clientId'>) => void,
    onNewDocument: (type: 'quote' | 'invoice') => void,
    onShowReceipt: (payment: Payment) => void,
}> = ({ account, invoices, payments, quotes, onSave, onDelete, onAddPayment, onNewDocument, onShowReceipt }) => {
    const [editingAccount, setEditingAccount] = useState(account);
    const [activeTab, setActiveTab] = useState<'invoices' | 'quotes' | 'payments'>('invoices');
    const [newPayment, setNewPayment] = useState({ amount: '', invoiceId: '', method: 'Wire' as Payment['method'], date: new Date().toISOString().split('T')[0] });

    useEffect(() => {
        setEditingAccount(account);
        const unpaid = invoices.filter(i => i.status !== 'paid');
        setNewPayment({ amount: '', invoiceId: unpaid[0]?.id || '', method: 'Wire', date: new Date().toISOString().split('T')[0] });
    }, [account, invoices]);

    const handleChange = (field: keyof CustomerAccount, value: string) => {
        setEditingAccount(prev => ({...prev, [field]: value}));
    };
    
    const handleSave = () => {
        onSave(editingAccount);
        alert("Account details updated.");
    };

    const handleAddPayment = () => {
        if (!newPayment.amount || !newPayment.invoiceId) {
            alert("Please select an invoice and enter an amount.");
            return;
        }
        onAddPayment({
            ...newPayment,
            amount: parseFloat(newPayment.amount)
        });
        const unpaid = invoices.filter(i => i.status !== 'paid');
        setNewPayment({ amount: '', invoiceId: unpaid[0]?.id || '', method: 'Wire', date: new Date().toISOString().split('T')[0] });
    };

    const unpaidInvoices = useMemo(() => invoices.filter(i => i.status !== 'paid'), [invoices]);

    const { totalBilled, totalPaid, balanceDue } = useMemo(() => {
        const totalBilled = invoices.reduce((sum, inv) => sum + inv.total, 0);
        const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
        return { totalBilled, totalPaid, balanceDue: totalBilled - totalPaid };
    }, [invoices, payments]);

    return (
        <div className="space-y-8 animate-in fade-in">
            <div className="card-app p-8 border-l-4 border-l-emerald-500 no-print">
                <div className="flex justify-between items-start mb-8">
                    <div>
                      <h3 className="text-2xl font-black uppercase tracking-tighter text-cat-black">{editingAccount.company}</h3>
                      <div className="flex gap-3 mt-4">
                        <button onClick={() => onNewDocument('quote')} className="px-5 py-2.5 bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest rounded-xl btn-app hover:bg-cat-yellow hover:text-cat-black">New Quote</button>
                        <button onClick={() => onNewDocument('invoice')} className="px-5 py-2.5 bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest rounded-xl btn-app hover:bg-indigo-600 hover:text-white">New Invoice</button>
                      </div>
                    </div>
                    <div className="flex gap-3">
                        <button onClick={onDelete} className="px-6 py-3.5 bg-red-50 text-red-600 font-black text-[10px] uppercase tracking-widest rounded-xl btn-app hover:bg-red-600 hover:text-white">Delete Account</button>
                        <button onClick={handleSave} className="px-8 py-3.5 bg-cat-black text-white font-black text-[10px] uppercase tracking-widest rounded-xl btn-app hover:bg-cat-dark shadow-xl shadow-cat-black/10">Save Changes</button>
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-6">
                    <StatCard label="Total Billed" value={`${totalBilled.toFixed(2)}`} icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 8h6m-5 4h.01M4 16V6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z"></path></svg>} color="indigo" />
                    <StatCard label="Total Paid" value={`${totalPaid.toFixed(2)}`} icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>} color="emerald" />
                    <StatCard label="Balance Due" value={`${balanceDue.toFixed(2)}`} icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v.01M12 6v-1.667a1.667 1.667 0 01.425-1.142A1.667 1.667 0 0112 3c1.657 0 3 1.343 3 3s-1.343 3-3 3m0 0c-1.11 0-2.08-.402-2.599-1M12 12V7m0 5v.01M12 18v-1.667a1.667 1.667 0 00-.425-1.142A1.667 1.667 0 0012 15c-1.657 0-3-1.343-3-3s1.343-3 3-3"></path></svg>} color="amber" />
                </div>
            </div>

            <div className="card-app p-8 no-print">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6">Customer Profile</h4>
                <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                    <AppInput label="Contact Name" value={editingAccount.contactName} onChange={e => handleChange('contactName', e.target.value)} />
                    <AppInput label="Contact Email" value={editingAccount.email} onChange={e => handleChange('email', e.target.value)} />
                    <AppInput label="Contact Phone" value={editingAccount.phone} onChange={e => handleChange('phone', e.target.value)} />
                    <AppInput label="Account Number" value={editingAccount.accountNumber} onChange={e => handleChange('accountNumber', e.target.value)} />
                    <AppInput label="WhatsApp Number" value={editingAccount.whatsapp || ''} onChange={e => handleChange('whatsapp', e.target.value)} />
                    <AppInput label="Business Website" value={editingAccount.website || ''} onChange={e => handleChange('website', e.target.value)} />

                    <AppInput label="Billing Address" value={editingAccount.billingAddress} onChange={e => handleChange('billingAddress', e.target.value)} />
                    <AppInput label="Billing City" value={editingAccount.billingCity} onChange={e => handleChange('billingCity', e.target.value)} />
                    <AppInput label="Billing State" value={editingAccount.billingState} onChange={e => handleChange('billingState', e.target.value)} />
                    <AppInput label="Billing ZIP" value={editingAccount.billingZip} onChange={e => handleChange('billingZip', e.target.value)} />

                    <AppInput label="Shipping Address" value={editingAccount.shippingAddress} onChange={e => handleChange('shippingAddress', e.target.value)} />
                    <AppInput label="Shipping City" value={editingAccount.shippingCity} onChange={e => handleChange('shippingCity', e.target.value)} />
                    <AppInput label="Shipping State" value={editingAccount.shippingState} onChange={e => handleChange('shippingState', e.target.value)} />
                    <AppInput label="Shipping ZIP" value={editingAccount.shippingZip} onChange={e => handleChange('shippingZip', e.target.value)} />

                    <AppInput label="Internal Notes" value={editingAccount.internalNotes || ''} onChange={e => handleChange('internalNotes', e.target.value)} isTextarea={true} className="col-span-2" />
                </div>
            </div>
            
            <div className="card-app p-8 no-print">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6">Record Payment</h4>
                <div className="grid grid-cols-12 gap-4 items-end">
                    <div className="col-span-6 space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Select Invoice</label>
                      <CustomSelect 
                          placeholder="Select Invoice..."
                          value={newPayment.invoiceId} 
                          onChange={value => setNewPayment({...newPayment, invoiceId: value})}
                          options={unpaidInvoices.map(inv => ({ value: inv.id, label: `${inv.id} (${inv.total.toFixed(2)})`}))}
                      />
                    </div>
                    <div className="col-span-3 space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Amount</label>
                      <input type="number" placeholder="Amount" value={newPayment.amount} onChange={e => setNewPayment({...newPayment, amount: e.target.value})} className="w-full h-[48px] p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-mono font-black shadow-inner outline-none focus:ring-4 focus:ring-cat-yellow/10 focus:border-cat-yellow transition-all" />
                    </div>
                    <button onClick={handleAddPayment} className="w-full h-[48px] bg-emerald-600 text-white font-black text-[10px] uppercase tracking-widest rounded-2xl col-span-3 btn-app shadow-lg shadow-emerald-600/10">Add Payment</button>
                </div>
            </div>

            <div className="card-app p-8 no-print">
                 <div className="flex p-1.5 bg-slate-100 rounded-2xl mb-8">
                     <button onClick={() => setActiveTab('invoices')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'invoices' ? 'bg-white text-cat-black shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Invoice History ({invoices.length})</button>
                     <button onClick={() => setActiveTab('quotes')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'quotes' ? 'bg-white text-cat-black shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Quote History ({quotes.length})</button>
                     <button onClick={() => setActiveTab('payments')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'payments' ? 'bg-white text-cat-black shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Payment History ({payments.length})</button>
                 </div>
                 <div className="max-h-96 overflow-y-auto custom-scrollbar pr-2">
                   {activeTab === 'invoices' && (
                       <table className="w-full text-xs">
                           <thead><tr className="border-b text-left font-black uppercase text-slate-400 tracking-widest text-[9px]"><th className="pb-4">ID</th><th className="pb-4">Date</th><th className="pb-4">Total</th><th className="pb-4">Status</th></tr></thead>
                           <tbody className="divide-y divide-slate-50">{invoices.map(i => <tr key={i.id} className="hover:bg-slate-50/50 transition-colors">
                               <td className="py-4 font-mono font-bold text-cat-black">{i.id.slice(-8)}</td><td className="py-4 text-slate-500 font-bold">{i.date}</td><td className="py-4 font-mono font-black text-cat-black">${i.total.toFixed(2)}</td><td className="py-4"><span className={`uppercase font-black px-2 py-0.5 rounded text-[9px] ${i.status === 'paid' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>{i.status}</span></td>
                           </tr>)}</tbody>
                       </table>
                 )}
                  {activeTab === 'quotes' && (
                      <table className="w-full text-xs">
                          <thead><tr className="border-b text-left font-black uppercase text-slate-400 tracking-widest text-[9px]"><th className="pb-4">ID</th><th className="pb-4">Date</th><th className="pb-4">Title</th><th className="pb-4">Total</th></tr></thead>
                          <tbody className="divide-y divide-slate-50">{quotes.map(q => <tr key={q.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="py-4 font-mono font-bold text-cat-black">{q.id.slice(-8)}</td><td className="py-4 text-slate-500 font-bold">{new Date(q.timestamp).toLocaleDateString()}</td><td className="py-4 font-bold text-slate-600 uppercase truncate max-w-[200px]">{q.title}</td><td className="py-4 font-mono font-black text-cat-black">${q.total.toFixed(2)}</td>
                          </tr>)}</tbody>
                      </table>
                  )}
                  {activeTab === 'payments' && (
                       <table className="w-full text-xs">
                          <thead><tr className="border-b text-left font-black uppercase text-slate-400 tracking-widest text-[9px]"><th className="pb-4">ID</th><th className="pb-4">Date</th><th className="pb-4">Amount</th><th className="pb-4">Method</th></tr></thead>
                          <tbody className="divide-y divide-slate-50">{payments.map(p => <tr key={p.id} onClick={() => onShowReceipt(p)} className="cursor-pointer hover:bg-slate-50 transition-colors group">
                              <td className="py-4 font-mono font-bold text-cat-black group-hover:text-emerald-600">{p.id.slice(-8)}</td><td className="py-4 text-slate-500 font-bold">{p.date}</td><td className="py-4 font-mono font-black text-emerald-600">${p.amount.toFixed(2)}</td><td className="py-4 font-black uppercase text-slate-400">{p.method}</td>
                          </tr>)}</tbody>
                      </table>
                  )}
                 </div>
            </div>
        </div>
    );
};

export const AccountsSystem: React.FC<AccountsSystemProps> = ({ currentUser, accounts, invoices, payments, quoteHistory, onSavePayments, onSaveAccounts, onDeleteAccount, onNewDocument }) => {
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
    const [receiptToShow, setReceiptToShow] = useState<Payment | null>(null);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncMessage, setSyncMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);
    
    const handleSyncCRM = async () => {
        // TODO: re-wire to authenticated POST /api/crm/sync once Round 3 auth lands.
        // Previously POSTed full account list (PII) to https://iron-hub-suite.replit.app/api/sync
        // with no authentication and a wide-open CORS policy. Removed in C-4.
        setIsSyncing(true);
        setSyncMessage({ type: 'error', text: 'CRM sync is temporarily unavailable while authentication is being upgraded. Use Import/Export for now.' });
        setTimeout(() => {
            setIsSyncing(false);
            setSyncMessage(null);
        }, 4000);
    };

    const selectedAccount = useMemo(() => {
        return accounts.find(a => a.id === selectedAccountId);
    }, [selectedAccountId, accounts]);

    const accountInvoices = useMemo(() => invoices.filter(i => i.clientId === selectedAccountId), [invoices, selectedAccountId]);
    const accountPayments = useMemo(() => payments.filter(p => p.clientId === selectedAccountId), [payments, selectedAccountId]);
    const accountQuotes = useMemo(() => {
        if (!selectedAccount) return [];
        return quoteHistory.filter(q => q.payload.client.accountNumber === selectedAccount.accountNumber);
    }, [quoteHistory, selectedAccount]);

    const receiptInvoice = useMemo(() => {
        if (!receiptToShow) return undefined;
        return invoices.find(inv => inv.id === receiptToShow.invoiceId);
    }, [receiptToShow, invoices]);

    const handleFileImport = async (file: File) => {
        try {
            const data = await file.arrayBuffer();
            const workbook = window.XLSX.read(data, { type: 'array' });

            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            if (!worksheet) {
                throw new Error("No valid sheet found in the file.");
            }
            
            const jsonData: any[] = window.XLSX.utils.sheet_to_json(worksheet);

            if (jsonData.length === 0) {
                alert("Import failed: The file appears to be empty or has no data rows.");
                return;
            }

            const updatedAccounts = [...accounts];
            let newAccountsCount = 0;
            let updatedAccountsCount = 0;

            const normalize = (key: string) => key.toString().toLowerCase().replace(/[^a-z0-9]/g, '');

            for (const rawRow of jsonData) {
                const row: {[key: string]: any} = {};
                for (const key in rawRow) {
                    if (Object.prototype.hasOwnProperty.call(rawRow, key)) {
                        row[normalize(key)] = rawRow[key];
                    }
                }
                
                const companyAliases = ['businessname', 'business', 'company', 'companyname', 'account', 'accountname', 'organization', 'firm', 'client', 'clientname', 'customer', 'customername', 'legalname', 'entity', 'entityname'];
                let companyName = '';
                for (const alias of companyAliases) {
                    if (row[alias]) {
                        companyName = String(row[alias]).trim();
                        break;
                    }
                }

                if (!companyName) {
                    continue; 
                }

                const newAccountData: Partial<CustomerAccount> = {};
                const mappings: {[key in keyof Partial<CustomerAccount>]: string[]} = {
                    contactName: ['contactname', 'contact', 'person', 'fullname', 'name', 'attention', 'rep', 'representative', 'liaison'],
                    email: ['email', 'emailaddress', 'mail', 'contactemail'],
                    website: ['website', 'web', 'url', 'site', 'businesswebsite'],
                    whatsapp: ['whatsapp', 'whatsappnumber', 'mobile', 'cell'],
                    phone: ['phone', 'phonenumber', 'telephone', 'tel', 'office', 'main', 'workphone', 'officephone'],
                    billingAddress: ['billingaddress', 'address', 'street', 'billingstreet', 'billtoaddress', 'address1', 'streetaddress'],
                    billingCity: ['billingcity', 'city', 'town', 'billtocity'],
                    billingState: ['billingstate', 'state', 'province', 'region', 'billtostate'],
                    billingZip: ['billingzip', 'zip', 'postal', 'zipcode', 'postalcode', 'billtozip'],
                    billingCountry: ['billingcountry', 'country', 'nation', 'billtocountry'],
                    shippingAddress: ['shippingaddress', 'shipaddress', 'shiptoaddress', 'shipstreet', 'deliveryaddress'],
                    shippingCity: ['shippingcity', 'shipcity', 'shiptocity', 'deliverycity'],
                    shippingState: ['shippingstate', 'shipstate', 'shiptostate', 'deliverystate'],
                    shippingZip: ['shippingzip', 'shipzip', 'shiptozip', 'deliveryzip'],
                    shippingCountry: ['shippingcountry', 'shipcountry', 'shiptocountry', 'deliverycountry']
                };

                for (const key in mappings) {
                    const aliases = (mappings as any)[key];
                    if (aliases) {
                        for (const alias of aliases) {
                            if (row[alias] !== undefined && row[alias] !== null) {
                                const value = String(row[alias]).trim();
                                // FIX: Only process non-empty values to prevent accidental data erasure on updates.
                                if (value) {
                                    (newAccountData as any)[key] = value;
                                }
                                break; 
                            }
                        }
                    }
                }
                
                // FIX: If shipping information is missing, intelligently default it to billing information.
                // This ensures address consistency for both new and updated accounts.
                const shippingFields: (keyof CustomerAccount)[] = ['shippingAddress', 'shippingCity', 'shippingState', 'shippingZip', 'shippingCountry'];
                const billingFields: (keyof CustomerAccount)[] = ['billingAddress', 'billingCity', 'billingState', 'billingZip', 'billingCountry'];
                shippingFields.forEach((shippingField, i) => {
                    const billingField = billingFields[i];
                    if (!newAccountData[shippingField] && newAccountData[billingField]) {
                        (newAccountData as any)[shippingField] = newAccountData[billingField];
                    }
                });

                const existingAccountIndex = updatedAccounts.findIndex(acc => acc.company.toLowerCase() === companyName.toLowerCase());
                
                if (existingAccountIndex !== -1) {
                    const existing = updatedAccounts[existingAccountIndex];
                    updatedAccounts[existingAccountIndex] = { ...existing, ...newAccountData };
                    updatedAccountsCount++;
                } else {
                    const newAccount: CustomerAccount = {
                        id: `ACC-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
                        company: companyName,
                        phone: '', accountNumber: '',
                        billingAddress: '', billingCity: '', billingState: '', billingZip: '',
                        shippingAddress: '', shippingCity: '', shippingState: '', shippingZip: '',
                        internalNotes: 'Imported via file.',
                        contactName: '', email: '',
                        ...newAccountData,
                        billingCountry: newAccountData.billingCountry || 'United States',
                        shippingCountry: newAccountData.shippingCountry || newAccountData.billingCountry || 'United States',
                    };
                    updatedAccounts.push(newAccount);
                    newAccountsCount++;
                }
            }
            
            if (newAccountsCount === 0 && updatedAccountsCount === 0) {
                alert("No new or updated accounts were found. Please check your column headers. A 'Company' or 'Business Name' column is required.");
                return;
            }

            await onSaveAccounts(updatedAccounts);
            alert(`Import complete! ${newAccountsCount} new accounts added and ${updatedAccountsCount} updated. Directory has been synchronized to the permanent database.`);
            setIsImportModalOpen(false);
        } catch (error) {
            console.error("Import failed:", error);
            alert(`File import failed. ${error instanceof Error ? error.message : 'Please check the file format and column headers.'}`);
        }
    };

    const handleSaveAccount = (updatedAccount: CustomerAccount) => {
        const updatedAccounts = accounts.map(acc => acc.id === updatedAccount.id ? updatedAccount : acc);
        onSaveAccounts(updatedAccounts);
    };

    const handleAddPaymentForAccount = (payment: Omit<Payment, 'id' | 'clientId'>) => {
        if (!selectedAccount) return;
        const newPayment: Payment = {
            id: `PAY-${Date.now()}`,
            clientId: selectedAccount.id,
            ...payment
        };
        onSavePayments([...payments, newPayment]);
    };
    
    const handleAddNewAccount = () => {
        const newAccount: CustomerAccount = {
            id: `ACC-${Date.now()}`,
            company: 'New Enterprise',
            contactName: '', email: '', phone: '', accountNumber: '',
            billingAddress: '', billingCity: '', billingState: '', billingZip: '', billingCountry: 'United States',
            shippingAddress: '', shippingCity: '', shippingState: '', shippingZip: '', shippingCountry: 'United States',
            internalNotes: ''
        };
        onSaveAccounts([...accounts, newAccount]);
        setSelectedAccountId(newAccount.id);
    };

    const handleDelete = () => {
        if (selectedAccountId) {
            onDeleteAccount(selectedAccountId);
            setSelectedAccountId(null);
        }
    };

    return (
      <>
        <div className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-12 gap-8">
            <div className="col-span-3 space-y-6 no-print">
                <h2 className="text-xl font-black uppercase text-cat-black tracking-tighter">Directory</h2>
                <div className="flex flex-col gap-3">
                    <button onClick={handleAddNewAccount} className="w-full py-4 bg-emerald-600 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl btn-app shadow-lg shadow-emerald-600/10">Add New Account</button>
                    <button onClick={() => setIsImportModalOpen(true)} className="w-full py-4 bg-indigo-600 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl btn-app shadow-lg shadow-indigo-600/10">Import Accounts</button>
                    
                    <button 
                        onClick={handleSyncCRM} 
                        disabled={isSyncing}
                        className={`w-full py-4 ${isSyncing ? 'bg-slate-400' : 'bg-cat-yellow'} text-cat-black font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl btn-app shadow-lg shadow-cat-yellow/20 flex items-center justify-center gap-2`}
                    >
                        <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                        {isSyncing ? 'Syncing...' : 'Sync Iron Hub CRM'}
                    </button>
                    
                    {syncMessage && (
                        <div className={`p-3 rounded-xl text-xs font-bold ${syncMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                            {syncMessage.text}
                        </div>
                    )}

                    <div className="relative">
                        <button 
                            onClick={() => setShowExportMenu(!showExportMenu)}
                            className="w-full py-4 bg-white border border-slate-200 text-cat-black font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl btn-app shadow-sm flex items-center justify-center gap-2 hover:border-cat-yellow"
                        >
                            <Download className="w-4 h-4" />
                            Export Contacts
                        </button>
                        
                        {showExportMenu && (
                            <div className="absolute left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-100 p-2 z-50 animate-in fade-in zoom-in-95">
                                <button 
                                    onClick={() => { exportContacts(accounts, 'excel'); setShowExportMenu(false); }}
                                    className="w-full text-left px-4 py-3 text-[10px] font-black uppercase rounded-xl hover:bg-cat-yellow/10 hover:text-cat-black flex items-center gap-3 transition-colors"
                                >
                                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                                    Excel (.xlsx)
                                </button>
                                <button 
                                    onClick={() => { exportContacts(accounts, 'csv'); setShowExportMenu(false); }}
                                    className="w-full text-left px-4 py-3 text-[10px] font-black uppercase rounded-xl hover:bg-cat-yellow/10 hover:text-cat-black flex items-center gap-3 transition-colors"
                                >
                                    <FileText className="w-4 h-4 text-blue-600" />
                                    CSV (.csv)
                                </button>
                                <button 
                                    onClick={() => { exportContacts(accounts, 'csv', 'IronHub_CRM_Export'); setShowExportMenu(false); }}
                                    className="w-full text-left px-4 py-3 text-[10px] font-black uppercase rounded-xl hover:bg-cat-yellow/10 hover:text-cat-black flex items-center gap-3 transition-colors border-t border-slate-100 mt-1 pt-2"
                                >
                                    <RefreshCw className="w-4 h-4 text-cat-yellow" />
                                    Iron Hub CRM (.csv)
                                </button>
                            </div>
                        )}
                    </div>
                </div>
                <div className="card-app p-4 space-y-2 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {accounts.map(acc => (
                        <div key={acc.id} onClick={() => setSelectedAccountId(acc.id)} className={`p-5 rounded-2xl cursor-pointer transition-all border-2 ${selectedAccountId === acc.id ? 'bg-cat-black text-white border-cat-black shadow-xl' : 'bg-white border-slate-100 hover:border-cat-yellow hover:bg-slate-50'}`}>
                            <p className="font-black uppercase text-xs tracking-tight truncate">{acc.company}</p>
                            <p className={`text-[10px] font-bold uppercase tracking-widest mt-1 ${selectedAccountId === acc.id ? 'text-cat-yellow' : 'text-slate-400'}`}>{acc.contactName || 'No Contact'}</p>
                        </div>
                    ))}
                </div>
            </div>

            <div className="col-span-9">
                {!selectedAccount ? (
                    <Dashboard 
                        invoices={invoices} 
                        payments={payments} 
                        accounts={accounts} 
                        onSelectAccount={setSelectedAccountId} 
                    />
                ) : (
                    <CustomerProfile 
                        account={selectedAccount}
                        invoices={accountInvoices}
                        payments={accountPayments}
                        quotes={accountQuotes}
                        onSave={handleSaveAccount}
                        onDelete={handleDelete}
                        onAddPayment={handleAddPaymentForAccount}
                        onNewDocument={(type) => onNewDocument(selectedAccount.id, type)}
                        onShowReceipt={setReceiptToShow}
                    />
                )}
            </div>
        </div>
        {receiptToShow && selectedAccount && (
            <PaymentReceiptModal 
                payment={receiptToShow}
                account={selectedAccount}
                invoice={receiptInvoice}
                onClose={() => setReceiptToShow(null)}
            />
        )}
        {isImportModalOpen && (
            <ImportModal
                onClose={() => setIsImportModalOpen(false)}
                onImport={handleFileImport}
            />
        )}
      </>
    );
};
