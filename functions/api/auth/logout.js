import { deleteSession, corsForOrigin, jsonResponse } from '../_auth.js';

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsForOrigin(request) });
}

export async function onRequestPost({ request, env }) {
  await deleteSession(env, request);
  return jsonResponse(request, { success: true });
}
