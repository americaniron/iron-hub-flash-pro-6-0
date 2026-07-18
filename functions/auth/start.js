const STANDALONE_HUB_ORIGIN = "https://sellparts.fixmyiron.com";
const SUITE_FRONTEND_ORIGIN = "https://suite.fixmyiron.com";
const HANDOFF_COOKIE = "__Host-iron_hub_handoff";
const HANDOFF_MAX_AGE_SECONDS = 5 * 60;

function opaqueToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function hashToken(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function returnPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 2048) return "/";
  try {
    const target = new URL(value, STANDALONE_HUB_ORIGIN);
    return target.origin === STANDALONE_HUB_ORIGIN ? `${target.pathname}${target.search}${target.hash}` : "/";
  } catch {
    return "/";
  }
}

function suiteFrontendOrigin(value) {
  try {
    const url = new URL(String(value || SUITE_FRONTEND_ORIGIN));
    return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
      ? url
      : null;
  } catch {
    return null;
  }
}

function redirect(location, headers) {
  headers.set("Location", location);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(null, { status: 302, headers });
}

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
  }

  const url = new URL(context.request.url);
  const suiteOrigin = suiteFrontendOrigin(context.env.SUITE_FRONTEND_ORIGIN);
  if (!suiteOrigin) {
    return new Response("Service unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const state = opaqueToken();
  const handoff = new URL("/api/hub-standalone/handoff", suiteOrigin);
  handoff.searchParams.set("state_hash", await hashToken(state));
  handoff.searchParams.set("return_to", returnPath(url.searchParams.get("return_to")));

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `${HANDOFF_COOKIE}=${state}; Max-Age=${HANDOFF_MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`,
  );
  return redirect(handoff.toString(), headers);
}
