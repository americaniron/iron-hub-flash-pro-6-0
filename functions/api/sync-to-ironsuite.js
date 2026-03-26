/**
 * Cloudflare Pages Function: Sync data from Iron Hub 6.0 → IronSuite (Replit)
 *
 * Handles login + data sync in a SINGLE request to avoid cookie extraction issues.
 * The frontend sends username/password + data batch, and this proxy:
 * 1. Logs in to IronSuite, captures the session cookie server-side
 * 2. Pushes the data batch using that cookie
 * 3. Returns sync results
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

// --- Extract session cookie from a fetch Response ---
function extractCookies(response) {
  let cookies = [];

  // Method 1: getSetCookie (Cloudflare Workers)
  try {
    if (response.headers.getSetCookie) {
      cookies = response.headers.getSetCookie();
    }
  } catch (e) {}

  // Method 2: get('set-cookie') fallback
  if (cookies.length === 0) {
    const raw = response.headers.get('set-cookie');
    if (raw) {
      cookies = raw.split(/,(?=\s*\w+=)/);
    }
  }

  return cookies
    .map(c => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

// --- Data Mappers ---

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

// --- Push data to IronSuite (parallel, 5 at a time) ---

async function pushToIronSuite(endpoint, items, cookieString, mapper) {
  const results = { success: 0, failed: 0, errors: [] };
  const CONCURRENCY = 5;

  // Process items in parallel groups of CONCURRENCY
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY);
    const promises = chunk.map(async (item) => {
      try {
        const mapped = mapper(item);
        const response = await fetch(`${IRONSUITE_BASE}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': cookieString,
          },
          body: JSON.stringify(mapped),
        });

        if (response.ok) {
          return { ok: true };
        } else {
          const errText = await response.text().catch(() => '');
          return { ok: false, error: `${response.status} - ${errText.substring(0, 80)}` };
        }
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });

    const settled = await Promise.all(promises);
    for (const r of settled) {
      if (r.ok) {
        results.success++;
      } else {
        results.failed++;
        if (results.errors.length < 3) {
          results.errors.push(`${endpoint}: ${r.error}`);
        }
      }
    }
  }

  return results;
}

// --- Main handler ---

export async function onRequestPost(context) {
  try {
    const data = await context.request.json();
    const { username, password, syncData } = data;

    if (!username || !password) {
      return new Response(JSON.stringify({
        error: 'Missing username or password. Please enter your IronSuite credentials.'
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

    // Step 1: Login to IronSuite and capture the session cookie
    const loginResponse = await fetch(`${IRONSUITE_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      redirect: 'manual',
    });

    if (!loginResponse.ok && loginResponse.status !== 302 && loginResponse.status !== 301) {
      const errBody = await loginResponse.text().catch(() => '');
      let errMsg = 'Login failed';
      try { errMsg = JSON.parse(errBody).message || errMsg; } catch (e) {}
      return new Response(JSON.stringify({
        error: `IronSuite login failed: ${errMsg}`,
        debug: { status: loginResponse.status }
      }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const cookieString = extractCookies(loginResponse);

    // Step 2: Verify the session works
    const authCheck = await fetch(`${IRONSUITE_BASE}/api/auth/me`, {
      headers: { 'Cookie': cookieString, 'Accept': 'application/json' },
    });

    if (!authCheck.ok) {
      // Cookie extraction might have failed — return diagnostic info
      return new Response(JSON.stringify({
        error: 'Login succeeded but session cookie could not be used. Cookie extraction may have failed.',
        debug: {
          loginStatus: loginResponse.status,
          cookieLength: cookieString.length,
          cookieEmpty: cookieString === '',
          authMeStatus: authCheck.status,
          authMeBody: (await authCheck.text().catch(() => '')).substring(0, 200),
        }
      }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const authUser = await authCheck.json().catch(() => null);

    // Step 3: Sync each data type
    const syncResults = {
      user: authUser?.username || authUser?.email || 'unknown',
      timestamp: new Date().toISOString(),
      results: {},
    };

    if (syncData.accounts?.length > 0) {
      syncResults.results.accounts = await pushToIronSuite(
        '/api/customers', syncData.accounts, cookieString, mapAccountToCustomer
      );
    }

    if (syncData.quotes?.length > 0) {
      syncResults.results.quotes = await pushToIronSuite(
        '/api/quotes', syncData.quotes, cookieString, mapQuoteToIronSuite
      );
    }

    if (syncData.invoices?.length > 0) {
      syncResults.results.invoices = await pushToIronSuite(
        '/api/invoices', syncData.invoices, cookieString, mapInvoiceToIronSuite
      );
    }

    if (syncData.payments?.length > 0) {
      syncResults.results.payments = await pushToIronSuite(
        '/api/payments', syncData.payments, cookieString, mapPaymentToIronSuite
      );
    }

    if (syncData.inventory?.length > 0) {
      syncResults.results.inventory = await pushToIronSuite(
        '/api/items', syncData.inventory, cookieString, mapInventoryItem
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
