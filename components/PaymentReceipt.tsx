
import React from 'react';
import { Payment, CustomerAccount, InvoiceData } from '../types.ts';
import { Logo } from './Logo.tsx';

interface PaymentReceiptProps {
  payment: Payment;
  account: CustomerAccount;
  invoice?: InvoiceData;
}

export const PaymentReceipt: React.FC<PaymentReceiptProps> = ({ payment, account, invoice }) => {
  return (
    <div className="bg-white p-16 font-sans printable-receipt rounded-[3rem] shadow-3xl border-t-[10px] border-t-cat-yellow max-w-[900px] mx-auto my-12 print:my-0 print:shadow-none print:rounded-none">
      {/* Print styles */}
      <style>{`
        .print-footer { display: none; }
        @media print {
          @page { size: LETTER; margin: 0.5in 0.5in 0.85in 0.5in; }
          body * { visibility: hidden; }
          .printable-receipt, .printable-receipt * { visibility: visible; }
          .print-footer, .print-footer * { visibility: visible; }
          .printable-receipt {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
              margin: 0;
              padding: 0.5in;
              border: none;
              box-shadow: none;
              font-size: 10pt;
              padding-bottom: 0.85in !important;
          }
          .receipt-header { break-inside: avoid !important; page-break-inside: avoid !important; }
          .receipt-header h2 {
             font-size: 22pt !important;
             color: #000 !important;
          }
          /* Repeat headers, never split rows */
          table { width: 100% !important; border-collapse: collapse !important; }
          thead { display: table-header-group !important; }
          tfoot { display: table-footer-group !important; }
          tr, td, th { break-inside: avoid !important; page-break-inside: avoid !important; }
          /* Receipts are short — protect the summary block too */
          .grid.grid-cols-2 { display: flex !important; flex-direction: row !important; gap: 0.25in !important; }
          .grid.grid-cols-2 > * { flex: 1 !important; break-inside: avoid !important; page-break-inside: avoid !important; }
          .print-footer {
            display: block !important;
            position: fixed;
            bottom: 0.25in;
            left: 0.5in;
            right: 0.5in;
            text-align: center;
            font-size: 8pt !important;
            color: #6c757d !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .print-footer p {
            margin: 0;
            line-height: 1.2;
          }
        }
      `}</style>
      
      {/* Header */}
      <div className="flex justify-between items-start pb-12 border-b-2 border-slate-100 receipt-header">
        <div className="flex items-center gap-8">
          <div className="w-24 h-24 bg-white rounded-3xl flex items-center justify-center p-4 shadow-2xl shadow-slate-200/50 border border-slate-100 print:w-32 print:h-32 print:shadow-none print:rounded-none">
            <Logo className="w-full h-full" />
          </div>
          <div>
            <h2 className="text-3xl font-black uppercase tracking-tighter text-cat-black">American Iron LLC</h2>
            <div className="text-[9px] text-slate-400 mt-3 uppercase font-black tracking-[0.3em] leading-relaxed">
              <p>13930 N. Dale Mabry HWY. Site 5. Tampa, FL. 33618</p>
              <p>Tel (850) 777-3797  Fax. (813) 249-9730</p>
              <p className="text-cat-yellow">www.AmericanIronUS.com</p>
            </div>
          </div>
        </div>
        <div className="text-right">
          <h1 className="text-7xl font-black text-slate-100 uppercase tracking-tighter -mb-2 opacity-10 select-none">Receipt</h1>
          <div className="space-y-1.5 relative z-10">
            <p className="text-xs font-black uppercase text-slate-400">Receipt ID: <span className="text-cat-black font-mono ml-2 font-black">{payment.id}</span></p>
            <p className="text-xs font-black uppercase text-slate-400">Payment Date: <span className="text-cat-black font-mono ml-2 font-black">{payment.date}</span></p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="grid grid-cols-2 gap-12 mt-12">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-4">
            <span className="bg-slate-100 px-2 py-0.5 rounded-full">Received From</span>
          </h3>
          <p className="font-black text-cat-black text-xl uppercase tracking-tight">{account.company}</p>
          <div className="text-slate-600 text-[11px] mt-2 leading-relaxed uppercase font-bold">
            {account.billingAddress}<br />
            {account.billingCity}, {account.billingState} {account.billingZip}
          </div>
        </div>
        <div className="bg-slate-50 p-8 rounded-3xl border border-slate-200 shadow-inner">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-4">Payment Summary</h3>
            <div className="space-y-4">
                <div className="flex justify-between items-end py-2 border-b border-slate-200">
                    <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Method</span>
                    <span className="font-mono font-black text-cat-black uppercase">{payment.method}</span>
                </div>
                <div className="flex justify-between items-end pt-4">
                    <span className="text-xs uppercase font-black text-cat-black tracking-widest">Amount Paid</span>
                    <span className="font-mono font-black text-3xl text-cat-black">${payment.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
            </div>
        </div>
      </div>
      
      {/* Line Items */}
      <div className="mt-16">
        <table className="w-full border-collapse">
            <thead>
                <tr className="bg-cat-black text-cat-yellow">
                    <th className="p-4 text-left text-[10px] font-black uppercase tracking-[0.3em] rounded-l-2xl">Description</th>
                    <th className="p-4 text-right text-[10px] font-black uppercase tracking-[0.3em] rounded-r-2xl">Amount</th>
                </tr>
            </thead>
            <tbody>
                <tr className="border-b border-slate-100">
                    <td className="p-6">
                        <p className="font-black text-base text-slate-800 uppercase tracking-tight">Payment for Invoice #{payment.invoiceId}</p>
                        {invoice && <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">Invoice Date: {invoice.date}</p>}
                    </td>
                    <td className="p-6 text-right font-mono font-black text-lg text-slate-800">${payment.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
            </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="mt-20 pt-12 border-t-2 border-slate-100 text-center">
        <h3 className="text-3xl font-black text-cat-black uppercase tracking-tighter">Transaction Verified</h3>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-3 max-w-md mx-auto leading-relaxed">If you have any questions about this receipt, please contact our accounts department for immediate assistance.</p>
        <div className="mt-8 flex justify-center gap-4">
            <div className="w-3 h-3 bg-cat-yellow rounded-full shadow-[0_0_10px_rgba(255,205,0,0.5)]"></div>
            <div className="w-3 h-3 bg-cat-yellow rounded-full opacity-40"></div>
            <div className="w-3 h-3 bg-cat-yellow rounded-full opacity-20"></div>
        </div>
      </div>

      <div className="print-footer">
        <p>13930 N. DALE MABRY HWY. SITE 5. TAMPA, FL. 33618</p>
        <p>TEL (850) 777-3797 FAX. (813) 249-9730</p>
        <p>WWW.AMERICANIRONUS.COM</p>
      </div>
    </div>
  );
};
