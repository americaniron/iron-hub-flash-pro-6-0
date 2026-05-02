import { resolveSession, corsForOrigin, jsonResponse, unauthorized } from '../_auth.js';

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsForOrigin(request) });
}

export async function onRequestGet({ request, env }) {
  const session = await resolveSession(request, env);
  if (!session) return unauthorized(request);
  return jsonResponse(request, { success: true, ...session });
}
