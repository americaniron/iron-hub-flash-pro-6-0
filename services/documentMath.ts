import { AppConfig, QuoteItem } from '../types.ts';

export type QuoteFinancials = {
  markedItems: Array<QuoteItem & { sellPrice: number; extPrice: number }>;
  subtotal: number;
  totalWeight: number;
  totalCoreDeposits: number;
  logistics: number;
  discount: number;
  creditOrRefund: number;
  total: number;
};

const money = (value: number): number => Math.round(value * 100) / 100;

export function calculateQuoteFinancials(items: QuoteItem[], config: AppConfig): QuoteFinancials {
  const markupFactor = 1 + (Number(config.markupPercentage) || 0) / 100;
  const markedItems = items.map((item) => {
    const sellPrice = money((Number(item.unitPrice) || 0) * markupFactor);
    const quantity = Math.max(0, Number(item.qty) || 0);
    return { ...item, sellPrice, extPrice: money(sellPrice * quantity) };
  });
  const subtotal = money(markedItems.reduce((sum, item) => sum + item.extPrice, 0));
  const totalWeight = markedItems.reduce((sum, item) => sum + (Math.max(0, Number(item.qty) || 0) * Math.max(0, Number(item.weight) || 0)), 0);
  const totalCoreDeposits = money(markedItems.reduce((sum, item) => sum + (Math.max(0, Number(item.qty) || 0) * Math.max(0, Number(item.coreDeposit) || 0)), 0));
  const logistics = money(totalWeight * Math.max(0, Number(config.logisticsRate) || 0));
  const discount = money(subtotal * Math.max(0, Math.min(100, Number(config.discountPercentage) || 0)) / 100);
  const creditOrRefund = Math.max(0, Number(config.creditOrRefund) || 0);
  const total = money(subtotal + logistics - discount - creditOrRefund + totalCoreDeposits);
  return { markedItems, subtotal, totalWeight, totalCoreDeposits, logistics, discount, creditOrRefund, total };
}
