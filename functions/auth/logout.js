const ACCESS_COOKIE = "__Host-iron_hub_access";
const SUITE_ORIGIN = "https://suite.fixmyiron.com";

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
  }

  return new Response(null, {
    status: 303,
    headers: {
      Location: `${SUITE_ORIGIN}/`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": `${ACCESS_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`,
    },
  });
}
