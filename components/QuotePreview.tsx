
import React, { useState, useEffect } from 'react';
import { QuoteItem, ClientInfo, AppConfig, PhotoMode } from '../types.ts';
import { PartImage } from './PartImage.tsx';
import { Logo } from './Logo.tsx';
import { calculateQuoteFinancials } from '../services/documentMath.ts';
import { countryName } from '../services/countryOptions.ts';

interface QuotePreviewProps {
  items: QuoteItem[];
  client: ClientInfo;
  config: AppConfig;
  aiAnalysis: string | null;
  customLogo: string | null;
  isGeneratingImages: boolean;
  audioData: string | null;
  onConfigChange?: (config: AppConfig) => void;
}

const formatCurrency = (amount: number) => {
  return amount.toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });
};

// ElevenLabs returns base64-encoded MP3. Keep the bytes as MP3 instead of
// wrapping them in a WAV header, which corrupts playback/downloads.
const toMp3DataUrl = (base64Audio: string): string => {
  if (base64Audio.startsWith('data:')) return base64Audio;
  return `data:audio/mpeg;base64,${base64Audio}`;
};

const translations = {
  en: {
    logistics: "Caterpillar Support & Logistics",
    address: "13930 N. Dale Mabry HWY. Site 5. Tampa, FL. 33618",
    tel: "Tel (850) 777-3797  Fax. (813) 249-9730",
    website: "www.AmericanIronUS.com",
    invoice: "Invoice",
    quote: "Quote",
    docId: "Document ID",
    issueDate: "Issue Date",
    validUntil: "Valid Until",
    billTo: "Bill To Protocol",
    shipTo: "Dispatch Destination",
    line: "Line",
    partNo: "Part Number",
    description: "Description",
    qty: "Qty",
    unitVal: "Unit Val",
    extVal: "Ext Val",
    core: "CORE",
    status: "Status",
    subtotal: "Subtotal",
    logisticsFee: "Logistics & Engineering",
    discount: "Discount",
    credit: "Credit/Refund",
    totalDue: "Total Amount Due",
    totalValue: "Total Quote Value",
    paymentTerms: "Payment Terms",
    specialInstructions: "Special Instructions",
    diagnostic: "Engineering Diagnostic Analysis",
    signature: "Authorized Signature",
    attn: "ATTN",
    terms: "Terms & Conditions",
    totalWeight: "TOTAL WEIGHT",
    freightFactor: "DHL 2-DAY AIR SHIPPING",
    loyaltyDiscount: "Customer Loyalty Discount",
    totalCore: "Total Core Deposits",
    totalDocValue: "Total Document Value",
    commercialTerms: "Commercial Terms",
    downloadBrief: "Download Audio Brief",
    aiAnalysisTitle: "AI System Analysis",
    manifestSubtotal: "SUB-TOTAL"
  },
  ar: {
    logistics: "دعم كاتر بيلر والخدمات اللوجستية",
    address: "13930 طريق ديل مابري السريع ن. الموقع 5. تامبا، فلوريدا. 33618",
    tel: "هاتف (850) 777-3797 فاكس. (813) 249-9730",
    website: "www.AmericanIronUS.com",
    invoice: "فاتورة",
    quote: "عرض سعر",
    docId: "رقم المستند",
    issueDate: "تاريخ الإصدار",
    validUntil: "صالح حتى",
    billTo: "بروتوكول الفوترة",
    shipTo: "وجهة الشحن",
    line: "البند",
    partNo: "رقم القطعة",
    description: "الوصف",
    qty: "الكمية",
    unitVal: "قيمة الوحدة",
    extVal: "القيمة الإجمالية",
    core: "الوديعة الأساسية",
    status: "الحالة",
    subtotal: "المجموع الفرعي",
    logisticsFee: "الخدمات اللوجستية والهندسة",
    discount: "خصم",
    credit: "رصيد / استرداد",
    totalDue: "إجمالي المبلغ المستحق",
    totalValue: "إجمالي قيمة العرض",
    paymentTerms: "شروط الدفع",
    specialInstructions: "تعليمات خاصة",
    diagnostic: "تحليل التشخيص الهندسي",
    signature: "التوقيع المعتمد",
    attn: "عناية",
    terms: "الشروط والأحكام",
    totalWeight: "إجمالي الوزن",
    freightFactor: "عامل الشحن",
    loyaltyDiscount: "خصم ولاء العملاء",
    totalCore: "إجمالي الودائع الأساسية",
    totalDocValue: "إجمالي قيمة المستند",
    commercialTerms: "الشروط التجارية",
    downloadBrief: "تحميل الملخص الصوتي",
    aiAnalysisTitle: "تحليل نظام الذكاء الاصطناعي",
    manifestSubtotal: "المجموع الفرعي للمانيفست"
  }
};

