import { AppConfig, InvoiceData, QuoteItem } from '../types.ts';
import { calculateQuoteFinancials } from './documentMath.ts';

const money = (value: number): string => Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const normalizeWhatsAppPhone = (value: string): string => value.replace(/[^0-9+]/g, '').replace(/^\+/, '');

export const whatsAppSendUrl = (phone: string, message: string): string => (
  `https://api.whatsapp.com/send/?phone=${encodeURIComponent(normalizeWhatsAppPhone(phone))}&text=${encodeURIComponent(message)}&type=phone_number&app_absent=0`
);

export const quoteWhatsAppMessage = (
  items: QuoteItem[],
  config: AppConfig,
  customerName: string,
): string => {
  const financials = calculateQuoteFinancials(items, config);
  const lines = financials.markedItems.map((item) => (
    `${item.qty} x ${item.partNo || item.desc} @ $${money(item.sellPrice)} = $${money(item.extPrice)}`
  ));
  return [
    `Quote ${config.quoteId}`,
    `Customer: ${customerName || 'N/A'}`,
    '',
    'Quoted prices:',
    ...lines,
    '',
    `Total: $${money(financials.total)}`,
  ].join('\n');
};

export const invoiceWhatsAppMessage = (
  invoice: InvoiceData,
  customerName: string,
  paymentUrl?: string | null,
): string => {
  const lines = invoice.items.map((item) => {
    const quantity = Math.max(0, Number(item.hours) || 0);
    const rate = Math.max(0, Number(item.rate) || 0);
    return `${quantity} x ${item.description || item.id} @ $${money(rate)} = $${money(quantity * rate)}`;
  });
  return [
    `Invoice ${invoice.id}`,
    `Customer: ${customerName || 'N/A'}`,
    '',
    'Invoice prices:',
    ...lines,
    '',
    `Total: $${money(invoice.total)}`,
    ...(paymentUrl ? ['', `Secure payment: ${paymentUrl}`] : []),
  ].join('\n');
};
