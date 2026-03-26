
import * as XLSX from 'xlsx';
import { InventoryPart, InvoiceData, SavedQuote, CustomerAccount, Payment } from '../types';

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

// =====================================================================
// IronSuite Data Import Center — CSV Export Functions
// Column headers match IronSuite's expected import format exactly.
// =====================================================================

/**
 * Export inventory for IronSuite "Inventory Items" import.
 * Columns: SKU / Part Number, Description, Category, Type, Brand, Model,
 *          Condition, Unit Price ($), Cost Price ($), Quantity on Hand,
 *          Reorder Point, Weight, Dimensions, Unit of Measure
 */
export const exportInventoryForIronSuite = (inventory: InventoryPart[]) => {
  const data = inventory.map(item => ({
    'SKU / Part Number': item.partNo || item.id || '',
    'Description': item.description || '',
    'Category': 'Heavy Equipment Parts',
    'Type': 'Product',
    'Brand': '',
    'Model': '',
    'Condition': 'Used',
    'Unit Price ($)': item.originalPrice || 0,
    'Cost Price ($)': item.originalPrice || 0,
    'Quantity on Hand': 1,
    'Reorder Point': 0,
    'Weight': '',
    'Dimensions': '',
    'Unit of Measure': 'Each',
  }));
  exportToCSV(data, 'IronSuite_Import_Inventory');
};

/**
 * Export accounts for IronSuite "Customer Organizations" import.
 * Columns: Organization Name, Email, Phone, Company, Address, City,
 *          State, ZIP Code, Type, Credit Limit ($), Balance ($), Notes
 */
export const exportCustomersForIronSuite = (accounts: CustomerAccount[]) => {
  const data = accounts.map(acct => ({
    'Organization Name': acct.company || 'Unnamed',
    'Email': acct.email || '',
    'Phone': acct.phone || '',
    'Company': acct.company || '',
    'Address': acct.billingAddress || '',
    'City': acct.billingCity || '',
    'State': acct.billingState || '',
    'ZIP Code': acct.billingZip || '',
    'Type': 'Customer',
    'Credit Limit ($)': '',
    'Balance ($)': '',
    'Notes': acct.internalNotes || '',
  }));
  exportToCSV(data, 'IronSuite_Import_Customers');
};

/**
 * Export accounts as CRM Contacts for IronSuite "CRM Contacts" import.
 * Columns: First Name, Last Name, Email, Phone, Mobile, Company,
 *          Job Title, Notes
 */
export const exportContactsForIronSuite = (accounts: CustomerAccount[]) => {
  const data = accounts.map(acct => {
    const nameParts = (acct.contactName || '').trim().split(/\s+/);
    const firstName = nameParts[0] || acct.company || 'Unknown';
    const lastName = nameParts.slice(1).join(' ') || '(Primary)';
    return {
      'First Name': firstName,
      'Last Name': lastName,
      'Email': acct.email || '',
      'Phone': acct.phone || '',
      'Mobile': acct.whatsapp || '',
      'Company': acct.company || '',
      'Job Title': '',
      'Notes': acct.internalNotes || '',
    };
  });
  exportToCSV(data, 'IronSuite_Import_CRM_Contacts');
};

/**
 * Export quotes for IronSuite "Past Quotes" import.
 * Each line item becomes its own row.
 * Columns: Quote Number, Customer Name, Customer ID, Issue Date,
 *          Valid Until, Line Description, Quantity, Unit Price ($),
 *          Subtotal ($), Total ($), Status, Notes
 */
