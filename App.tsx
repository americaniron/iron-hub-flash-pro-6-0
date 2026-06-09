
import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { ConfigPanel } from './components/ConfigPanel.tsx';
import { QuotePreview } from './components/QuotePreview.tsx';
import { EmailModule } from './components/EmailModule.tsx';
import { ItemEditor } from './components/ItemEditor.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { Logo } from './components/Logo.tsx';
import { QuoteItem, ClientInfo, AppConfig, CustomerAccount, User, PhotoMode, SavedQuote, SyncStatus, InvoiceData, Payment, ServiceItem, RecurringInvoice, InvoiceTemplate, InventoryPart } from './types.ts';
import { analyzeQuoteData, generateTTS, generatePartImage, translateText } from './services/claudeService.ts';
import { dbService } from './services/dbService.ts';
import { exportInventoryForIronSuite, exportCustomersForIronSuite, exportContactsForIronSuite, exportQuotesForIronSuite, exportInvoicesForIronSuite } from './services/exportService.ts';
import { Login } from './components/Login.tsx';
import { activityBridge } from './services/activityBridge.ts';
import { pushToSuite, checkBridgeConnection, type BridgeSyncProgress, type BridgeSyncResult } from './services/bridgeSync.ts';
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

// Persistent login: remembers the logged-in user across sessions via localStorage
const useAuthenticatedUser = (): {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
} => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    // Restore session from localStorage
    const saved = localStorage.getItem('iron_hub_user');
    if (saved) {
      try {
        setUser(JSON.parse(saved));
      } catch {
        localStorage.removeItem('iron_hub_user');
      }
    }
  }, []);

  const login = (u: User) => {
    localStorage.setItem('iron_hub_user', JSON.stringify(u));
    setUser(u);
  };

  const logout = () => {
    localStorage.removeItem('iron_hub_user');
    setUser(null);
  };

  return { user, login, logout };
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
    errString.includes("Anthropic API billing") ||
    errString.includes("credit balance") ||
    errString.includes("purchase credits") ||
    errString.includes("billing") ||
    errString.includes("RESOURCE_EXHAUSTED") ||
    errString.includes("quota exceeded") ||
    errString.includes("Quota exceeded") ||
    errString.includes("limit: 0") ||
    (errString.includes("INVALID_ARGUMENT") && errString.includes("API key"))
  );
};

// ElevenLabs returns base64-encoded MP3. Decode to a Blob so we can play it via
// <Audio> (native MP3 decode) and attach/download it as a real .mp3 file.
function base64ToAudioBlob(base64: string): Blob {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return new Blob([bytes], { type: 'audio/mpeg' });
}

const InvoiceSystem = React.lazy(() => import('./components/InvoiceSystem.tsx').then(module => ({ default: module.InvoiceSystem })));
const AccountsSystem = React.lazy(() => import('./components/AccountsSystem.tsx').then(module => ({ default: module.AccountsSystem })));
const InventorySystem = React.lazy(() => import('./components/InventorySystem.tsx').then(module => ({ default: module.InventorySystem })));
const Dashboard = React.lazy(() => import('./components/Dashboard.tsx').then(module => ({ default: module.Dashboard })));