const defaultTerms = {
  en: "NEW PARTS TERMS / WARRANTY DISCLAIMER / LIMITATION OF LIABILITY: ALL PRODUCTS SOLD BY AMERICAN IRON LLC ARE BRAND NEW. EXCEPT AS EXPRESSLY STATED IN WRITING BY SELLER, SELLER DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING ANY IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. ANY WARRANTY COVERAGE OFFERED WITH THE PRODUCT (IF ANY) IS PROVIDED SOLELY BY THE PRODUCT’S MANUFACTURER AND IS GOVERNED BY THE MANUFACTURER’S WARRANTY TERMS, PROCEDURES, AND LIMITATIONS; SELLER DOES NOT CONTROL MANUFACTURER WARRANTY DETERMINATIONS. BUYER IS SOLELY RESPONSIBLE FOR CONFIRMING PART NUMBER ACCURACY, COMPATIBILITY, SERIAL-NUMBER RANGE/APPLICATION, AND PROPER INSTALLATION. SELLER SHALL NOT BE LIABLE FOR LABOR, REMOVAL/INSTALLATION, TRAVEL, TOWING, FREIGHT, DOWNTIME, LOSS OF PROFITS, LOSS OF USE, OR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES. SELLER’S MAXIMUM LIABILITY FOR ANY CLAIM IS LIMITED TO THE INVOICE PRICE PAID FOR THE SPECIFIC ITEM(S) GIVING RISE TO THE CLAIM, AT SELLER’S OPTION. TITLE AND RISK OF LOSS TRANSFER UPON PICKUP OR TENDER TO CARRIER UNLESS OTHERWISE AGREED IN WRITING.",
  ar: "شروط قطع الغيار الجديدة / إخلاء المسؤولية عن الضمان / تحديد المسؤولية: جميع المنتجات المباعة من قبل شركة أمريكان أيرون ذ.م.م هي منتجات جديدة تمامًا. باستثناء ما هو منصوص عليه صراحةً كتابيًا من قبل البائع، يخلي البائع مسؤوليته عن جميع الضمانات، الصريحة أو الضمنية، بما في ذلك أي ضمانات ضمنية للتسويق والملاءمة لغرض معين. يتم توفير أي تغطية ضمان مقدمة مع المنتج (إن وجدت) حصريًا من قبل الشركة المصنعة للمنتج وتخضع لشروط وإجراءات وقيود ضمان الشركة المصنعة؛ لا يتحكم البائع في قرارات ضمان الشركة المصنعة. المشتري هو المسؤول الوحيد عن تأكيد دقة رقم القطعة، والتوافق، ونطاق الرقم التسلسلي/التطبيق، والتركيب الصحيح. لن يكون البائع مسؤولاً عن العمالة، أو الإزالة/التركيب، أو السفر، أو السحب، أو الشحن، أو التوقف عن العمل، أو خسارة الأرباح، أو فقدان الاستخدام، أو أي أضرار غير مباشرة أو عرضية أو خاصة أو تبعية. تقتصر المسؤولية القصوى للبائع عن أي مطالبة على سعر الفاتورة المدفوع للعنصر (العناصر) المحددة التي أدت إلى المطالبة، حسب خيار البائع. تنتقل الملكية ومخاطر الخسارة عند الاستلام أو التسليم للناقل ما لم يتم الاتفاق على خلاف ذلك كتابيًا."
};

