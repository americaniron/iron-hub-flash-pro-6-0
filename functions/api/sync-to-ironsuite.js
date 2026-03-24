/**
 * Cloudflare Pages Function: Sync data from Iron Hub 6.0 → IronSuite (Replit)
 *
 * This proxy function receives data from the 6.0 frontend and pushes it
 * to the IronSuite Replit app's REST API endpoints.
 *
 * Flow:
 * 1. Frontend sends all IndexedDB data + IronSuite session cookie
 * 2. This function maps 6.0 data types → IronSuite API formats
 * 3. POSTs to each IronSuite endpoint with the session cookie
 * 4. Returns a summary of what was synced
 */

const IRONSUITE_BASE = 'https://iron-hub-suite.replit.app';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// --- Data Mappers: Convert 6.0 types → IronSuite API types ---

function mapAccountToCustomer(account) {
  return {
    name: account.company || 'Unnamed Account',
    email: account.email || '',
    phone: account.phone || '',
    contactName: account.contactName || '',
    accountNumber: account.accountNumber || '',
    billingAddress: {
      street: account.billingAddress || '',
      city: account.billingCity || '',
      state: account.billingState || '',
      zip: account.billingZip || '',
      country: account.billingCountry || 'US',
    },
    shippingAddress: {
      street: account.shippingAddress || account.billingAddress || '',
      city: account.shippingCity || account.billingCity || '',
      state: account.shippingState || account.billingState || '',
      zip: account.shippingZip || account.billingZip || '',
      country: account.shippingCountry || account.billingCountry || 'US',
    },
    notes: account.internalNotes || '',
    website: account.website || '',
    sourceSystem: 'iron-hub-6.0',
    sourceId: account.id || '',
  };
}

function mapQuoteToIronSuite(quote) {
  return {
    title: quote.title || `Quote ${quote.id}`,
    date: quote.timestamp || new Date().toISOString(),
    total: quote.total || 0,
    status: 'draft',
    customerName: quote.payload?.client?.company || '',
    customerEmail: quote.payload?.client?.email || '',
    items: (quote.payload?.items || []).map(item => ({
      partNumber: item.partNo || '',
      description: item.desc || '',
      quantity: item.qty || 1,
      unitPrice: item.unitCost || 0,
      weight: item.weight || 0,
      coreCharge: item.coreCharge || 0,
    })),
    config: {
      markup: quote.payload?.config?.markup || 25,
      discount: quote.payload?.config?.discount || 0,
      freightRate: quote.payload?.config?.logisticsRate || 2.5,
      paymentTerms: quote.payload?.config?.paymentTerms || 'Net 30',
    },
    aiAnalysis: quote.payload?.aiAnalysis || null,
    sourceSystem: 'iron-hub-6.0',
    sourceId: quote.id || '',
  };
}

function mapInvoiceToIronSuite(invoice) {
  return {
    date: invoice.date || new Date().toISOString(),
    dueDate: invoice.dueDate || '',
    clientId: invoice.clientId || '',
    status: invoice.status || 'draft',
    total: invoice.total || 0,
    taxRate: invoice.taxRate || 0,
    discount: invoice.discount || 0,
    notes: invoice.notes || '',
    items: (invoice.items || []).map(item => ({
      description: item.description || item.desc || '',
      quantity: item.quantity || item.qty || 1,
      rate: item.rate || item.unitCost || 0,
      amount: item.amount || 0,
    })),
    sourceSystem: 'iron-hub-6.0',
    sourceId: invoice.id || '',
  };
}

function mapPaymentToIronSuite(payment) {
  return {
    invoiceId: payment.invoiceId || '',
    clientId: payment.clientId || '',
    date: payment.date || new Date().toISOString(),
    amount: payment.amount || 0,
    method: payment.method || 'Other',
    sourceSystem: 'iron-hub-6.0',
    sourceId: payment.id || '',
  };
}

function mapInventoryItem(part) {
  return {
    sku: part.id || '',
    partNumber: part.partNo || '',
    name: part.description || '',
    description: part.description || '',
    cost: part.originalPrice || 0,
    quantity: 1,
    category: 'Heavy Equipment Parts',
    sourceSystem: 'iron-hub-6.0',
    sourceId: part.id || '',
  };
}

// --- Push data to a single IronSuite endpoint ---

async function pushToIronSuite(endpoint, items, sessionCookie, mapper) {
  const results = { success: 0, failed: 0, errors: [] };

  for (const item of items) {
    try {
      const mapped = mapper(item);
      const response = await fetch(`${IRONSUITE_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': sessionCookie,
        },
        body: JSON.stringify(mapped),
      });

      if (response.ok) {
        results.success++;
      } else {
        const errText = await response.text().catch(() => 'Unknown error');
        results.failed++;
        results.errors.push(`${endpoint}: ${response.status} - ${errText.substring(0, 100)}`);
      }
    } catch (err) {
      results.failed++;
      results.errors.push(`${endpoint}: ${err.message}`);
    }
  }

  return results;
}

// --- Main handler ---

export async function onRequestPost(context) {
  try {
    const data = await context.request.json();
    const { sessionCookie, syncData } = data;

    if (!sessionCookie) {
      return new Response(JSON.stringify({
        error: 'Missing IronSuite session. Please log in to IronSuite first.'
      }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (!syncData || typeof syncData !== 'object') {
      return new Response(JSON.stringify({
        error: 'No data provided for sync.'
      }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // First, verify the session is valid
    const authCheck = await fetch(`${IRONSUITE_BASE}/api/auth/me`, {
      headers: { 'Cookie': sessionCookie, 'Accept': 'application/json' },
    });

    if (!authCheck.ok) {
      return new Response(JSON.stringify({
        error: 'IronSuite session expired or invalid. Please log in again.'
      }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const authUser = await authCheck.json().catch(() => null);

    // Sync each data type
    const syncResults = {
      user: authUser?.username || authUser?.email || 'unknown',
      timestamp: new Date().toISOString(),
      results: {},
    };

    // 1. Sync Accounts → Customers
    if (syncData.accounts?.length > 0) {
      syncResults.results.customers = await pushToIronSuite(
        '/api/customers', syncData.accounts, sessionCookie, mapAccountToCustomer
      );
    }

    // 2. Sync Quotes
    if (syncData.quotes?.length > 0) {
      syncResults.results.quotes = await pushToIronSuite(
        '/api/quotes', syncData.quotes, sessionCookie, mapQuoteToIronSuite
      );
    }

    // 3. Sync Invoices
    if (syncData.invoices?.length > 0) {
      syncResults.results.invoices = await pushToIronSuite(
        '/api/invoices', syncData.invoices, sessionCookie, mapInvoiceToIronSuite
      );
    }

    // 4. Sync Payments
    if (syncData.payments?.length > 0) {
      syncResults.results.payments = await pushToIronSuite(
        '/api/payments', syncData.payments, sessionCookie, mapPaymentToIronSuite
      );
    }

    // 5. Sync Inventory → Items
    if (syncData.inventory?.length > 0) {
      syncResults.results.items = await pushToIronSuite(
        '/api/items', syncData.inventory, sessionCookie, mapInventoryItem
      );
    }

    // Calculate totals
    let totalSuccess = 0, totalFailed = 0;
    for (const r of Object.values(syncResults.results)) {
      totalSuccess += r.success;
      totalFailed += r.failed;
    }
    syncResults.totalSynced = totalSuccess;
    syncResults.totalFailed = totalFailed;

    return new Response(JSON.stringify(syncResults), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: `Sync failed: ${err.message}`
    }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}
