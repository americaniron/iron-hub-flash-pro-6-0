
import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { ConfigPanel } from './components/ConfigPanel.tsx';
import { QuotePreview } from './components/QuotePreview.tsx';
import { EmailModule } from './components/EmailModule.tsx';
import { ItemEditor } from './components/ItemEditor.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { Logo } from './components/Logo.tsx';
import { QuoteItem, ClientInfo, AppConfig, CustomerAccount, User, PhotoMode, SavedQuote, SyncStatus, InvoiceData, Payment, ServiceItem, RecurringInvoice, InvoiceTemplate, InventoryPart } from './types.ts';
import { analyzeQuoteData, generateTTS, generatePartImage, translateText } from './services/geminiService.ts';
import { dbService } from './services/dbService.ts';
import { syncToIronSuite, SyncResult } from './services/syncService.ts';
import html2pdf from 'html2pdf.js';

// Production-ready components defined within App.tsx to adhere to file constraints
const LoadingScreen: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex h-screen w-full items-center justify-center bg-cat-black relative overflow-hidden">
    <div className="absolute inset-0 opacity-20 pointer-events-none">
      <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #ffcd00 1px, transparent 0)', backgroundSize: '40px 40px' }}></div>
    </div>
    <div className="relative z-10 text-center">
      <div className="w-20 h-20 border-4 border-white/5 border-t-cat-yellow rounded-full animate-spin mx-auto shadow-2xl shadow-cat-yellow/20"></div>
      <p className="mt-8 text-[11px] font-black uppercase tracking-[0.4em] text-cat-yellow animate-pulse">{message}</p>
    </div>
  </div>
);

const usePersistentUser = (): User | null => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let userId = localStorage.getItem('ai_user_id');
    if (!userId) {
      userId = `user-${crypto.randomUUID()}`;
      localStorage.setItem('ai_user_id', userId);
    }
    setUser({
      username: userId,
      displayName: 'Local User',
      role: 'Engineer'
    });
  }, []);

  return user;
};

const generateDocumentId = (isInvoice: boolean) => {
  const prefix = isInvoice ? 'INV' : 'QT';
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomHex = Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, '0');
  return `${prefix}-${dateStr}-${randomHex}`;
};

const isApiKeyError = (error: any): boolean => {
  const errString = typeof error === 'string' ? error : (error.message || JSON.stringify(error));
  return (
    errString.includes("Requested entity was not found.") || 
    errString.includes("API key expired") || 
    errString.includes("API_KEY_INVALID") ||
    errString.includes("API key invalid") ||
    errString.includes("API key") ||
    errString.includes("RESOURCE_EXHAUSTED") ||
    errString.includes("quota exceeded") ||
    errString.includes("Quota exceeded") ||
    errString.includes("limit: 0") ||
    (errString.includes("INVALID_ARGUMENT") && errString.includes("API key"))
  );
};

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const InvoiceSystem = React.lazy(() => import('./components/InvoiceSystem.tsx').then(module => ({ default: module.InvoiceSystem })));
const AccountsSystem = React.lazy(() => import('./components/AccountsSystem.tsx').then(module => ({ default: module.AccountsSystem })));
const InventorySystem = React.lazy(() => import('./components/InventorySystem.tsx').then(module => ({ default: module.InventorySystem })));
const Dashboard = React.lazy(() => import('./components/Dashboard.tsx').then(module => ({ default: module.Dashboard })));

