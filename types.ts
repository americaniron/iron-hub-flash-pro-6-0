

export interface InventoryPart {
  id: string; // The AI-generated SKU number starting with "AMI"
  partNo: string;
  description: string;
  imageUrl?: string;
  originalImages?: string[];
  originalPrice: number;
}

export interface User {
  username: string;
  role: string;
  displayName: string;
  credits?: number;
}

export interface QuoteItem {
  qty: number;
  partNo: string;
  desc: string;
  weight: number; 
  unitPrice: number;
  coreDeposit?: number;
  originalImages?: string[]; 
  aiImageUrl?: string;
  availability?: string;
  notes?: string;
  lineNo?: string;
}

// --- New Invoicing Types ---
export interface ServiceItem {
  id: string;
  description: string;
  hours: number;
  rate: number;
  taxable: boolean;
  imageUrl?: string;
  originalImages?: string[];
}

export interface ServiceProvider {
  id: string;
  name: string;
  specialty: string;
  contactName: string;
  phone: string;
  email: string;
}

export interface InvoiceData {
  id:string;
  date: string;
  dueDate: string;
  providerId?: string;
  clientId: string; // Made mandatory
  items: ServiceItem[];
  taxRate: number;
  discount: number;
  notes: string;
  // New fields for account tracking
  status: 'draft' | 'unpaid' | 'paid' | 'overdue';
  total: number;
  templateId?: string;
}

export interface RecurringInvoice {
  id: string;
  clientId: string;
  items: ServiceItem[];
  taxRate: number;
  discount: number;
  notes: string;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  startDate: string;
  lastGenerated?: string;
  nextGeneration: string;
  isActive: boolean;
  templateId?: string;
}

export interface InvoiceTemplate {
  id: string;
  name: string;
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  headerStyle: 'classic' | 'modern' | 'minimal';
  showLogo: boolean;
}

export interface Payment {
  id: string;
  invoiceId: string;
  clientId: string;
  date: string;
  amount: number;
  method: 'Wire' | 'Check' | 'Card' | 'Other';
}
// --- End Invoicing Types ---

export interface ClientInfo {
  id?: string; // Optional ID to track loaded accounts
  accountNumber: string;
  company: string;
  contactName: string;
  email: string;
  phone: string;
  website?: string;
  whatsapp?: string;
  
  billingAddress: string;
  billingCity: string;
  billingState: string;
  billingZip: string;
  billingCountry: string;

  shippingAddress: string;
  shippingCity: string;
  shippingState: string;
  shippingZip: string;
  shippingCountry: string;
}

// Renamed from SavedClient to establish permanent accounts
export interface CustomerAccount extends ClientInfo {
  id: string;
  internalNotes?: string;
}

export interface SavedQuote {
  id: string;
  timestamp: string;
  author: string;
  title: string;
  total: number;
  payload: {
    items: QuoteItem[];
    client: ClientInfo;
    config: AppConfig;
    aiAnalysis: string | null;
  };
}

export enum PhotoMode {
  EXTRACT = 'extract',
  AI = 'ai',
  NONE = 'none'
}

export interface AppConfig {
  markupPercentage: number;
  discountPercentage: number;
  quoteId: string;
  poNumber: string;
  expirationDate: string; 
  logisticsRate: number;
  isInvoice: boolean;
  weightUnit: 'LBS' | 'KG';
  includeAiAnalysis: boolean; 
  photoMode: PhotoMode;
  imageSize: '1K' | '2K' | '4K';
  paymentTerms?: string;
  specialInstructions?: string;
  creditOrRefund?: number;
  ttsLanguage: 'en' | 'ar';
  documentLanguage: 'en' | 'ar';
}

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
}

export enum ParseMode {
  PASTE = 'paste',
  PDF = 'pdf',
  EXCEL = 'excel',
  VOICE = 'voice'
}

export type SyncStatus = 'stable' | 'syncing' | 'error';

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
  
  interface Window {
    aistudio?: AIStudio;
    AudioContext: typeof AudioContext;
    webkitAudioContext: typeof AudioContext;
  }
}
