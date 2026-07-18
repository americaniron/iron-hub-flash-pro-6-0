const HUB_API_ENDPOINTS = new Set([
  "activity",
  "claude",
  "data",
  "data-status",
  "elevenlabs-tts",
  "gemini",
  "hub-session",
  "invoice-payment-link",
  "send-email",
  "test-email",
  "transcribe",
]);
const PAGES_HOST = "iron-hub-flash-pro-6-0.pages.dev";
const STANDALONE_HUB_ORIGIN = "https://sellparts.fixmyiron.com";

function json(body, status) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function suiteApiUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
      ? url
      : null;
  } catch {
    return null;
  }
}

function isHubApiPath(pathname) {
  if (!pathname.startsWith("/api/")) return false;
  return HUB_API_ENDPOINTS.has(pathname.slice("/api/".length));
}

function standaloneCanonicalRedirect(url) {
  if (url.hostname !== PAGES_HOST) return null;
  const target = new URL(url.pathname + url.search, STANDALONE_HUB_ORIGIN);
  return Response.redirect(target.toString(), 308);
}

function buildProxyHeaders(request, url) {
  const headers = new Headers();
  const authorization = request.headers.get("Authorization");
  if (authorization) headers.set("Authorization", authorization);
  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  const accept = request.headers.get("Accept");
  if (accept) headers.set("Accept", accept);
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) headers.set("X-Forwarded-For", clientIp);
  headers.set("X-Forwarded-Host", url.hostname);
  headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
  headers.set("Host", url.hostname);
  return headers;
}

async function proxyStandaloneHubApi(context, url) {
  if (!isHubApiPath(url.pathname)) {
    return json({ error: "Iron Hub API route not found." }, 404);
  }

  const authorization = context.request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "Sign in is required to use Iron Hub." }, 401);
  }

  const backend = suiteApiUrl(context.env.SUITE_API_URL);
  if (!backend) {
    return json({ error: "Iron Hub service is unavailable." }, 503);
  }

  const targetUrl = new URL(`${url.pathname}${url.search}`, backend);
  const init = {
    method: context.request.method,
    headers: buildProxyHeaders(context.request, url),
    redirect: "manual",
  };
  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    init.body = context.request.body;
    init.duplex = "half";
  }

  try {
    const response = await fetch(targetUrl, init);
    const headers = new Headers();
    for (const [key, value] of response.headers.entries()) {
      const lower = key.toLowerCase();
      if (lower === "set-cookie" || lower === "content-length" || lower === "transfer-encoding") continue;
      headers.set(key, value);
    }
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return json({ error: "Iron Hub service is temporarily unavailable." }, 502);
  }
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const canonicalRedirect = standaloneCanonicalRedirect(url);
  if (canonicalRedirect) return canonicalRedirect;

  // The standalone Hub presents the same Clerk sign-in as IronSuite and only
  // proxies a fixed API allowlist. The Suite Worker validates each bearer
  // token and remains authoritative for tenants, roles, and entitlements.
  if (url.pathname.startsWith("/api/")) {
    return proxyStandaloneHubApi(context, url);
  }

  return context.next();
}