const App: React.FC = () => {
  const user = usePersistentUser();
  const [activeSystem, setActiveSystem] = useState<'quoting' | 'invoicing' | 'accounts' | 'inventory' | 'dashboard'>('quoting');
  const [initialInvoiceData, setInitialInvoiceData] = useState<InvoiceData | null>(null);
  const [invoiceToSend, setInvoiceToSend] = useState<InvoiceData | null>(null);

  const getDefaultExpiration = () => {
    const d = new Date();
    d.setDate(d.getDate() + 10);
    return d.toISOString().split('T')[0];
  };

  const [items, setItems] = useState<QuoteItem[]>([]);
  const [customerAccounts, setCustomerAccounts] = useState<CustomerAccount[]>([]);
  const [quoteHistory, setQuoteHistory] = useState<SavedQuote[]>([]);
  const [invoices, setInvoices] = useState<InvoiceData[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [inventory, setInventory] = useState<InventoryPart[]>([]);
  const [recurringInvoices, setRecurringInvoices] = useState<RecurringInvoice[]>([]);
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('stable');
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string>('');
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const [client, setClient] = useState<ClientInfo>({ 
    accountNumber: '', company: '', contactName: '', email: '', phone: '',
    billingAddress: '', billingCity: '', billingState: '', billingZip: '', billingCountry: 'United States',
    shippingAddress: '', shippingCity: '', shippingState: '', shippingZip: '', shippingCountry: 'United States'
  });

  const [config, setConfig] = useState<AppConfig>({ 
    markupPercentage: 25, discountPercentage: 0,
    quoteId: generateDocumentId(false), poNumber: '',
    expirationDate: getDefaultExpiration(), logisticsRate: 2.50,
    isInvoice: false, weightUnit: 'LBS', includeAiAnalysis: false,
    photoMode: PhotoMode.NONE,
    imageSize: '1K',
    paymentTerms: 'Net 30',
    ttsLanguage: 'en',
    documentLanguage: 'en',
  });
  
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [audioData, setAudioData] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [customLogo, setCustomLogo] = useState<string | null>('/logo.png');
  const [hasDraft, setHasDraft] = useState(false);
  const [isEmailOpen, setIsEmailOpen] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const resultRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const prevLangRef = useRef(config.documentLanguage);

  useEffect(() => {
    if (config.documentLanguage !== prevLangRef.current) {
      if (aiAnalysis) {
        setIsAnalyzing(true);
        translateText(aiAnalysis, config.documentLanguage)
          .then(translated => {
            setAiAnalysis(translated);
          })
          .catch(err => {
            console.error("Translation failed:", err);
          })
          .finally(() => {
            setIsAnalyzing(false);
          });
      }
      prevLangRef.current = config.documentLanguage;
    }
  }, [config.documentLanguage, aiAnalysis]);

  useEffect(() => {
    if (!user) return;
    const syncCloudData = async () => {
      setSyncStatus('syncing');
      try {
        const [accounts, quotes, invoicesData, paymentsData, recurringData, templatesData, inventoryData] = await Promise.all([
          dbService.getCustomerAccounts(user.username),
          dbService.getQuotes(user.username),
          dbService.getInvoices(user.username),
          dbService.getPayments(user.username),
          dbService.getRecurringInvoices(user.username),
          dbService.getTemplates(user.username),
          dbService.getInventory(user.username)
        ]);
        setCustomerAccounts(accounts);
        setQuoteHistory(quotes);
        setInvoices(invoicesData);
        setPayments(paymentsData);
        setRecurringInvoices(recurringData);
        setInventory(inventoryData);
        
        if (templatesData.length === 0) {
          const defaults: InvoiceTemplate[] = [
            { id: 'classic', name: 'Classic Iron', primaryColor: '#000000', accentColor: '#ffcd00', fontFamily: 'Plus Jakarta Sans', headerStyle: 'classic' as const, showLogo: true },
            { id: 'modern', name: 'Modern Tech', primaryColor: '#1e293b', accentColor: '#38bdf8', fontFamily: 'Inter', headerStyle: 'modern' as const, showLogo: true },
            { id: 'minimal', name: 'Minimalist', primaryColor: '#000000', accentColor: '#000000', fontFamily: 'JetBrains Mono', headerStyle: 'minimal' as const, showLogo: false },
          ];
          setTemplates(defaults);
          await dbService.saveTemplates(user.username, defaults);
        } else {
          setTemplates(templatesData);
        }
        
        setSyncStatus('stable');
      } catch (e) {
        console.error("Cloud Sync Error:", e);
        setSyncStatus('error');
      }
    };
    syncCloudData();
  }, [user]);

  const handleApiError = (error: any) => {
    if (isApiKeyError(error)) {
        console.error("A critical API key error occurred:", error);
        alert("Your API Key appears to be invalid or lacks necessary permissions (e.g., billing not enabled). Please select a valid key. The application will now reload to re-verify your key.");
        window.location.reload();
        return true;
    }
    return false;
  }

  const generateSKU = (partNo: string) => {
    let hash = 0;
    for (let i = 0; i < partNo.length; i++) {
      const char = partNo.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `AMI-${Math.abs(hash).toString(36).toUpperCase().padStart(6, '0')}`;
  };

  const handleDataLoaded = async (newItems: QuoteItem[]) => {
    const cleanItems = newItems.map(item => ({ ...item, aiImageUrl: undefined }));
    setItems(cleanItems);
    setAiAnalysis(null);
    setAudioData(null); // Clear previous audio
    setConfig(prev => {
      const hasExtracted = newItems.some(item => item.originalImages && item.originalImages.length > 0);
      return { 
        ...prev, 
        quoteId: generateDocumentId(prev.isInvoice),
        // Automatically switch to EXTRACT mode if images were found in the PDF
        photoMode: hasExtracted ? PhotoMode.EXTRACT : prev.photoMode
      };
    });
    
    setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    if (user) {
      const inventoryParts = cleanItems.map(item => {
        const extractedImage = item.originalImages && item.originalImages.length > 0 ? item.originalImages[0] : undefined;
        return {
          id: generateSKU(item.partNo),
          partNo: item.partNo,
          description: item.desc,
          originalPrice: item.unitPrice,
          imageUrl: extractedImage,
          originalImages: item.originalImages || []
        };
      });
      await dbService.addOrUpdateInventoryParts(user.username, inventoryParts);

      // Also save to image pool if images exist
      const imagesToPool = cleanItems
        .filter(item => item.originalImages && item.originalImages.length > 0)
        .map(item => ({
          partNo: item.partNo,
          description: item.desc,
          imageUrl: item.originalImages![0]
        }));
      
      if (imagesToPool.length > 0) {
        await dbService.addImagesToPool(user.username, imagesToPool);
      }
    }
  };

  const handleAnalyze = async (thinking: boolean = false) => {
    if (items.length === 0 || !user) return;
    setIsAnalyzing(true);
    setAudioData(null); // Clear previous audio on new analysis
    try {
        const result = await analyzeQuoteData(items, thinking, config.documentLanguage);
        setAiAnalysis(result);
        await dbService.deductCredits(user.username, thinking ? 10 : 5);
    } catch (err) {
        if (!handleApiError(err)) {
          setAiAnalysis("Analysis failed due to an unexpected error.");
        }
    } finally {
        setIsAnalyzing(false);
    }
  };

  const handleGenerateAllImages = async () => {
    if (items.length === 0 || config.photoMode !== PhotoMode.AI || !user) return;
    setIsGeneratingImages(true);
  
    const generationPromises = items.map(async (item, index) => {
      if (item.aiImageUrl) return;
  
      // Check pool first
      const pooledImage = await dbService.findImageInPool(user.username, item.partNo, item.desc);
      if (pooledImage) {
        setItems(currentItems => {
          const newItems = [...currentItems];
          if(newItems[index]) newItems[index] = { ...newItems[index], aiImageUrl: pooledImage };
          return newItems;
        });
        return;
      }

      // Generate if not in pool
      try {
        const imageUrl = await generatePartImage(item.partNo, item.desc, config.imageSize);
        if (imageUrl) {
          setItems(currentItems => {
            const newItems = [...currentItems];
            if(newItems[index]) newItems[index] = { ...newItems[index], aiImageUrl: imageUrl };
            return newItems;
          });
          // Save to pool
          await dbService.addImageToPool(user.username, item.partNo, item.desc, imageUrl);
          
          // Update inventory with image
          const inventoryPart = {
            id: generateSKU(item.partNo),
            partNo: item.partNo,
            description: item.desc,
            originalPrice: item.unitPrice,
            imageUrl: imageUrl,
            originalImages: item.originalImages || []
          };
          await dbService.addOrUpdateInventoryParts(user.username, [inventoryPart]);
        }
      } catch (error) {
        console.error(`Failed to generate image for ${item.partNo}:`, error);
        handleApiError(error);
      }
    });
  
    await Promise.all(generationPromises);
    setIsGeneratingImages(false);
  };

  const handleDownloadImagePool = async () => {
    if (!user) return;
    try {
      const pool = await dbService.getPartsImagePool(user.username);
      const blob = new Blob([JSON.stringify(pool, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `parts-image-pool-${user.username}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      alert("Failed to export image pool.");
    }
  };

  const handleSpeakAnalysis = async () => {
    if (!aiAnalysis || isSpeaking) return;
    setIsSpeaking(true);
    try {
      const base64Audio = await generateTTS(aiAnalysis, config.ttsLanguage);
      if (base64Audio) {
        setAudioData(base64Audio); // Save audio data for download
        const ctx = audioContextRef.current || new (window.AudioContext || window.webkitAudioContext)({sampleRate: 24000});
        audioContextRef.current = ctx;
        const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => setIsSpeaking(false);
        source.start();
      } else {
        setIsSpeaking(false);
      }
    } catch (e) {
      if (!handleApiError(e)) {
        console.error("TTS Error:", e);
      }
      setIsSpeaking(false);
    }
  };
  
  const createWavBlob = (base64Audio: string): Blob => {
    const writeString = (view: DataView, offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };
    
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    
    const pcmData = decode(base64Audio);
    const dataSize = pcmData.length;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    const pcmAsUint8 = new Uint8Array(pcmData.buffer);
    for (let i = 0; i < dataSize; i++) {
        view.setUint8(44 + i, pcmAsUint8[i]);
    }

    return new Blob([view], { type: 'audio/wav' });
  };

  const handleDownloadAudio = () => {
    if (!audioData) return;
    const blob = createWavBlob(audioData);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `AI-Analysis-${config.quoteId}.wav`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const getAudioAttachment = async (): Promise<string | null> => {
    if (!audioData) return null;
    const blob = createWavBlob(audioData);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result as string);
      };
      reader.readAsDataURL(blob);
    });
  };

  const handleSaveToBook = useCallback(async (clientData: ClientInfo) => {
    if (!user || !clientData.company) return;
    let existingAccount = clientData.id ? customerAccounts.find(acc => acc.id === clientData.id) : customerAccounts.find(acc => acc.company.toLowerCase() === clientData.company.toLowerCase());
    let updatedAccounts;
    if (existingAccount) {
      updatedAccounts = customerAccounts.map(acc => acc.id === existingAccount!.id ? { ...existingAccount, ...clientData } : acc);
    } else {
      const newAccount: CustomerAccount = { ...clientData, id: `ACC-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}` };
      updatedAccounts = [...customerAccounts, newAccount];
    }
    setCustomerAccounts(updatedAccounts);
    await dbService.saveCustomerAccounts(user.username, updatedAccounts);
  }, [user, customerAccounts]);


  const handleDeleteFromBook = async (id: string) => {
    if (!user) return;
    const updatedBook = customerAccounts.filter(c => c.id !== id);
    setCustomerAccounts(updatedBook);
    await dbService.saveCustomerAccounts(user.username, updatedBook);
  };
  
  const handleLogout = () => {
    localStorage.removeItem('ai_user_id');
    window.location.reload();
  };

  const handleSaveInvoices = async (newInvoices: InvoiceData[]) => {
    if (!user) return;
    setSyncStatus('syncing');
    try {
      setInvoices(newInvoices);
      await dbService.saveInvoices(user.username, newInvoices);
      setSyncStatus('stable');
    } catch (error) {
      setSyncStatus('error');
    }
  };

  const handleSaveRecurring = async (recurring: RecurringInvoice[]) => {
    if (!user) return;
    setRecurringInvoices(recurring);
    await dbService.saveRecurringInvoices(user.username, recurring);
  };

  const handleSaveTemplates = async (newTemplates: InvoiceTemplate[]) => {
    if (!user) return;
    setTemplates(newTemplates);
    await dbService.saveTemplates(user.username, newTemplates);
  };

  useEffect(() => {
    if (!user || recurringInvoices.length === 0) return;
    
    const checkRecurring = async () => {
      const now = new Date();
      let changed = false;
      const updatedRecurring = [...recurringInvoices];
      const newInvoices = [...invoices];

      for (let i = 0; i < updatedRecurring.length; i++) {
        const rec = updatedRecurring[i];
        if (rec.isActive && new Date(rec.nextGeneration) <= now) {
          const generatedInvoice: InvoiceData = {
            id: `INV-REC-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
            date: now.toISOString().split('T')[0],
            dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            clientId: rec.clientId,
            items: rec.items,
            taxRate: rec.taxRate,
            discount: rec.discount,
            notes: `RECURRING INVOICE: ${rec.notes}`,
            status: 'unpaid',
            total: rec.items.reduce((sum, item) => sum + (item.hours * item.rate), 0),
            templateId: rec.templateId
          };
          
          newInvoices.push(generatedInvoice);
          
          // Calculate next generation date
          const nextDate = new Date(rec.nextGeneration);
          if (rec.frequency === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);
          else if (rec.frequency === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
          else if (rec.frequency === 'quarterly') nextDate.setMonth(nextDate.getMonth() + 3);
          else if (rec.frequency === 'yearly') nextDate.setFullYear(nextDate.getFullYear() + 1);
          
          updatedRecurring[i] = {
            ...rec,
            lastGenerated: now.toISOString().split('T')[0],
            nextGeneration: nextDate.toISOString().split('T')[0]
          };
          changed = true;
        }
      }

      if (changed) {
        setInvoices(newInvoices);
        setRecurringInvoices(updatedRecurring);
        await Promise.all([
          dbService.saveInvoices(user.username, newInvoices),
          dbService.saveRecurringInvoices(user.username, updatedRecurring)
        ]);
        console.log("Generated recurring invoices.");
      }
    };

    const interval = setInterval(checkRecurring, 60000); // Check every minute
    checkRecurring(); // Check immediately
    return () => clearInterval(interval);
  }, [user, recurringInvoices, invoices]);
  
  const handleSaveAccounts = async (updatedAccounts: CustomerAccount[]) => {
    if (!user) return;
    setCustomerAccounts(updatedAccounts);
    await dbService.saveCustomerAccounts(user.username, updatedAccounts);
  };
  
  const handleDeleteAccount = async (accountId: string) => {
    if (!user) return;
    const accountToDelete = customerAccounts.find(acc => acc.id === accountId);
    if (!accountToDelete || !window.confirm(`Are you sure you want to permanently delete ${accountToDelete.company}? This action cannot be undone.`)) return;
    
    setSyncStatus('syncing');
    const updatedAccounts = customerAccounts.filter(acc => acc.id !== accountId);
    const updatedInvoices = invoices.filter(inv => inv.clientId !== accountId);
    const updatedPayments = payments.filter(pay => pay.clientId !== accountId);
    const updatedQuotes = quoteHistory.filter(q => q.payload.client.accountNumber !== accountToDelete.accountNumber);
    setCustomerAccounts(updatedAccounts);
    setInvoices(updatedInvoices);
    setPayments(updatedPayments);
    setQuoteHistory(updatedQuotes);
    await Promise.all([
      dbService.saveCustomerAccounts(user.username, updatedAccounts),
      dbService.saveInvoices(user.username, updatedInvoices),
      dbService.savePayments(user.username, updatedPayments),
      dbService.saveAllQuotes(user.username, updatedQuotes)
    ]);
    setSyncStatus('stable');
    alert(`${accountToDelete.company} has been permanently deleted.`);
  };


  const handlePaymentsUpdate = async (newPayments: Payment[]) => {
    if (!user) return;
    setPayments(newPayments);
    await dbService.savePayments(user.username, newPayments);
    const invoiceIdsToUpdate = new Set(newPayments.map(p => p.invoiceId));
    let invoicesToUpdate = [...invoices];
    let changed = false;
    for (const invoiceId of invoiceIdsToUpdate) {
        if (invoiceId === 'general') continue;
        const invoice = invoicesToUpdate.find(inv => inv.id === invoiceId);
        if (invoice && invoice.status !== 'paid') {
            const totalPaid = newPayments.filter(p => p.invoiceId === invoiceId).reduce((sum, p) => sum + p.amount, 0);
            if (totalPaid >= invoice.total) {
                invoicesToUpdate = invoicesToUpdate.map(inv => inv.id === invoiceId ? { ...inv, status: 'paid' } : inv);
                changed = true;
            }
        }
    }
    if (changed) handleSaveInvoices(invoicesToUpdate);
  };
  
  const handleConvertToInvoice = () => {
    if (items.length === 0 || !client.company) {
        alert("Cannot create an invoice from an empty quote or without a client.");
        return;
    }
    handleSaveToBook(client);
    const clientAccount = customerAccounts.find(c => c.company === client.company);
    const serviceItems: ServiceItem[] = items.map((q, idx) => {
      const markedUpPrice = q.unitPrice * (1 + (config.markupPercentage / 100));
      const roundedRate = Math.round(markedUpPrice * 100) / 100;
      return {
        id: `QT-${q.partNo}-${idx}`, description: `${q.partNo} - ${q.desc}`,
        hours: q.qty, rate: roundedRate, taxable: true, imageUrl: q.aiImageUrl,
      };
    });
    const totalWeight = items.reduce((sum, i) => sum + (i.qty * i.weight), 0);
    const logistics = Math.round((totalWeight * config.logisticsRate) * 100) / 100;
    if (logistics > 0) {
        serviceItems.push({
            id: `LOGISTICS-${Date.now()}`,
            description: `Logistics & Freight (${totalWeight.toLocaleString()} ${config.weightUnit} @ $${config.logisticsRate.toFixed(2)}/${config.weightUnit})`,
            hours: 1, rate: logistics, taxable: false,
        });
    }
    const newInvoice: InvoiceData = {
        id: generateDocumentId(true),
        date: new Date().toISOString().split('T')[0],
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        clientId: clientAccount?.id || '', items: serviceItems, taxRate: 7,
        discount: config.creditOrRefund || 0, notes: config.specialInstructions || '',
        status: 'draft', total: 0
    };
    setInitialInvoiceData(newInvoice);
    setActiveSystem('invoicing');
  };

  const handleNewDocumentForCustomer = (customerId: string, type: 'quote' | 'invoice') => {
    const account = customerAccounts.find(acc => acc.id === customerId);
    if (!account) return;
    setClient(account);
    setItems([]);
    setAiAnalysis(null);
    if (type === 'quote') {
        setConfig(prev => ({...prev, quoteId: generateDocumentId(false), isInvoice: false}));
        setActiveSystem('quoting');
    } else {
        const newInvoice: InvoiceData = {
            id: generateDocumentId(true), date: new Date().toISOString().split('T')[0],
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            clientId: account.id, items: [], taxRate: 7, discount: 0, notes: '', status: 'draft', total: 0
        };
        setInitialInvoiceData(newInvoice);
        setActiveSystem('invoicing');
    }
  };

  const handleCommitToCloud = async () => {
    if (!user || items.length === 0) return;
    setSyncStatus('syncing');
    try {
      const total = items.reduce((sum, i) => sum + (i.qty * i.unitPrice), 0);
      const newSavedQuote = await dbService.saveQuote(user.username, {
        title: `${client.company || 'Entity'} - ${config.quoteId}`,
        total, payload: { items, client, config, aiAnalysis }
      });
      setQuoteHistory(prev => [newSavedQuote, ...prev]);
      setSyncStatus('stable');
      alert("Saved to Archive.");
    } catch (e) {
      setSyncStatus('error');
    }
  };

  const handleLoadFromArchive = (archive: SavedQuote) => {
    const { items: archivedItems, client: archivedClient, config: archivedConfig } = archive.payload;
    const migratedClient: ClientInfo = {
      accountNumber: archivedClient.accountNumber, company: archivedClient.company, contactName: archivedClient.contactName,
      email: archivedClient.email, phone: archivedClient.phone,
      billingAddress: (archivedClient as any).billingAddress || (archivedClient as any).address || '',
      billingCity: (archivedClient as any).billingCity || (archivedClient as any).city || '',
      billingState: (archivedClient as any).billingState || (archivedClient as any).state || '',
      billingZip: (archivedClient as any).billingZip || (archivedClient as any).zip || '',
      billingCountry: (archivedClient as any).billingCountry || (archivedClient as any).country || 'United States',
      shippingAddress: (archivedClient as any).shippingAddress || (archivedConfig as any).shippingAddress || '',
      shippingCity: (archivedClient as any).shippingCity || (archivedConfig as any).shippingCity || '',
      shippingState: (archivedClient as any).shippingState || (archivedConfig as any).shippingState || '',
      shippingZip: (archivedClient as any).shippingZip || (archivedConfig as any).shippingZip || '',
      shippingCountry: (archivedClient as any).shippingCountry || (archivedConfig as any).shippingCountry || 'United States',
    };
    setItems(archivedItems.map(item => ({...item, aiImageUrl: undefined})));
    setClient(migratedClient);
    setConfig(archive.payload.config);
    setAiAnalysis(archive.payload.aiAnalysis);
    setAudioData(null);
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const handleSaveQuote = () => {
    if (items.length === 0) return;
    const data = { version: '2.5', timestamp: new Date().toISOString(), items, client, config, customLogo, aiAnalysis };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${config.quoteId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  
  const handleLoadLocalQuote = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            if (typeof event.target?.result !== 'string') throw new Error("File could not be read.");
            const data = JSON.parse(event.target.result);
            if (!data.items || !data.client || !data.config) throw new Error("Invalid quote file format.");
            const { items: archivedItems, client: archivedClient, config: archivedConfig, aiAnalysis, customLogo } = data;
            const migratedClient: ClientInfo = {
              accountNumber: archivedClient.accountNumber, company: archivedClient.company, contactName: archivedClient.contactName,
              email: archivedClient.email, phone: archivedClient.phone,
              billingAddress: (archivedClient as any).billingAddress || (archivedClient as any).address || '',
              billingCity: (archivedClient as any).billingCity || (archivedClient as any).city || '',
              billingState: (archivedClient as any).billingState || (archivedClient as any).state || '',
              billingZip: (archivedClient as any).billingZip || (archivedClient as any).zip || '',
              billingCountry: (archivedClient as any).billingCountry || (archivedClient as any).country || 'United States',
              shippingAddress: (archivedClient as any).shippingAddress || (archivedConfig as any).shippingAddress || '',
              shippingCity: (archivedClient as any).shippingCity || (archivedConfig as any).shippingCity || '',
              shippingState: (archivedClient as any).shippingState || (archivedConfig as any).shippingState || '',
              shippingZip: (archivedClient as any).shippingZip || (archivedConfig as any).shippingZip || '',
              shippingCountry: (archivedClient as any).shippingCountry || (archivedConfig as any).shippingCountry || 'United States',
            };
            setItems(archivedItems.map((item: QuoteItem) => ({...item, aiImageUrl: undefined})));
            setClient(migratedClient);
            setConfig(archivedConfig);
            setAiAnalysis(aiAnalysis || null);
            setCustomLogo(customLogo || '/logo.png');
            setAudioData(null);
            alert("Local quote file loaded successfully.");
            setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        } catch (error) {
            alert(`Failed to load file. ${error instanceof Error ? error.message : 'Please ensure it is a valid quote JSON file.'}`);
        }
    };
    reader.readAsText(file);
  };

  const handleSendInvoice = (invoice: InvoiceData) => {
    setInvoiceToSend(invoice);
    setIsEmailOpen(true);
  };

  const handlePrint = useCallback(() => {
    if (activeSystem === 'quoting' && items.length === 0) return;
    window.print();
  }, [items.length, activeSystem]);

  const handleExportData = async () => {
    if (!user) return;
    try {
        const data = await dbService.exportAllUserData(user.username);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `iron-hub-backup-${user.username}-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        alert("Data export failed.");
    }
  };

  const handleSyncToIronSuite = async () => {
    if (!user) return;
    setIsSyncing(true);
    setSyncProgress('Collecting data from Iron Hub...');
    setSyncResult(null);
    try {
      const data = await dbService.exportAllUserData(user.username);
      setSyncProgress('Connecting to IronSuite...');
      const result = await syncToIronSuite(data, (msg) => setSyncProgress(msg));
      setSyncResult(result);
      setSyncProgress('Sync complete!');
    } catch (err: any) {
      setSyncProgress(`Sync failed: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleImportData = (file: File) => {
    if (!user || !window.confirm("This will overwrite all current data. This action cannot be undone. Are you sure?")) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            if (typeof event.target?.result !== 'string') throw new Error("File read error.");
            const importedData = JSON.parse(event.target.result);
            if (typeof importedData !== 'object' || importedData === null || !importedData.accounts) throw new Error("Invalid backup file.");
            
            setSyncStatus('syncing');
            await dbService.importAllUserData(user.username, importedData);
            
            // Update local state immediately so the user sees the changes without needing a full reload
            if (importedData.accounts) setCustomerAccounts(importedData.accounts);
            if (importedData.quotes) setQuoteHistory(importedData.quotes);
            if (importedData.invoices) setInvoices(importedData.invoices);
            if (importedData.payments) setPayments(importedData.payments);
            if (importedData.recurring_invoices) setRecurringInvoices(importedData.recurring_invoices);
            if (importedData.templates) setTemplates(importedData.templates);
            
            setSyncStatus('stable');
            alert("Import successful!");
            
            // We still reload to ensure all subsystems (like inventory) catch the new data
            // but the state update above makes it feel more responsive.
            window.location.reload();
        } catch (error) {
            setSyncStatus('error');
            alert(`Data import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };
    reader.readAsText(file);
  };

  if (!user) {
    return <LoadingScreen message="Initializing Session..." />;
  }

  const generatePdf = async () => {
    const element = document.querySelector('.printable-area') as HTMLElement;
    if (!element) return null;
    
    // Temporarily add a class to force print styles for PDF generation
    element.classList.add('pdf-generation-mode');
    document.body.classList.add('pdf-generation-mode-active');
    
    const opt = {
      margin:       0.5,
      filename:     `${config.quoteId || 'Document'}.pdf`,
      image:        { type: 'jpeg' as const, quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, windowWidth: 1100, width: 1100, scrollX: 0, scrollY: 0 },
      jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' as const },
      pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };
    
    try {
      const pdfBase64 = await html2pdf().from(element).set(opt).outputPdf('datauristring');
      return pdfBase64;
    } catch (err) {
      console.error("PDF Generation Error:", err);
      return null;
    } finally {
      element.classList.remove('pdf-generation-mode');
      document.body.classList.remove('pdf-generation-mode-active');
    }
  };

  const renderActiveSystem = () => {
    switch (activeSystem) {
      case 'quoting':
        return (
          <>
            <ConfigPanel 
              itemsCount={items.length} onDataLoaded={handleDataLoaded}
              onConfigChange={setConfig} onClientChange={setClient}
              onAnalyze={handleAnalyze} onSaveQuote={handleSaveQuote}
              onLoadQuote={handleLoadLocalQuote} onSaveDraft={() => {}}
              onResumeDraft={() => {}} onCommitToCloud={handleCommitToCloud}
              onPrint={() => window.print()} onEmailDispatch={() => setIsEmailOpen(true)}
              onConvertToInvoice={handleConvertToInvoice} onGenerateAllImages={handleGenerateAllImages}
              onExportData={handleExportData} onImportData={handleImportData}
              onDownloadImagePool={handleDownloadImagePool}
              hasDraft={hasDraft} isAnalyzing={isAnalyzing}
              isGeneratingImages={isGeneratingImages} config={config}
              client={client} customLogo={customLogo} onLogoUpload={setCustomLogo}
              onRefreshId={() => setConfig(prev => ({ ...prev, quoteId: generateDocumentId(prev.isInvoice) }))}
              addressBook={customerAccounts} onSaveToBook={handleSaveToBook}
              onDeleteFromBook={handleDeleteFromBook} quoteHistory={quoteHistory}
              onLoadFromArchive={handleLoadFromArchive} onDeleteFromArchive={() => {}}
              currentUser={user} onLogout={handleLogout} syncStatus={syncStatus}
            />
            <div className="no-print">{items.length > 0 && <ItemEditor items={items} onUpdate={setItems} config={config} onDeleteItem={(idx) => setItems(prev => prev.filter((_, i) => i !== idx))} currentUser={user} />}</div>
            <div ref={resultRef} className="quote-preview-container printable-area">
              <QuotePreview items={items} client={client} config={config} aiAnalysis={aiAnalysis} customLogo={customLogo} isGeneratingImages={isGeneratingImages} audioData={audioData} onConfigChange={setConfig} />
              {aiAnalysis && (
                <div className="max-w-[1000px] mx-auto mt-4 px-12 no-print flex justify-end items-center gap-2">
                  <div className="flex gap-1 p-1 bg-slate-100 rounded-full">
                    <button 
                        onClick={() => setConfig(prev => ({ ...prev, ttsLanguage: 'en' }))}
                        className={`px-4 py-2 text-[10px] font-black uppercase rounded-full transition-all ${config.ttsLanguage === 'en' ? 'bg-white text-cat-black shadow-sm' : 'text-slate-400'}`}
                    >
                        EN
                    </button>
                    <button 
                        onClick={() => setConfig(prev => ({ ...prev, ttsLanguage: 'ar' }))}
                        className={`px-4 py-2 text-[10px] font-black uppercase rounded-full transition-all ${config.ttsLanguage === 'ar' ? 'bg-white text-cat-black shadow-sm' : 'text-slate-400'}`}
                    >
                        AR
                    </button>
                  </div>
                  <button 
                    onClick={handleDownloadAudio} 
                    disabled={!audioData} 
                    className="flex items-center justify-center w-10 h-10 bg-slate-200 text-cat-black rounded-full hover:bg-slate-300 transition-all shadow-sm active:scale-95 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                    title="Download Audio Brief"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V3"></path></svg>
                  </button>
                  <button onClick={handleSpeakAnalysis} disabled={isSpeaking} className="flex items-center gap-3 px-6 py-3 bg-cat-black text-cat-yellow rounded-full font-black text-[10px] uppercase tracking-widest hover:bg-cat-gray transition-all shadow-xl active:scale-95 disabled:bg-slate-400">
                    {isSpeaking ? <div className="flex gap-1 items-end h-3"><div className="w-1 bg-cat-yellow animate-[loading_1s_infinite]"></div><div className="w-1 bg-cat-yellow animate-[loading_1.2s_infinite]"></div><div className="w-1 bg-cat-yellow animate-[loading_0.8s_infinite]"></div></div> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path></svg>}
                    {isSpeaking ? "Broadcasting..." : "AI Voice Brief"}
                  </button>
                </div>
              )}
            </div>
          </>
        );
      case 'invoicing': return <InvoiceSystem initialInvoice={initialInvoiceData} onClearInitialInvoice={() => setInitialInvoiceData(null)} currentUser={user} syncStatus={syncStatus} onLogout={handleLogout} customerAccounts={customerAccounts} allInvoices={invoices} onSaveInvoices={handleSaveInvoices} customLogo={customLogo} onSendInvoice={handleSendInvoice} templates={templates} onSaveTemplates={handleSaveTemplates} recurringInvoices={recurringInvoices} onSaveRecurring={handleSaveRecurring} />;
      case 'accounts': return <AccountsSystem currentUser={user} accounts={customerAccounts} invoices={invoices} payments={payments} quoteHistory={quoteHistory} onSavePayments={handlePaymentsUpdate} onSaveAccounts={handleSaveAccounts} onDeleteAccount={handleDeleteAccount} onNewDocument={handleNewDocumentForCustomer}/>;
      case 'inventory': return <InventorySystem currentUser={user} />;
      case 'dashboard': return <Dashboard invoices={invoices} quotes={quoteHistory} accounts={customerAccounts} payments={payments} inventory={inventory} onNavigateToQuoting={() => setActiveSystem('quoting')} onDataLoaded={(newItems) => { handleDataLoaded(newItems); setActiveSystem('quoting'); }} />;
    }
  };

  return (
    <ErrorBoundary>
        <div className="fixed top-0 left-0 right-0 z-[200] no-print px-6 py-5">
          <div className="max-w-[1400px] mx-auto bg-white/90 backdrop-blur-xl border border-white/60 rounded-[2rem] flex justify-between items-center px-6 py-3 shadow-[0_15px_40px_rgba(0,0,0,0.06)] relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-cat-yellow/50 to-transparent"></div>
            
            <div className="flex items-center gap-10">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-cat-black rounded-2xl flex items-center justify-center shadow-lg shadow-cat-black/10">
                  <Logo className="w-7 h-7 text-cat-yellow" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[13px] font-black uppercase tracking-[0.2em] text-cat-black leading-none">Iron Hub</span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400 mt-1.5">Enterprise</span>
                </div>
              </div>
              
              <div className="h-10 w-[1px] bg-slate-200/80"></div>
              
              <div className="flex gap-1.5 bg-slate-50/80 p-1.5 rounded-2xl border border-slate-200/60 shadow-inner">
                <button 
                  onClick={() => setActiveSystem('quoting')} 
                  className={`text-[11px] font-black uppercase tracking-[0.15em] px-6 py-3 rounded-xl transition-all duration-300 relative overflow-hidden ${activeSystem === 'quoting' ? 'bg-white text-cat-black shadow-md border border-slate-200/80' : 'text-slate-500 hover:text-cat-black hover:bg-white/60'}`}
                >
                  Parts Quoting
                </button>
                <button 
                  onClick={() => setActiveSystem('invoicing')} 
                  className={`text-[11px] font-black uppercase tracking-[0.15em] px-6 py-3 rounded-xl transition-all duration-300 relative overflow-hidden ${activeSystem === 'invoicing' ? 'bg-white text-cat-black shadow-md border border-slate-200/80' : 'text-slate-500 hover:text-cat-black hover:bg-white/60'}`}
                >
                  Service Invoicing
                </button>
                <button 
                  onClick={() => setActiveSystem('accounts')} 
                  className={`text-[11px] font-black uppercase tracking-[0.15em] px-6 py-3 rounded-xl transition-all duration-300 relative overflow-hidden ${activeSystem === 'accounts' ? 'bg-white text-cat-black shadow-md border border-slate-200/80' : 'text-slate-500 hover:text-cat-black hover:bg-white/60'}`}
                >
                  Accounts
                </button>
                <button 
                  onClick={() => setActiveSystem('inventory')} 
                  className={`text-[11px] font-black uppercase tracking-[0.15em] px-6 py-3 rounded-xl transition-all duration-300 relative overflow-hidden ${activeSystem === 'inventory' ? 'bg-white text-cat-black shadow-md border border-slate-200/80' : 'text-slate-500 hover:text-cat-black hover:bg-white/60'}`}
                >
                  Inventory
                </button>
                <button 
                  onClick={() => setActiveSystem('dashboard')} 
                  className={`text-[11px] font-black uppercase tracking-[0.15em] px-6 py-3 rounded-xl transition-all duration-300 relative overflow-hidden ${activeSystem === 'dashboard' ? 'bg-white text-cat-black shadow-md border border-slate-200/80' : 'text-slate-500 hover:text-cat-black hover:bg-white/60'}`}
                >
                  Intelligence
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowSyncModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-[0.15em] rounded-xl transition-all shadow-md shadow-emerald-600/20 hover:shadow-lg hover:shadow-emerald-600/30 hover:scale-[1.02] active:scale-95"
                title="Sync data to IronSuite"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                Sync to IronSuite
              </button>
            </div>

            <div className="flex items-center gap-5 bg-slate-50/80 border border-slate-200/80 rounded-2xl p-2 pr-5 transition-all duration-300 hover:bg-white hover:border-slate-300 hover:shadow-md shadow-sm cursor-pointer">
              <div className="w-10 h-10 rounded-xl bg-cat-black flex items-center justify-center shadow-inner">
                <span className="text-cat-yellow font-black text-[13px]">{user.displayName.charAt(0)}</span>
              </div>
              <div className="text-left flex-1 min-w-[110px]">
                <p className="text-[11px] font-black text-cat-black uppercase tracking-[0.2em] leading-tight">{user.displayName}</p>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.2em] leading-tight mt-1">{user.role}</p>
              </div>
              <div className="w-[1px] h-6 bg-slate-200 mx-1"></div>
              <button 
                onClick={handleLogout}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                title="Secure Logout"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
              </button>
            </div>
          </div>
        </div>
        <div className="pt-28 min-h-screen pb-20 print:min-h-0 print:pb-0 print:pt-0 print:bg-white fade-in">
          <Suspense fallback={<LoadingScreen message={`Loading ${activeSystem} module...`} />}>
            {renderActiveSystem()}
          </Suspense>
          <EmailModule 
            isOpen={isEmailOpen} 
            onClose={() => {
              setIsEmailOpen(false);
              setInvoiceToSend(null); // Clear the invoice to send
            }}
            client={invoiceToSend ? customerAccounts.find(c => c.id === invoiceToSend.clientId) || client : client} 
            invoice={invoiceToSend}
            config={config} 
            items={items} 
            generatePdf={generatePdf}
            audioData={audioData}
            getAudioAttachment={getAudioAttachment}
          />
        </div>

        {/* IronSuite Sync Modal */}
        {showSyncModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center animate-in fade-in duration-200">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg mx-4 overflow-hidden border border-slate-200/60">
              {/* Header */}
              <div className="bg-cat-black px-8 py-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl -mr-20 -mt-20"></div>
                <div className="relative z-10 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-black uppercase tracking-tight text-white">Sync to IronSuite</h2>
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-1">Push all data to your IronSuite platform</p>
                  </div>
                  <button
                    onClick={() => { setShowSyncModal(false); setSyncResult(null); setSyncProgress(''); }}
                    className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="p-8 space-y-6">
                {/* Data Summary */}
                <div className="space-y-3">
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Data to Sync</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Accounts', count: customerAccounts.length, icon: '👥' },
                      { label: 'Quotes', count: quoteHistory.length, icon: '📋' },
                      { label: 'Invoices', count: invoices.length, icon: '📄' },
                      { label: 'Payments', count: payments.length, icon: '💰' },
                      { label: 'Inventory', count: inventory.length, icon: '📦' },
                      { label: 'Templates', count: templates.length, icon: '📝' },
                    ].map(item => (
                      <div key={item.label} className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                        <div className="text-lg">{item.icon}</div>
                        <div className="text-[18px] font-black text-cat-black">{item.count}</div>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{item.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Destination */}
                <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200/50 flex items-center gap-4">
                  <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>
                  </div>
                  <div>
                    <p className="text-[11px] font-black text-emerald-900 uppercase tracking-wider">Target: IronSuite Platform</p>
                    <p className="text-[10px] font-bold text-emerald-700">iron-hub-suite.replit.app</p>
                  </div>
                </div>

                {/* Progress */}
                {syncProgress && (
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/50">
                    <div className="flex items-center gap-3">
                      {isSyncing && <div className="w-4 h-4 border-2 border-emerald-600/30 border-t-emerald-600 rounded-full animate-spin flex-shrink-0"></div>}
                      {!isSyncing && syncResult && <svg className="w-5 h-5 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>}
                      <p className="text-[11px] font-bold text-slate-600">{syncProgress}</p>
                    </div>
                  </div>
                )}

                {/* Results */}
                {syncResult && (
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <div className="flex-1 bg-emerald-50 rounded-xl p-3 text-center border border-emerald-200/50">
                        <div className="text-[22px] font-black text-emerald-700">{syncResult.totalSynced}</div>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-600">Synced</div>
                      </div>
                      <div className="flex-1 bg-red-50 rounded-xl p-3 text-center border border-red-200/50">
                        <div className="text-[22px] font-black text-red-700">{syncResult.totalFailed}</div>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-red-600">Failed</div>
                      </div>
                    </div>
                    {Object.entries(syncResult.results).map(([key, val]: [string, any]) => (
                      <div key={key} className="flex justify-between items-center text-[10px] px-2">
                        <span className="font-bold uppercase tracking-wider text-slate-500">{key}</span>
                        <span className="font-black text-cat-black">{val.success} ok / {val.failed} failed</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Important note */}
                <div className="bg-amber-50 rounded-xl p-4 border border-amber-200/50">
                  <p className="text-[10px] font-bold text-amber-800 leading-relaxed">
                    <span className="font-black">Note:</span> You must be logged into IronSuite in this browser for the sync to work.
                    If sync fails with auth errors, <a href="https://iron-hub-suite.replit.app/api/login" target="_blank" rel="noopener" className="underline font-black hover:text-amber-900">log in to IronSuite first</a>, then try again.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-8 py-5 bg-slate-50 border-t border-slate-200/60 flex justify-between">
                <button
                  onClick={() => { setShowSyncModal(false); setSyncResult(null); setSyncProgress(''); }}
                  className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={handleSyncToIronSuite}
                  disabled={isSyncing}
                  className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-emerald-600/20 disabled:shadow-none flex items-center gap-2"
                >
                  {isSyncing ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Syncing...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                      Start Sync
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
    </ErrorBoundary>
  );
};

export default App;