const App: React.FC = () => {
  const { user, login, logout } = useAuthenticatedUser();
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
  const [exportedFiles, setExportedFiles] = useState<string[]>([]);
  const [bridgeSyncing, setBridgeSyncing] = useState(false);
  const [bridgeProgress, setBridgeProgress] = useState<BridgeSyncProgress | null>(null);
  const [bridgeSyncResult, setBridgeSyncResult] = useState<BridgeSyncResult | null>(null);

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
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);
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
        // Initialize server connection & migrate local data if needed
        const { serverConnected } = await dbService.initialize(user.username);
        console.log(`[App] Data layer: ${serverConnected ? 'Cloud D1 (permanent)' : 'Local IndexedDB (fallback)'}`);
        activityBridge.init(); // Flush any queued activities from previous session

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
      const errString = typeof error === 'string' ? error : (error.message || JSON.stringify(error));
      const isBillingIssue = errString.includes("credit balance") || errString.includes("purchase credits") || errString.includes("billing");
      console.error("A production AI provider access error occurred:", error);
      alert(isBillingIssue
        ? "Anthropic API billing credits are exhausted. Add credits in Anthropic Plans & Billing, then retry the quote analysis."
        : "The production AI provider key is missing, invalid, or lacks required permissions. Check the Cloudflare Pages AI secrets and retry."
      );
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
      const total = cleanItems.reduce((sum, i) => sum + (i.qty * i.unitPrice), 0);
      activityBridge.quoteCreated(
        config.quoteId || generateDocumentId(false),
        client.company || client.contactName || 'N/A',
        cleanItems.length,
        total,
        user.username
      );
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
      activityBridge.inventoryUpdated(inventoryParts.length, user.username);

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
        activityBridge.analysisGenerated(config.quoteId, config.documentLanguage || 'en', user.username);
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
      if (!base64Audio) { setIsSpeaking(false); return; }
      setAudioData(base64Audio); // Save base64 for download / email-attach
      // Stop any in-flight audio + revoke its URL before starting new playback
      if (currentAudioRef.current) {
        try { currentAudioRef.current.pause(); } catch {}
        currentAudioRef.current = null;
      }
      if (currentAudioUrlRef.current) {
        URL.revokeObjectURL(currentAudioUrlRef.current);
        currentAudioUrlRef.current = null;
      }
      // Decode base64 → MP3 bytes → Blob → Object URL → native <audio> element.
      // The browser's <audio> handles MP3 natively; no Web Audio / PCM math.
      const url = URL.createObjectURL(base64ToAudioBlob(base64Audio));
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      currentAudioUrlRef.current = url;
      const cleanup = () => {
        if (currentAudioUrlRef.current === url) {
          URL.revokeObjectURL(url);
          currentAudioUrlRef.current = null;
          currentAudioRef.current = null;
        }
        setIsSpeaking(false);
      };
      audio.onended = cleanup;
      audio.onerror = () => { console.error('Audio playback failed'); cleanup(); };
      await audio.play();
    } catch (e) {
      if (!handleApiError(e)) {
        console.error("TTS Error:", e);
      }
      setIsSpeaking(false);
    }
  };

  // ---- WhatsApp Share Handlers ----
  const handleWhatsAppQuote = async () => {
    try {
      // Generate and auto-download the PDF
      const pdfBase64 = await generatePdf();
      if (!pdfBase64) { alert('Failed to generate PDF.'); return; }

      const byteString = atob(pdfBase64.split(',')[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      const pdfBlob = new Blob([ab], { type: 'application/pdf' });

      const dlUrl = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = dlUrl; a.download = `${config.quoteId || 'Quote'}.pdf`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(dlUrl);

      // Open WhatsApp API send page — prompts "Open WhatsApp?" dialog
      const phone = (client.whatsapp || client.phone || '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
      const text = encodeURIComponent(
        `Quote ${config.quoteId}\nCustomer: ${client.company || client.contactName || 'N/A'}\nItems: ${items.length}\nTotal: $${items.reduce((s, i) => s + i.qty * i.unitPrice, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      );
      window.open(`https://api.whatsapp.com/send/?phone=${phone}&text=${text}&type=phone_number&app_absent=0`, '_blank');
      if (user) activityBridge.quoteWhatsApp(config.quoteId, client.company || client.contactName || 'N/A', user.username);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('WhatsApp quote share error:', err);
      alert('WhatsApp share failed. Please try again.');
    }
  };

  const handleWhatsAppAnalysis = async () => {
    if (!aiAnalysis) { alert('No analysis to share. Run AI analysis first.'); return; }
    try {
      const phone = (client.whatsapp || client.phone || '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
      const truncated = aiAnalysis.length > 2000 ? aiAnalysis.substring(0, 2000) + '...' : aiAnalysis;
      const text = encodeURIComponent(`AI Analysis — ${config.quoteId}\n\n${truncated}`);
      window.open(`https://api.whatsapp.com/send/?phone=${phone}&text=${text}&type=phone_number&app_absent=0`, '_blank');
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('WhatsApp analysis share error:', err);
      alert('WhatsApp share failed. Please try again.');
    }
  };

  const handleDownloadAudio = () => {
    if (!audioData) return;
    const blob = base64ToAudioBlob(audioData);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `AI-Analysis-${config.quoteId}.mp3`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const getAudioAttachment = async (): Promise<string | null> => {
    if (!audioData) return null;
    const blob = base64ToAudioBlob(audioData);
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
    if (existingAccount) {
      activityBridge.customerUpdated(clientData.contactName || '', clientData.company || '', user.username);
    } else {
      activityBridge.customerAdded(clientData.contactName || '', clientData.company || '', user.username);
    }
  }, [user, customerAccounts]);


  const handleDeleteFromBook = async (id: string) => {
    if (!user) return;
    const deletedAccount = customerAccounts.find(c => c.id === id);
    const updatedBook = customerAccounts.filter(c => c.id !== id);
    setCustomerAccounts(updatedBook);
    await dbService.saveCustomerAccounts(user.username, updatedBook);
    if (deletedAccount) activityBridge.customerDeleted(deletedAccount.company || deletedAccount.contactName || id, user.username);
  };
  
  const handleLogout = () => {
    logout();
  };

  const handleSaveInvoices = async (newInvoices: InvoiceData[]) => {
    if (!user) return;
    setSyncStatus('syncing');
    try {
      // Detect newly created invoices for activity logging
      const existingInvIds = new Set(invoices.map(i => i.id));
      const brandNewInvoices = newInvoices.filter(i => !existingInvIds.has(i.id));
      setInvoices(newInvoices);
      await dbService.saveInvoices(user.username, newInvoices);
      setSyncStatus('stable');
      for (const inv of brandNewInvoices) {
        const invClient = customerAccounts.find(c => c.id === inv.clientId);
        activityBridge.invoiceCreated(inv.id, invClient?.company || inv.clientId || 'N/A', inv.total, user.username);
      }
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
    activityBridge.customerDeleted(accountToDelete.company || accountToDelete.contactName || accountId, user.username);
    alert(`${accountToDelete.company} has been permanently deleted.`);
  };


  const handlePaymentsUpdate = async (newPayments: Payment[]) => {
    if (!user) return;
    // Detect newly added payments for activity logging
    const existingIds = new Set(payments.map(p => p.id));
    const brandNewPayments = newPayments.filter(p => !existingIds.has(p.id));
    setPayments(newPayments);
    await dbService.savePayments(user.username, newPayments);
    // Log each new payment to activity bridge
    for (const np of brandNewPayments) {
      const payClient = customerAccounts.find(c => c.id === np.clientId);
      activityBridge.paymentRecorded(np.id, payClient?.company || np.clientId || 'Unknown', np.amount, np.method || 'other', user.username);
    }
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
    const total = serviceItems.reduce((sum, si) => sum + (si.hours * si.rate), 0);
    activityBridge.invoiceConverted(config.quoteId, newInvoice.id, client.company || 'N/A', total, user!.username);
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
      activityBridge.quoteSaved(config.quoteId, client.company || client.contactName || 'N/A', user.username);
      activityBridge.cloudSynced(user.username);
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
    if (user) activityBridge.quoteSaved(config.quoteId, client.company || client.contactName || 'N/A', user.username);
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
        activityBridge.dataExported(user.username);
    } catch (error) {
        alert("Data export failed.");
    }
  };

  const handleExportForIronSuite = (category: string) => {
    try {
      switch (category) {
        case 'customers':
          exportCustomersForIronSuite(customerAccounts);
          break;
        case 'contacts':
          exportContactsForIronSuite(customerAccounts);
          break;
        case 'quotes':
          exportQuotesForIronSuite(quoteHistory);
          break;
        case 'invoices':
          exportInvoicesForIronSuite(invoices, customerAccounts, payments);
          break;
        case 'inventory':
          exportInventoryForIronSuite(inventory);
          break;
      }
      if (!exportedFiles.includes(category)) {
        setExportedFiles(prev => [...prev, category]);
      }
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  const handleExportAllForIronSuite = () => {
    const categories = [
      { key: 'customers', data: customerAccounts },
      { key: 'contacts', data: customerAccounts },
      { key: 'quotes', data: quoteHistory },
      { key: 'invoices', data: invoices },
      { key: 'inventory', data: inventory },
    ];
    const exported: string[] = [];
    for (const cat of categories) {
      if (cat.data.length > 0) {
        handleExportForIronSuite(cat.key);
        exported.push(cat.key);
      }
    }
    setExportedFiles(exported);
  };

  const handlePushToSuite = async () => {
    if (!user) return;
    setBridgeSyncing(true);
    setBridgeProgress({ stage: 'connecting', detail: 'Waking up Iron Hub Suite (may take a moment)...', percent: 0 });
    setBridgeSyncResult(null);

    try {
      const connected = await checkBridgeConnection();
      if (!connected) {
        setBridgeSyncResult({
          success: false,
          timestamp: new Date().toISOString(),
          accounts: { pushed: 0, failed: 0 },
          invoices: { pushed: 0, failed: 0 },
          inventory: { pushed: 0, failed: 0 },
          payments: { pushed: 0, failed: 0 },
          errors: ['Cannot reach Iron Hub Suite. Check your internet connection or try again later.'],
        });
        setBridgeSyncing(false);
        return;
      }

      const result = await pushToSuite(dbService, user.username, (p) => {
        setBridgeProgress(p);
      });
      setBridgeSyncResult(result);
    } catch (err: any) {
      setBridgeSyncResult({
        success: false,
        timestamp: new Date().toISOString(),
        accounts: { pushed: 0, failed: 0 },
        invoices: { pushed: 0, failed: 0 },
        inventory: { pushed: 0, failed: 0 },
        payments: { pushed: 0, failed: 0 },
        errors: [err.message || 'Unknown error during sync'],
      });
    } finally {
      setBridgeSyncing(false);
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
            
            // Update ALL local state immediately so the user sees the changes without needing a full reload
            if (importedData.accounts) setCustomerAccounts(importedData.accounts);
            if (importedData.quotes) setQuoteHistory(importedData.quotes);
            if (importedData.invoices) setInvoices(importedData.invoices);
            if (importedData.payments) setPayments(importedData.payments);
            if (importedData.recurring_invoices) setRecurringInvoices(importedData.recurring_invoices);
            if (importedData.templates) setTemplates(importedData.templates);
            if (importedData.inventory) setInventory(importedData.inventory);
            
            setSyncStatus('stable');
            activityBridge.dataImported(user.username);
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
    return <Login onLogin={login} />;
  }

  const generatePdf = async () => {
    const element = document.querySelector('.printable-area') as HTMLElement;
    if (!element) return null;
    
    // Temporarily add a class to force print styles for PDF generation
    element.classList.add('pdf-generation-mode');
    document.body.classList.add('pdf-generation-mode-active');
    
    const opt = {
      margin:       [0.25, 0.5, 0.85, 0.5] as [number, number, number, number], // top, right, bottom (room for footer), left — matches @page
      filename:     `${config.quoteId || 'Document'}.pdf`,
      image:        { type: 'jpeg' as const, quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, windowWidth: 1100, width: 1100, scrollX: 0, scrollY: 0, backgroundColor: '#ffffff' },
      jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' as const },
      pagebreak:    {
        mode:  ['avoid-all', 'css', 'legacy'],
        avoid: ['tr', 'td', 'th', '.address-block', '.totals-container', '.totals-container-print', '.terms-box', '.summary-table', '.receipt-header', '.invoice-print-footer', '.ai-analysis-box']
      }
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
              onPrint={() => { window.print(); activityBridge.quotePrinted(config.quoteId, user.username); }} onEmailDispatch={() => setIsEmailOpen(true)} onWhatsAppQuote={handleWhatsAppQuote}
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
                  <button
                    onClick={handleWhatsAppAnalysis}
                    disabled={!aiAnalysis}
                    className="flex items-center justify-center w-10 h-10 bg-[#25D366] text-white rounded-full hover:bg-[#1fb855] transition-all shadow-sm active:scale-95 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                    title="Share Analysis via WhatsApp"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
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
            onEmailSent={(to, subject) => {
              if (user) {
                const docId = invoiceToSend ? invoiceToSend.id : config.quoteId;
                const customerName = invoiceToSend
                  ? (customerAccounts.find(c => c.id === invoiceToSend.clientId)?.company || 'N/A')
                  : (client.company || client.contactName || 'N/A');
                activityBridge.quoteSentEmail(docId, customerName, to, user.username);
                if (invoiceToSend) {
                  activityBridge.invoiceCreated(invoiceToSend.id, customerName, invoiceToSend.total, user.username);
                }
              }
            }}
          />
        </div>

        {/* IronSuite Export Modal */}
        {showSyncModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center animate-in fade-in duration-200">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg mx-4 overflow-hidden border border-slate-200/60">
              {/* Header */}
              <div className="bg-cat-black px-8 py-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl -mr-20 -mt-20"></div>
                <div className="relative z-10 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-black uppercase tracking-tight text-white">Sync to IronSuite</h2>
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-1">Push directly or download CSVs</p>
                  </div>
                  <button
                    onClick={() => { setShowSyncModal(false); setExportedFiles([]); setBridgeSyncResult(null); setBridgeProgress(null); }}
                    className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
                {/* ── PUSH DIRECTLY TO SUITE ── */}
                <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-5 border border-emerald-200/60">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path></svg>
                    </div>
                    <div>
                      <p className="text-[12px] font-black text-emerald-900 uppercase tracking-wider">Push Directly to Suite</p>
                      <p className="text-[9px] font-bold text-emerald-600">One-click sync — no CSV files needed</p>
                    </div>
                  </div>
                  <p className="text-[10px] font-bold text-emerald-700 leading-relaxed mb-3">
                    Pushes all accounts, invoices, inventory, and payments directly to Iron Hub Suite via the bridge API.
                  </p>

                  {/* Progress bar */}
                  {bridgeSyncing && bridgeProgress && (
                    <div className="mb-3">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[9px] font-black text-emerald-800 uppercase">{bridgeProgress.stage}</span>
                        <span className="text-[9px] font-bold text-emerald-600">{bridgeProgress.percent}%</span>
                      </div>
                      <div className="w-full h-2 bg-emerald-200 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-600 rounded-full transition-all duration-300" style={{ width: `${bridgeProgress.percent}%` }}></div>
                      </div>
                      <p className="text-[9px] font-bold text-emerald-600 mt-1">{bridgeProgress.detail}</p>
                    </div>
                  )}

                  {/* Sync result */}
                  {bridgeSyncResult && !bridgeSyncing && (
                    <div className={`rounded-lg p-3 mb-3 border ${bridgeSyncResult.success ? 'bg-emerald-100 border-emerald-300' : 'bg-red-50 border-red-200'}`}>
                      <p className={`text-[10px] font-black uppercase ${bridgeSyncResult.success ? 'text-emerald-800' : 'text-red-800'}`}>
                        {bridgeSyncResult.success ? '✓ Sync Complete' : '✗ Sync Had Errors'}
                      </p>
                      <div className="grid grid-cols-2 gap-1 mt-2">
                        <span className="text-[9px] font-bold text-slate-600">Accounts: {bridgeSyncResult.accounts.pushed} pushed</span>
                        <span className="text-[9px] font-bold text-slate-600">Invoices: {bridgeSyncResult.invoices.pushed} pushed</span>
                        <span className="text-[9px] font-bold text-slate-600">Inventory: {bridgeSyncResult.inventory.pushed} pushed</span>
                        <span className="text-[9px] font-bold text-slate-600">Payments: {bridgeSyncResult.payments.pushed} pushed</span>
                      </div>
                      {bridgeSyncResult.errors.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {bridgeSyncResult.errors.map((err, i) => (
                            <p key={i} className="text-[9px] font-bold text-red-600">⚠ {err}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={handlePushToSuite}
                    disabled={bridgeSyncing || (customerAccounts.length === 0 && quoteHistory.length === 0 && invoices.length === 0 && inventory.length === 0)}
                    className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-400 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-emerald-600/20 disabled:shadow-none flex items-center justify-center gap-2"
                  >
                    {bridgeSyncing ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                        Syncing...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path></svg>
                        Push All Data to Suite
                      </>
                    )}
                  </button>
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-slate-200"></div>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Or Export as CSV</span>
                  <div className="flex-1 h-px bg-slate-200"></div>
                </div>

                {/* Export Buttons */}
                <div className="space-y-3">
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Download CSV Files</p>
                  {[
                    { key: 'customers', label: 'Customer Organizations', count: customerAccounts.length, icon: '🏢', desc: 'Company names, addresses, contacts' },
                    { key: 'contacts', label: 'CRM Contacts', count: customerAccounts.length, icon: '👤', desc: 'First/last name, email, phone, company' },
                    { key: 'quotes', label: 'Past Quotes', count: quoteHistory.length, icon: '📋', desc: 'Quote numbers, line items, totals' },
                    { key: 'invoices', label: 'Past Invoices', count: invoices.length, icon: '📄', desc: 'Invoice numbers, line items, payments' },
                    { key: 'inventory', label: 'Inventory Items', count: inventory.length, icon: '📦', desc: 'Part numbers, descriptions, prices' },
                  ].map(item => (
                    <div key={item.key} className="flex items-center justify-between bg-slate-50 rounded-xl p-4 border border-slate-100 hover:border-slate-200 transition-all">
                      <div className="flex items-center gap-3">
                        <div className="text-xl">{item.icon}</div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-black text-cat-black">{item.label}</span>
                            <span className="text-[9px] font-bold text-slate-400 bg-slate-200/60 px-2 py-0.5 rounded-full">{item.count}</span>
                          </div>
                          <p className="text-[9px] font-bold text-slate-400 mt-0.5">{item.desc}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {exportedFiles.includes(item.key) && (
                          <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
                        )}
                        <button
                          onClick={() => handleExportForIronSuite(item.key)}
                          disabled={item.count === 0}
                          className="px-4 py-2 bg-cat-black hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[9px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center gap-1.5"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                          CSV
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Exported confirmation */}
                {exportedFiles.length > 0 && (
                  <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200/50">
                    <div className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
                      <p className="text-[11px] font-black text-emerald-800">
                        {exportedFiles.length} file{exportedFiles.length > 1 ? 's' : ''} downloaded!
                        <span className="font-bold text-emerald-600"> Now import them into IronSuite.</span>
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-8 py-5 bg-slate-50 border-t border-slate-200/60 flex justify-between">
                <button
                  onClick={() => { setShowSyncModal(false); setExportedFiles([]); setBridgeSyncResult(null); setBridgeProgress(null); }}
                  className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={handleExportAllForIronSuite}
                  disabled={customerAccounts.length === 0 && quoteHistory.length === 0 && invoices.length === 0 && inventory.length === 0}
                  className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-emerald-600/20 disabled:shadow-none flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                  Export All CSVs
                </button>
              </div>
            </div>
          </div>
        )}
    </ErrorBoundary>
  );
};

export default App;