const AddressBlock: React.FC<{ title: string; client: ClientInfo; isShipping?: boolean; lang: 'en' | 'ar' }> = ({ title, client, isShipping = false, lang }) => {
  const t = translations[lang];
  const effectiveAddress = (isShipping && client.shippingAddress) ? {
    address: client.shippingAddress,
    city: client.shippingCity,
    state: client.shippingState,
    zip: client.shippingZip,
    country: client.shippingCountry,
  } : {
    address: client.billingAddress,
    city: client.billingCity,
    state: client.billingState,
    zip: client.billingZip,
    country: client.billingCountry,
  };

  const addressCountryName = countryName(effectiveAddress.country);

  return (
    <div className="bg-slate-50/80 p-8 rounded-[2rem] border border-slate-200/60 text-[10px] h-full flex flex-col address-block print:flex-1 print:bg-white print:p-3 print:border-slate-300 print:rounded-lg shadow-sm print:break-inside-avoid">
      <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-cat-black mb-5 print:text-[7pt] print:mb-1">
        <span className="bg-cat-yellow/20 text-cat-black px-3 py-1.5 rounded-xl border border-cat-yellow/30">{title}</span>
      </h3>
      <div className="space-y-3">
        <p className="font-black text-cat-black text-[15px] uppercase tracking-tight print:text-[10pt]">{client.company}</p>
        <div className="text-slate-600 leading-relaxed uppercase font-bold print:text-[8pt] print:text-black">
          {effectiveAddress.address}<br />
          {effectiveAddress.city}, {effectiveAddress.state} {effectiveAddress.zip}<br />
          {addressCountryName}
        </div>
        <div className="pt-3 flex flex-col gap-1.5 border-t border-slate-200/80 mt-3">
           {client.contactName && <p className="text-slate-500 font-black uppercase text-[10px] tracking-widest print:text-[7pt] print:text-slate-700">{t.attn}: <span className="text-cat-black">{client.contactName}</span></p>}
           {client.phone && <p className="text-slate-500 font-mono font-bold print:text-[7pt] print:text-slate-700">{client.phone}</p>}
        </div>
      </div>
    </div>
  );
};

