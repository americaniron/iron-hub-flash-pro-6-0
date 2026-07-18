const SUITE_HUB_URL = "https://suite.fixmyiron.com/iron-hub-pro";

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Iron Hub is served inside IronSuite, whose authenticated Worker owns every
  // provider integration. The standalone Pages origin must never be an open
  // relay or a public AI/database proxy.
  if (url.pathname.startsWith("/api/")) {
    return Response.json(
      {
        error: "Direct Iron Hub API access is disabled.",
        suiteUrl: SUITE_HUB_URL,
      },
      {
        status: 410,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return context.next();
}