export const exportQuotesForIronSuite = (quotes: SavedQuote[]) => {
  const rows: Record<string, any>[] = [];

  for (const quote of quotes) {
    const items = quote.payload?.items || [];
    const customerName = quote.payload?.client?.company || '';
    const issueDate = quote.timestamp
      ? new Date(quote.timestamp).toLocaleDateString('en-US')
      : '';
    const validUntil = quote.payload?.config?.expirationDate
      ? new Date(quote.payload.config.expirationDate).toLocaleDateString('en-US')
      : '';

    if (items.length === 0) {
      // Quote with no line items — still export the header
      rows.push({
        'Quote Number': quote.id || '',
        'Customer Name': customerName,
        'Customer ID': '',
        'Issue Date': issueDate,
        'Valid Until': validUntil,
        'Line Description': quote.title || '',
        'Quantity': 1,
        'Unit Price ($)': quote.total || 0,
        'Subtotal ($)': quote.total || 0,
        'Total ($)': quote.total || 0,
        'Status': 'Draft',
        'Notes': '',
      });
    } else {
      for (const item of items) {
        const lineTotal = (item.qty || 1) * (item.unitPrice || 0);
        rows.push({
          'Quote Number': quote.id || '',
          'Customer Name': customerName,
          'Customer ID': '',
          'Issue Date': issueDate,
          'Valid Until': validUntil,
          'Line Description': item.desc || item.partNo || '',
          'Quantity': item.qty || 1,
          'Unit Price ($)': item.unitPrice || 0,
          'Subtotal ($)': lineTotal,
          'Total ($)': quote.total || 0,
          'Status': 'Draft',
          'Notes': item.notes || '',
        });
      }
    }
  }

  exportToCSV(rows, 'IronSuite_Import_Quotes');
};

/**
 * Export invoices for IronSuite "Past Invoices" import.
 * Each line item becomes its own row.
 * Columns: Invoice Number, Customer Name, Customer ID, Issue Date,
 *          Due Date, Line Description, Quantity, Unit Price ($),
 *          Subtotal ($), Total ($), Amount Paid ($), Status, Notes
 */
export const exportInvoicesForIronSuite = (
  invoices: InvoiceData[],
  accounts: CustomerAccount[],
  payments: Payment[]
) => {
  // Build lookup maps
  const accountMap = new Map<string, CustomerAccount>();
  for (const a of accounts) accountMap.set(a.id, a);

  const paidMap = new Map<string, number>();
  for (const p of payments) {
    paidMap.set(p.invoiceId, (paidMap.get(p.invoiceId) || 0) + p.amount);
  }

  const rows: Record<string, any>[] = [];

  for (const inv of invoices) {
    const customer = accountMap.get(inv.clientId);
    const customerName = customer?.company || inv.clientId || '';
    const issueDate = inv.date
      ? new Date(inv.date).toLocaleDateString('en-US')
      : '';
    const dueDate = inv.dueDate
      ? new Date(inv.dueDate).toLocaleDateString('en-US')
      : '';
    const amountPaid = paidMap.get(inv.id) || 0;

    const items = inv.items || [];
    if (items.length === 0) {
      rows.push({
        'Invoice Number': inv.id || '',
        'Customer Name': customerName,
        'Customer ID': inv.clientId || '',
        'Issue Date': issueDate,
        'Due Date': dueDate,
        'Line Description': 'Services',
        'Quantity': 1,
        'Unit Price ($)': inv.total || 0,
        'Subtotal ($)': inv.total || 0,
        'Total ($)': inv.total || 0,
        'Amount Paid ($)': amountPaid,
        'Status': inv.status || 'draft',
        'Notes': inv.notes || '',
      });
    } else {
      for (const item of items) {
        const lineTotal = (item.hours || 1) * (item.rate || 0);
        rows.push({
          'Invoice Number': inv.id || '',
          'Customer Name': customerName,
          'Customer ID': inv.clientId || '',
          'Issue Date': issueDate,
          'Due Date': dueDate,
          'Line Description': item.description || '',
          'Quantity': item.hours || 1,
          'Unit Price ($)': item.rate || 0,
          'Subtotal ($)': lineTotal,
          'Total ($)': inv.total || 0,
          'Amount Paid ($)': amountPaid,
          'Status': inv.status || 'draft',
          'Notes': inv.notes || '',
        });
      }
    }
  }

  exportToCSV(rows, 'IronSuite_Import_Invoices');
};
