/**
 * Activity Bridge — neutered (C-4)
 *
 * Previously POSTed every quote, invoice, customer, payment, and inventory
 * event to https://iron-hub-suite.replit.app with a hardcoded shipped-in-JS
 * `X-API-Key` header. Both the destination service and the key were
 * publicly known, so this was a continuous PII/business-data exfil risk.
 *
 * All exported methods are now no-ops that match the original signatures so
 * existing call sites in App.tsx keep compiling and rendering. To re-enable
 * the bridge later, route through an authenticated POST /api/crm/sync on
 * iron-hub-api (Round 3+) and never let a session-bound secret reach the
 * browser.
 */

const noop = (..._args: unknown[]): void => {};

export const activityBridge = {
  init: noop,
  // Quoting
  quoteCreated: noop,
  quoteSaved: noop,
  quoteSentEmail: noop,
  quoteWhatsApp: noop,
  quotePrinted: noop,
  // Invoicing
  invoiceCreated: noop,
  invoiceConverted: noop,
  // Customers
  customerAdded: noop,
  customerUpdated: noop,
  customerDeleted: noop,
  // Payments
  paymentRecorded: noop,
  // Inventory
  inventoryUpdated: noop,
  inventoryImported: noop,
  // Data Operations
  dataImported: noop,
  dataExported: noop,
  cloudSynced: noop,
  // AI Analysis
  analysisGenerated: noop,
};
