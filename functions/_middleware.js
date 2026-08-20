const HUB_API_ENDPOINTS = new Set([
  "activity",
  "branding",
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
const STANDALONE_ACCESS_COOKIE = "__Host-iron_hub_access";
const UPSTREAM_ACCESS_COOKIE = "iron_hub_standalone";

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

// An organization's logo is an unguessable R2 key that the Suite already serves publicly. It is
// passed through unauthenticated and same-origin on purpose: an <img> pointing at another origin
// taints the canvas html2pdf renders from, and the logo would silently vanish from the PDF.
function isPublicAssetPath(pathname) {
  return pathname.startsWith("/api/assets/");
}

function standaloneCanonicalRedirect(request, url) {
  if (url.hostname !== PAGES_HOST) return null;
  // IronSuite fetches the production Pages build server-side and serves it
  // through its same-origin authenticated iframe. Do not redirect that
  // internal fetch through the public custom-domain security layer.
  if (request.headers.get("X-Iron-Suite-Embed") === "1") return null;
  const target = new URL(url.pathname + url.search, STANDALONE_HUB_ORIGIN);
  return Response.redirect(target.toString(), 308);
}

function getCookie(request, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

function standaloneAccessToken(request) {
  const value = getCookie(request, STANDALONE_ACCESS_COOKIE);
  return /^[a-f0-9]{64}$/i.test(value) ? value : "";
}

function buildProxyHeaders(request, url, accessToken) {
  const headers = new Headers();
  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  const accept = request.headers.get("Accept");
  if (accept) headers.set("Accept", accept);
  const origin = request.headers.get("Origin");
  if (origin) headers.set("Origin", origin);
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) headers.set("X-Forwarded-For", clientIp);
  headers.set("X-Forwarded-Host", url.hostname);
  headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
  headers.set("X-Iron-Hub-Standalone", "1");
  headers.set("Cookie", `${UPSTREAM_ACCESS_COOKIE}=${encodeURIComponent(accessToken)}`);
  headers.set("Host", url.hostname);
  return headers;
}

async function proxyStandaloneHubApi(context, url) {
  const publicAsset = isPublicAssetPath(url.pathname);
  if (!publicAsset && !isHubApiPath(url.pathname)) {
    return json({ error: "Iron Hub API route not found." }, 404);
  }
  if (publicAsset && context.request.method !== "GET" && context.request.method !== "HEAD") {
    return json({ error: "Method not allowed." }, 405);
  }

  const accessToken = standaloneAccessToken(context.request);
  if (!publicAsset && !accessToken) {
    return json({ error: "Sign in is required to use Iron Hub." }, 401);
  }

  const backend = suiteApiUrl(context.env.SUITE_API_URL);
  if (!backend) {
    return json({ error: "Iron Hub service is unavailable." }, 503);
  }

  const targetUrl = new URL(`${url.pathname}${url.search}`, backend);
  const init = {
    method: context.request.method,
    headers: buildProxyHeaders(context.request, url, accessToken),
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
    // An asset is immutable at its key; only API answers must not be cached.
    if (!publicAsset) headers.set("Cache-Control", "no-store");
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
  const canonicalRedirect = standaloneCanonicalRedirect(context.request, url);
  if (canonicalRedirect) return canonicalRedirect;

  // Browser requests carry only the standalone HttpOnly session cookie. The
  // Suite Worker remains authoritative for tenants, roles, and entitlements.
  if (url.pathname.startsWith("/api/")) {
    return proxyStandaloneHubApi(context, url);
  }

  return context.next();
}
