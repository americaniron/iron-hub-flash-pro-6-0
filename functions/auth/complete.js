const STANDALONE_HUB_ORIGIN = "https://sellparts.fixmyiron.com";
const HANDOFF_COOKIE = "__Host-iron_hub_handoff";
const ACCESS_COOKIE = "__Host-iron_hub_access";
const ACCESS_MAX_AGE_SECONDS = 8 * 60 * 60;

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

function returnPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 2048) return "/";
  try {
    const target = new URL(value, STANDALONE_HUB_ORIGIN);
    return target.origin === STANDALONE_HUB_ORIGIN ? `${target.pathname}${target.search}${target.hash}` : "/";
  } catch {
    return "/";
  }
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

function clearHandoffCookie(headers) {
  headers.append("Set-Cookie", `${HANDOFF_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
}

function failure(status) {
  const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  clearHandoffCookie(headers);
  return new Response("Secure sign-in could not be completed.", { status, headers });
}

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
  }

  const url = new URL(context.request.url);
  const ticket = url.searchParams.get("ticket") || "";
  const state = getCookie(context.request, HANDOFF_COOKIE);
  if (!/^[a-f0-9]{64}$/i.test(ticket) || !/^[a-f0-9]{64}$/i.test(state)) return failure(400);

  const backend = suiteApiUrl(context.env.SUITE_API_URL);
  if (!backend) return failure(503);

  const exchangeUrl = new URL("/api/hub-standalone/exchange", backend);
  let response;
  try {
    response = await fetch(exchangeUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: STANDALONE_HUB_ORIGIN,
        "X-Iron-Hub-Standalone-Exchange": "1",
      },
      body: JSON.stringify({ ticket, state }),
      redirect: "manual",
    });
  } catch {
    return failure(502);
  }

  const body = await response.json().catch(() => ({}));
  const accessToken = typeof body.sessionToken === "string" ? body.sessionToken : "";
  if (!response.ok || !/^[a-f0-9]{64}$/i.test(accessToken)) return failure(response.status === 401 || response.status === 403 ? 403 : 502);

  const target = new URL(returnPath(url.searchParams.get("return_to")), STANDALONE_HUB_ORIGIN);
  const headers = new Headers({
    Location: target.toString(),
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  clearHandoffCookie(headers);
  headers.append(
    "Set-Cookie",
    `${ACCESS_COOKIE}=${accessToken}; Max-Age=${ACCESS_MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`,
  );
  return new Response(null, { status: 303, headers });
}
