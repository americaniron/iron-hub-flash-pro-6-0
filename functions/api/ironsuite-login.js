/**
 * Cloudflare Pages Function: IronSuite Login Proxy
 *
 * Proxies login to IronSuite and returns the session cookie.
 * IronSuite uses POST /api/auth/login with { username, password }.
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
  try {
    const { username, password } = await context.request.json();

    if (!username || !password) {
      return new Response(JSON.stringify({ success: false, error: 'Username and password required.' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // POST to IronSuite's login endpoint (same as their frontend does)
    const loginResponse = await fetch(`${IRONSUITE_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      redirect: 'manual',
    });

    // Extract session cookies - Cloudflare Workers supports getSetCookie()
    let cookies = [];
    try {
      // Cloudflare Workers / modern runtime
      cookies = loginResponse.headers.getSetCookie ? loginResponse.headers.getSetCookie() : [];
    } catch (e) {
      // fallback
      cookies = [];
    }

    // Fallback: try .get('set-cookie') which may return combined cookies
    if (cookies.length === 0) {
      const raw = loginResponse.headers.get('set-cookie');
      if (raw) {
        // Split on comma followed by a cookie name pattern (name=)
        cookies = raw.split(/,(?=\s*\w+=)/);
      }
    }

    // Build a cookie string: just name=value pairs, stripped of attributes
    const cookieString = cookies
      .map(c => c.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');

    // Also get the response body for success/error info
    const responseBody = await loginResponse.text().catch(() => '');
    let responseJson = null;
    try { responseJson = JSON.parse(responseBody); } catch (e) {}

    // Check if login was successful (200 or redirect)
    if (loginResponse.ok || loginResponse.status === 302 || loginResponse.status === 301) {

      // If we got cookies, verify the session works
      if (cookieString) {
        const verifyResponse = await fetch(`${IRONSUITE_BASE}/api/auth/me`, {
          headers: { 'Cookie': cookieString, 'Accept': 'application/json' },
        });

        if (verifyResponse.ok) {
          const user = await verifyResponse.json().catch(() => null);
          return new Response(JSON.stringify({
            success: true,
            sessionCookie: cookieString,
            user: user,
          }), {
            status: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }
      }

      // Login succeeded but we couldn't verify the session
      // The response body itself might contain a token or session info
      if (responseJson && (responseJson.token || responseJson.sessionId || responseJson.user)) {
        return new Response(JSON.stringify({
          success: true,
          sessionCookie: cookieString || responseJson.token || responseJson.sessionId || '',
          user: responseJson.user || null,
          note: 'Login succeeded. Session from response body.',
        }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      // Login 200 but no cookies and no token - return what we have
      return new Response(JSON.stringify({
        success: true,
        sessionCookie: cookieString || '',
        user: responseJson || null,
        note: cookieString ? 'Cookie extracted but verification failed.' : 'Login OK but no session cookie found in response.',
        debug: {
          status: loginResponse.status,
          hasCookies: cookies.length > 0,
          bodyPreview: responseBody.substring(0, 200),
        }
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Login failed
    return new Response(JSON.stringify({
      success: false,
      error: (responseJson && responseJson.message) ? responseJson.message : `Login failed (HTTP ${loginResponse.status})`,
      debug: {
        status: loginResponse.status,
        bodyPreview: responseBody.substring(0, 200),
      }
    }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: `Login proxy error: ${err.message}`
    }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}
