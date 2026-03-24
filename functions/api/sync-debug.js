/**
 * Debug endpoint: Tests the full login → verify → API call flow
 * and returns detailed diagnostics at each step.
 */
const IRONSUITE_BASE = 'https://iron-hub-suite.replit.app';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const diag = { steps: [] };

  try {
    const { username, password } = await context.request.json();

    // Step 1: Login
    diag.steps.push({ step: 'login_request', url: `${IRONSUITE_BASE}/api/auth/login`, method: 'POST' });

    const loginResp = await fetch(`${IRONSUITE_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      redirect: 'manual',
    });

    const loginBody = await loginResp.text();
    let loginJson = null;
    try { loginJson = JSON.parse(loginBody); } catch (e) {}

    // Collect ALL response headers
    const allHeaders = {};
    loginResp.headers.forEach((value, key) => {
      // Mask actual cookie values but show the key names
      if (key.toLowerCase() === 'set-cookie') {
        // Show cookie name and length, not value
        const cookieName = value.split('=')[0];
        const cookieLen = value.length;
        allHeaders[key] = (allHeaders[key] || []);
        allHeaders[key].push(`${cookieName}=<${cookieLen} chars>`);
      } else {
        allHeaders[key] = value;
      }
    });

    // Try getSetCookie
    let setCookies = [];
    try {
      if (loginResp.headers.getSetCookie) {
        setCookies = loginResp.headers.getSetCookie();
      }
    } catch (e) {
      diag.steps.push({ step: 'getSetCookie_error', error: e.message });
    }

    // Try .get('set-cookie')
    const rawSetCookie = loginResp.headers.get('set-cookie');

    diag.steps.push({
      step: 'login_response',
      status: loginResp.status,
      headers: allHeaders,
      bodyKeys: loginJson ? Object.keys(loginJson) : null,
      bodyPreview: loginBody.substring(0, 200),
      setCookieCount: setCookies.length,
      setCookieNames: setCookies.map(c => c.split('=')[0]),
      rawSetCookieExists: !!rawSetCookie,
      rawSetCookieLength: rawSetCookie ? rawSetCookie.length : 0,
    });

    // Build cookie string
    let cookieString = '';
    if (setCookies.length > 0) {
      cookieString = setCookies.map(c => c.split(';')[0].trim()).join('; ');
      diag.steps.push({ step: 'cookie_from_getSetCookie', cookieLength: cookieString.length });
    } else if (rawSetCookie) {
      cookieString = rawSetCookie.split(/,(?=\s*\w+=)/).map(c => c.split(';')[0].trim()).join('; ');
      diag.steps.push({ step: 'cookie_from_rawHeader', cookieLength: cookieString.length });
    } else {
      diag.steps.push({ step: 'no_cookies_found' });
    }

    // Step 2: Verify with /api/auth/me
    if (cookieString) {
      const meResp = await fetch(`${IRONSUITE_BASE}/api/auth/me`, {
        headers: { 'Cookie': cookieString, 'Accept': 'application/json' },
      });
      const meBody = await meResp.text();

      diag.steps.push({
        step: 'verify_auth_me',
        status: meResp.status,
        bodyPreview: meBody.substring(0, 200),
      });

      // Step 3: Try a test POST to /api/customers
      if (meResp.ok) {
        const testResp = await fetch(`${IRONSUITE_BASE}/api/customers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': cookieString,
          },
          body: JSON.stringify({ name: '__sync_test__', email: 'test@test.com' }),
        });
        const testBody = await testResp.text();

        diag.steps.push({
          step: 'test_api_post',
          endpoint: '/api/customers',
          status: testResp.status,
          bodyPreview: testBody.substring(0, 200),
        });
      }
    }

    return new Response(JSON.stringify(diag, null, 2), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    diag.steps.push({ step: 'error', message: err.message, stack: err.stack?.substring(0, 300) });
    return new Response(JSON.stringify(diag, null, 2), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}