export const QuotePreview: React.FC<QuotePreviewProps> = ({ items, client, config, aiAnalysis, customLogo, isGeneratingImages, audioData, onConfigChange }) => {
  const lang = config.documentLanguage || 'en';
  const isRtl = lang === 'ar';
  const t = translations[lang];
  
  const [audioDataUrl, setAudioDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (audioData) {
      setAudioDataUrl(toMp3DataUrl(audioData));
    } else {
      setAudioDataUrl(null);
    }
  }, [audioData]);
  
  const { markedItems, subtotal, totalWeight, totalCoreDeposits, logistics, discount, creditOrRefund, total } = calculateQuoteFinancials(items, config);

  return (
    <div className="max-w-[1100px] mx-auto bg-white shadow-[0_20px_60px_rgba(0,0,0,0.08)] my-16 print:my-0 print:shadow-none print:max-w-none print:overflow-visible overflow-hidden rounded-[2.5rem] print:rounded-none border-t-[12px] border-t-cat-black relative" dir={isRtl ? 'rtl' : 'ltr'}>
      <style>{`
        .print-footer { display: none; }
        @media print {
          /*
            == INSTITUTIONAL GRADE PRODUCTION PRINT STYLESHEET V6 ==
            Engineered for mission-critical PDF generation.
            - Universal box-sizing for absolute layout integrity.
            - Standardized on 'pt' units for typographic precision.
            - Enforced fixed table layout for perfect column alignment.
            - Guaranteed 0.5-inch Letter margins for professional binding.
            - Refined typographic hierarchy and cell padding for maximum clarity.
            - High-contrast elements for superior print quality.
            - Corrected summary layout with table display for perfect alignment.
          */

          /* Rule 1: Define page layout and guarantee margins. */
          @page {
            size: LETTER;
            margin: 0.45in 0.5in 0.55in 0.5in !important;
          }

          /* Rule 2: Reset and prepare the document body for printing. */
          *, *::before, *::after {
            box-sizing: border-box !important;
          }

          html, body {
            width: 100% !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          body {
            color: #000 !important;
            font-family: 'Plus Jakarta Sans', sans-serif !important;
            font-size: 8.5pt !important;
            line-height: 1.32 !important;
            direction: ${isRtl ? 'rtl' : 'ltr'} !important;
          }

          .no-print { display: none !important; }
          .print-root { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; }

          /* Rule 3: Enforce a rigid, non-breaking table structure for line items. */
          table {
            width: 100% !important;
            border-collapse: collapse !important;
            table-layout: fixed !important;
            border-spacing: 0 !important;
            margin-bottom: 10pt !important;
          }
          thead { display: table-header-group !important; }
          tfoot { display: table-footer-group !important; }
          tr { page-break-inside: avoid !important; break-inside: avoid !important; }
          /* Keep section headers attached to following content */
          h1, h2, h3, .section-header { break-after: avoid !important; page-break-after: avoid !important; }
          th, td {
            padding: 5pt !important;
            border-bottom: 1pt solid #dee2e6 !important; /* Sharper border color */
            vertical-align: top !important;
            word-wrap: break-word !important;
            overflow-wrap: anywhere !important;
            text-align: ${isRtl ? 'right' : 'left'} !important;
          }

          th {
            background-color: #000 !important;
            color: #ffcd00 !important;
            font-weight: 900 !important;
            text-align: ${isRtl ? 'right' : 'left'} !important;
            text-transform: uppercase !important;
            font-size: 7pt !important;
            letter-spacing: 0.08em !important; /* Wider spacing */
          }

          td { font-size: 8pt !important; color: #000 !important; }
          .num-col { text-align: ${isRtl ? 'left' : 'right'} !important; white-space: nowrap !important; }
          .summary-table { table-layout: auto !important; }
          .summary-table td { border-bottom: none !important; padding: 2pt 0 !important; }

          /* Rule 4: Suite-style header banner for print */
          .print-header {
            margin: 0 !important;
            margin-bottom: 8pt !important;
            width: 100% !important;
          }
          .print-header > div:last-child {
            padding: 10pt 14pt !important;
          }
          .print-header .quote-heading {
            font-size: 24pt !important;
            letter-spacing: 1px !important;
          }
          .print-header .company-name {
            font-size: 14pt !important;
          }
          .print-header .company-detail {
            font-size: 8pt !important;
          }
          .print-header .logo-box {
            width: 50pt !important;
            height: 50pt !important;
          }
          .print-header h1 { font-size: 26pt !important; color: #000 !important; }
          .print-header h2 { font-size: 20pt !important; }
          .print-header p { font-size: 8.5pt !important; }

          .address-block { 
            border-radius: 6pt !important; 
            border: 1pt solid #dee2e6 !important;
            background: #f8f9fa !important;
          }
          .address-block h3 { font-size: 7.5pt !important; }
          .address-block p { font-size: 10pt !important; }
          .address-block div { font-size: 8.5pt !important; }

          .part-img-container { width: 42pt !important; height: 42pt !important; }
          .line-item-desc { font-size: 9pt !important; font-weight: 700 !important; }
          .line-item-notes { font-size: 7.5pt !important; }

          /* Rule 5: Stabilize layout of summary blocks to prevent page-break issues. */
          .summary-table, .summary-table tr, .totals-container, .address-block {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-before: auto !important;
          }

          .totals-container {
            display: flex !important;
            flex-direction: row !important;
            justify-content: space-between !important;
            gap: 20pt !important;
            margin-top: 12pt !important;
            width: 100% !important;
            break-before: auto !important;
          }
          .ai-analysis-box {
             background: #f8f9fa !important;
             border: 1pt solid #dee2e6 !important;
             border-left: 3pt solid #ffcd00 !important;
          }
          .ai-analysis-box p { font-size: 8.5pt !important; }
          .terms-box p { font-size: 7.25pt !important; line-height: 1.28 !important; }
          .ai-analysis-box h4 { font-size: 8pt !important; }
          .terms-box div { font-size: 7.5pt !important; }

          .print-footer {
            display: block !important;
            position: fixed;
            bottom: 0.15in;
            left: 0.5in;
            right: 0.5in;
            text-align: center;
            font-size: 6.5pt !important;
            color: #6c757d !important;
          }
          .print-footer p {
            margin: 0;
            line-height: 1.2;
          }
        }
        
        .num-col { text-align: ${isRtl ? 'left' : 'right'} !important; }
        .vertical-top { vertical-align: top !important; }
      `}</style>

      {/* Language Switcher (No Print) */}
      {onConfigChange && (
        <div className={`absolute top-6 ${isRtl ? 'left-6' : 'right-6'} no-print z-50 flex gap-2 bg-slate-100 p-1.5 rounded-full shadow-sm border border-slate-200`}>
          <button
            onClick={() => onConfigChange({ ...config, documentLanguage: 'en' })}
            className={`px-4 py-1.5 text-[10px] font-black uppercase rounded-full transition-all ${lang === 'en' ? 'bg-white text-cat-black shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
          >
            English
          </button>
          <button
            onClick={() => onConfigChange({ ...config, documentLanguage: 'ar' })}
            className={`px-4 py-1.5 text-[10px] font-black uppercase rounded-full transition-all ${lang === 'ar' ? 'bg-white text-cat-black shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
          >
            العربية
          </button>
        </div>
      )}

      <div className="p-14 print:p-0 print-root pdf-generation-mode-root">
        
        {/* Suite-Style Header Banner */}
        <div className="print-header mb-8 print:mb-4">
          {/* Gold accent line */}
          <div style={{ background: '#d4a843', height: '5px', width: '100%' }}></div>
          {/* Dark header bar */}
          <div style={{ background: '#1a1a2e', padding: '20px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} dir="ltr">
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: 0, flex: '1 1 auto' }}>
              <div className="logo-box" style={{ width: '90px', height: '90px', flexShrink: 0 }}>
                {customLogo ? <img src={customLogo} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="Custom Logo" /> : <Logo className="w-full h-full" />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="company-name" style={{ color: '#fff', fontSize: '26px', fontWeight: 'bold', letterSpacing: '1px' }}>AMERICAN IRON LLC</div>
                <div className="company-detail" style={{ color: '#d4a843', fontSize: '10px', letterSpacing: '4px', marginTop: '3px', fontWeight: 600 }}>{t.logistics.toUpperCase()}</div>
                <div className="company-detail" style={{ color: '#ccc', fontSize: '10px', marginTop: '6px' }}>13930 N. DALE MABRY HWY.</div>
                <div className="company-detail" style={{ color: '#ccc', fontSize: '10px' }}>+1 (850) 777-3797</div>
                <div className="company-detail" style={{ color: '#d4a843', fontSize: '10px' }}>WWW.AMERICANIRONUS.COM</div>
              </div>
            </div>
            <div className="quote-heading" style={{ color: '#fff', fontSize: '48px', fontWeight: 'bold', fontStyle: 'italic', letterSpacing: '2px', flexShrink: 0, marginLeft: '16px', whiteSpace: 'nowrap' }}>
              {config.isInvoice ? t.invoice.toUpperCase() : t.quote.toUpperCase()}
            </div>
          </div>
        </div>

        {/* REF ID / Date Info */}
        <div className={`flex mb-6 print:mb-4 ${isRtl ? 'justify-start' : 'justify-end'}`}>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="text-[11px]">
              <tbody>
                <tr>
                  <td className="px-3 py-1.5 font-black uppercase tracking-widest text-slate-400 text-[9px]" style={{ color: '#d4a843' }}>{t.docId}:</td>
                  <td className={`px-3 py-1.5 font-mono font-black text-cat-black ${isRtl ? 'text-left' : 'text-right'}`}>{config.quoteId}</td>
                </tr>
                <tr>
                  <td className="px-3 py-1.5 font-black uppercase tracking-widest text-[9px]" style={{ color: '#d4a843' }}>{t.issueDate}:</td>
                  <td className={`px-3 py-1.5 font-mono font-black text-cat-black ${isRtl ? 'text-left' : 'text-right'}`}>{new Date().toLocaleDateString()}</td>
                </tr>
                <tr>
                  <td className="px-3 py-1.5 font-black uppercase tracking-widest text-[9px]" style={{ color: '#d4a843' }}>{t.validUntil}:</td>
                  <td className={`px-3 py-1.5 font-mono font-black text-cat-black ${isRtl ? 'text-left' : 'text-right'}`}>{config.expirationDate}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Address Identity Blocks */}
        <div className="grid grid-cols-2 print:flex print:flex-row gap-8 mb-16 print:mb-6">
           <AddressBlock title={t.billTo} client={client} lang={lang} />
           <AddressBlock title={t.shipTo} client={client} isShipping={true} lang={lang} />
        </div>

        {/* Line Items Grid - Strict colgroup for vertical alignment stability */}
        <table className="w-full border-collapse table-fixed mb-16 print:mb-6">
          <colgroup>
            <col style={{ width: '6%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '40%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <thead>
            <tr className="bg-cat-black text-cat-yellow">
              <th className={`px-5 py-4 ${isRtl ? 'last:rounded-l-2xl' : 'first:rounded-l-2xl'} print:rounded-none text-[10px] font-black uppercase tracking-[0.15em]`}>{t.line}</th>
              <th className="px-5 py-4 text-[10px] font-black uppercase tracking-[0.15em]">{t.partNo}</th>
              <th className="px-5 py-4 text-[10px] font-black uppercase tracking-[0.15em]">{t.description}</th>
              <th className="px-5 py-4 num-col text-[10px] font-black uppercase tracking-[0.15em]">{t.qty}</th>
              <th className="px-5 py-4 num-col text-[10px] font-black uppercase tracking-[0.15em]">{t.unitVal}</th>
              <th className={`px-5 py-4 num-col ${isRtl ? 'first:rounded-r-2xl' : 'last:rounded-r-2xl'} print:rounded-none text-[10px] font-black uppercase tracking-[0.15em]`}>{t.extVal}</th>
            </tr>
          </thead>
          <tbody>
            {markedItems.map((item, idx) => {
              return (
                <tr key={idx} className="border-b border-slate-100 print:border-slate-200 hover:bg-slate-50/80 transition-colors duration-300">
                  <td className="px-5 py-6 text-slate-400 font-mono text-[12px] vertical-top print:text-black pt-7">{(idx + 1).toString().padStart(2, '0')}</td>
                  <td className="px-5 py-6 vertical-top pt-7">
                    <div className="font-black text-cat-black text-[14px] uppercase mb-1.5 tracking-tight">{item.partNo}</div>
                    {item.weight > 0 && (
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] print:text-slate-600">
                        {item.weight.toLocaleString()} {config.weightUnit}
                      </div>
                    )}
                    {(item.coreDeposit || 0) > 0 && (
                      <div className="text-[10px] font-black text-amber-600 uppercase tracking-[0.15em] print:text-amber-700 mt-2 bg-amber-50 px-2 py-1 rounded-md inline-block border border-amber-100">
                        {t.core}: ${formatCurrency(item.coreDeposit!)}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-6 vertical-top">
                    <div className={`flex gap-5 w-full ${isRtl ? 'flex-row-reverse' : ''}`}>
                      {config.photoMode !== PhotoMode.NONE && (
                        <div className="w-20 h-20 bg-white border border-slate-200/80 rounded-2xl overflow-hidden flex-shrink-0 shadow-sm part-img-container print:mr-2 print:shadow-none print:rounded-none transition-transform hover:scale-105 hover:shadow-md">
                          <PartImage 
                            partNo={item.partNo} 
                            photoMode={config.photoMode} 
                            originalImages={item.originalImages || []}
                            aiImageUrl={item.aiImageUrl}
                            isGenerating={isGeneratingImages}
                          />
                        </div>
                      )}
                      <div className={`flex-grow min-w-0 pt-1 ${isRtl ? 'text-right' : 'text-left'}`}>
                        <div className="font-black text-slate-800 text-[13px] uppercase leading-snug line-item-desc print:text-black tracking-tight">
                          {item.desc}
                        </div>
                        {item.notes && <p className="text-[11px] text-slate-400 font-bold uppercase mt-1.5 line-item-notes print:text-slate-600 tracking-tight">{item.notes}</p>}
                        {item.availability && (
                           <span className="inline-block mt-2.5 px-3 py-1 bg-slate-100 text-cat-black text-[9px] font-black uppercase rounded-full print:bg-white print:border print:border-slate-200 tracking-[0.15em]">{t.status}: {item.availability}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-6 num-col font-black text-cat-black text-[13px] vertical-top pt-7">{item.qty}</td>
                  <td className="px-5 py-6 num-col font-mono text-slate-500 font-bold text-[12px] vertical-top pt-7 print:text-black">${formatCurrency(item.sellPrice)}</td>
                  <td className="px-5 py-6 num-col font-mono font-black text-cat-black text-[14px] vertical-top pt-7">${formatCurrency(item.extPrice)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Financial Summary & AI Insights */}
        <div className="grid grid-cols-12 gap-12 totals-container mt-12">
          <div className="col-span-7 print:w-[58%]">
            {aiAnalysis && (
              <div className="bg-slate-50/80 p-8 rounded-[2rem] border-l-[6px] border-l-cat-yellow print:p-3 print:bg-white print:border print:border-slate-200 print:rounded-lg ai-analysis-box shadow-sm mb-8">
                <div className={`flex items-center gap-4 mb-5 print:mb-1 ${isRtl ? 'flex-row-reverse' : ''}`}>
                  <div className="w-12 h-12 bg-cat-black rounded-2xl flex items-center justify-center text-cat-yellow shadow-lg print:w-5 print:h-5 print:shadow-none print:rounded-md">
                    <svg className={`w-6 h-6 print:w-3 print:h-3 ${isRtl ? 'scale-x-[-1]' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                  </div>
                  <h4 className={`text-[12px] font-black uppercase tracking-[0.2em] text-cat-black ${isRtl ? 'text-right' : 'text-left'}`}>{t.aiAnalysisTitle}</h4>
                </div>
                <p className={`text-[12px] text-slate-700 font-bold leading-relaxed italic uppercase print:text-black ${isRtl ? 'text-right' : 'text-left'}`}>
                  "{aiAnalysis}"
                </p>
                {audioDataUrl && (
                    <div className={`mt-6 pt-5 border-t border-slate-200/80 print:mt-2 print:pt-2 print:border-slate-300 flex ${isRtl ? 'justify-end' : 'justify-start'}`}>
                      <a 
                        href={audioDataUrl} 
                        download={`AI-Briefing-${config.quoteId}.mp3`} 
                        className="inline-flex items-center gap-3 px-6 py-3 bg-cat-black text-cat-yellow rounded-xl text-[10px] font-black uppercase tracking-[0.2em] no-underline shadow-lg hover:bg-cat-dark hover:-translate-y-0.5 transition-all duration-300"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V3"></path></svg>
                        {t.downloadBrief}
                      </a>
                    </div>
                )}
              </div>
            )}

            <div className="space-y-4 print:mt-4 terms-box">
               <div className={`text-[11px] text-slate-400 uppercase font-black tracking-[0.2em] print:text-black ${isRtl ? 'mr-2 text-right' : 'ml-2 text-left'}`}>{t.terms}</div>
               <p className={`text-[8px] text-slate-500 leading-relaxed uppercase font-bold print:text-black bg-slate-50/80 p-8 print:p-3 rounded-[2rem] print:rounded-lg border border-slate-200/60 shadow-sm print:shadow-none ${isRtl ? 'text-right' : 'text-left'}`}>
                  {config.specialInstructions || defaultTerms[lang]}
               </p>
            </div>
          </div>

          <div className="col-span-5 print:w-[42%]">
            <div className="bg-slate-50/80 p-8 rounded-[2rem] border border-slate-200/60 shadow-sm">
              <table className="w-full summary-table">
                  <tbody className="space-y-3">
                      <tr className="text-[11px] print:text-[7pt]">
                          <td className={`py-2 uppercase tracking-[0.15em] font-black text-slate-400 print:text-slate-700 ${isRtl ? 'text-right' : 'text-left'}`}>{t.manifestSubtotal}</td>
                          <td className={`py-2 font-mono font-black text-cat-black ${isRtl ? 'text-left' : 'num-col'}`}>{`$${formatCurrency(subtotal)}`}</td>
                      </tr>
                       <tr>
                          <td colSpan={2} className="py-4">
                             <div className={`text-[12px] text-cat-black font-black bg-white px-5 py-3 rounded-xl border border-slate-200/80 mb-1 print:text-[8pt] flex justify-between shadow-sm ${isRtl ? 'flex-row-reverse' : ''}`}>
                               <span className="tracking-[0.2em]">{t.totalWeight}</span>
                               <span className="font-mono">{`${totalWeight.toLocaleString()} ${config.weightUnit}`}</span>
                             </div>
                          </td>
                      </tr>
                      <tr className="text-[11px] print:text-[7pt]">
                          <td className={`py-2 uppercase tracking-[0.15em] font-black text-slate-400 print:text-slate-700 ${isRtl ? 'text-right' : 'text-left'}`}>{t.freightFactor}</td>
                          <td className={`py-2 font-mono font-black text-cat-black ${isRtl ? 'text-left' : 'num-col'}`}>{`$${formatCurrency(logistics)}`}</td>
                      </tr>
                      {discount > 0 && (
                          <tr className="text-[11px] print:text-[7pt]">
                              <td className={`py-2 uppercase tracking-[0.15em] font-black text-slate-400 print:text-slate-700 ${isRtl ? 'text-right' : 'text-left'}`}>{`${t.loyaltyDiscount} (${config.discountPercentage}%)`}</td>
                              <td className={`py-2 font-mono font-black text-cat-black ${isRtl ? 'text-left' : 'num-col'}`}>{`-$${formatCurrency(discount)}`}</td>
                          </tr>
                      )}
                      {creditOrRefund > 0 && (
                          <tr className="text-[11px] print:text-[7pt]">
                              <td className={`py-2 uppercase tracking-[0.15em] font-black text-slate-400 print:text-slate-700 ${isRtl ? 'text-right' : 'text-left'}`}>{t.credit}</td>
                              <td className={`py-2 font-mono font-black text-cat-black ${isRtl ? 'text-left' : 'num-col'}`}>{`-$${formatCurrency(creditOrRefund)}`}</td>
                          </tr>
                      )}
                      {totalCoreDeposits > 0 && (
                          <tr className="text-[11px] print:text-[7pt]">
                              <td className={`py-2 uppercase tracking-[0.15em] font-black text-slate-400 print:text-slate-700 ${isRtl ? 'text-right' : 'text-left'}`}>{t.totalCore}</td>
                              <td className={`py-2 font-mono font-black text-cat-black ${isRtl ? 'text-left' : 'num-col'}`}>{`$${formatCurrency(totalCoreDeposits)}`}</td>
                          </tr>
                      )}
                      <tr className="text-2xl print:text-[10pt] print:break-inside-avoid">
                          <td className={`pt-6 border-t-[6px] border-cat-black uppercase tracking-tighter font-black text-cat-black ${isRtl ? 'text-right' : 'text-left'}`}>{t.totalDocValue}</td>
                          <td className={`pt-6 border-t-[6px] border-cat-black font-mono font-black text-cat-black ${isRtl ? 'text-left' : 'num-col'}`}>{`$${formatCurrency(total)}`}</td>
                      </tr>
                  </tbody>
              </table>
            </div>
             
             <div className="mt-8 p-8 bg-cat-black rounded-[2rem] text-cat-yellow print:p-3 print:mt-3 shadow-[0_15px_40px_rgba(0,0,0,0.15)] print:shadow-none print:border print:border-black print:rounded-lg relative overflow-hidden">
                <div className="absolute -right-10 -top-10 w-32 h-32 bg-white/5 rounded-full blur-2xl"></div>
                <p className={`text-[10px] font-black uppercase tracking-[0.4em] opacity-60 mb-3 print:opacity-100 relative z-10 ${isRtl ? 'text-right' : 'text-left'}`}>{t.commercialTerms}</p>
                <p className={`text-[15px] font-black uppercase tracking-widest relative z-10 ${isRtl ? 'text-right' : 'text-left'}`}>{config.paymentTerms || "NET 30 DAYS"}</p>
             </div>
          </div>
        </div>
      </div>
      <div className="print-footer">
        <p>{t.address}</p>
        <p>{t.tel}</p>
        <p>{t.website}</p>
      </div>
    </div>
  );
};
