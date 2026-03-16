
import * as XLSX from 'xlsx';
import { InventoryPart, InvoiceData, SavedQuote, CustomerAccount } from '../types';

export const exportToExcel = (data: any[], fileName: string, sheetName: string = 'Data') => {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
};

export const exportToCSV = (data: any[], fileName: string) => {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(worksheet);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${fileName}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

export const exportInventory = (inventory: InventoryPart[], format: 'excel' | 'csv') => {
  const data = inventory.map(item => ({
    'ID': item.id,
    'Part Number': item.partNo,
    'Description': item.description,
    'Original Price': item.originalPrice,
  }));
  
  if (format === 'excel') {
    exportToExcel(data, 'Inventory_Export', 'Inventory');
  } else {
    exportToCSV(data, 'Inventory_Export');
  }
};

export const exportInvoices = (invoices: InvoiceData[], format: 'excel' | 'csv') => {
  const data = invoices.map(invoice => ({
    'Invoice ID': invoice.id,
    'Date': invoice.date,
    'Due Date': invoice.dueDate,
    'Client ID': invoice.clientId,
    'Status': invoice.status,
    'Total': invoice.total,
    'Discount': invoice.discount,
    'Tax Rate': invoice.taxRate,
    'Notes': invoice.notes,
  }));

  if (format === 'excel') {
    exportToExcel(data, 'Invoices_Export', 'Invoices');
  } else {
    exportToCSV(data, 'Invoices_Export');
  }
};

export const exportQuotes = (quotes: SavedQuote[], format: 'excel' | 'csv') => {
  const data = quotes.map(quote => ({
    'Quote ID': quote.id,
    'Timestamp': quote.timestamp,
    'Author': quote.author,
    'Title': quote.title,
    'Total': quote.total,
    'Client Company': quote.payload.client.company,
    'Client Email': quote.payload.client.email,
  }));

  if (format === 'excel') {
    exportToExcel(data, 'Quotes_Export', 'Quotes');
  } else {
    exportToCSV(data, 'Quotes_Export');
  }
};

export const exportContacts = (contacts: CustomerAccount[], format: 'excel' | 'csv', customFileName?: string) => {
  const data = contacts.map(contact => ({
    'Account Number': contact.accountNumber,
    'Company': contact.company,
    'Contact Name': contact.contactName,
    'Email': contact.email,
    'Phone': contact.phone,
    'Billing Address': `${contact.billingAddress}, ${contact.billingCity}, ${contact.billingState} ${contact.billingZip}, ${contact.billingCountry}`,
    'Shipping Address': `${contact.shippingAddress}, ${contact.shippingCity}, ${contact.shippingState} ${contact.shippingZip}, ${contact.shippingCountry}`,
    'Internal Notes': contact.internalNotes || '',
  }));

  const fileName = customFileName || 'Contacts_Export';

  if (format === 'excel') {
    exportToExcel(data, fileName, 'Contacts');
  } else {
    exportToCSV(data, fileName);
  }
};
