/**
 * Cloudflare Pages Function: IronSuite Login Proxy
 *
 * Proxies login to IronSuite's Replit-based auth and returns the session cookie.
 * Since IronSuite uses Replit OIDC, we try the /api/auth/login endpoint
 * or fall back to checking /api/auth/me with provided credentials.
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
      return new Response(JSON.stringify({ error: 'Username and password required.' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Attempt login via IronSuite's auth endpoint
    const loginResponse = await fetch(`${IRONSUITE_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      redirect: 'manual', // Don't follow redirects — we need the Set-Cookie header
    });

    // Extract session cookie from the response
    const setCookieHeader = loginResponse.headers.get('set-cookie') || '';
    const allHeaders = [...loginResponse.headers.entries()];

    // Collect all set-cookie values
    let cookies = [];
    for (const [key, value] of allHeaders) {
      if (key.toLowerCase() === 'set-cookie') {
        cookies.push(value);
      }
    }

    // Also try to get cookies from the raw header
    if (cookies.length === 0 && setCookieHeader) {
      cookies = [setCookieHeader];
    }

    // Build a cookie string for forwarding
    const cookieString = cookies
      .map(c => c.split(';')[0]) // Just the name=value part
      .join('; ');

    if (loginResponse.ok || loginResponse.status === 302 || loginResponse.status === 301) {
      // Verify the session works
      const verifyResponse = await fetch(`${IRONSUITE_BASE}/api/auth/me`, {
        headers: {
          'Cookie': cookieString,
          'Accept': 'application/json',
        },
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

    // If direct login didn't work, the response body may contain error info
    const responseText = await loginResponse.text().catch(() => '');

    return new Response(JSON.stringify({
      success: false,
      error: `Login failed (HTTP ${loginResponse.status}). IronSuite may use Replit SSO — try the session cookie method instead.`,
      hint: 'Open IronSuite in another tab, log in, then copy your session cookie from DevTools → Application → Cookies.',
      responseStatus: loginResponse.status,
    }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: `Login proxy error: ${err.message}`
    }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}
