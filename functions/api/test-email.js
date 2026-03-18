// ---------------------------------------------------------------------------
// Cloudflare Pages Function — /api/test-email
// Tests SMTP connectivity by sending a verification email
// Uses cloudflare:sockets for direct SMTP (same as send-email.js)
// ---------------------------------------------------------------------------
import { connect } from 'cloudflare:sockets';

const H = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: H });
}

function b64(str) {
  return btoa(str);
}

async function createSmtpClient(host, port) {
  const isImplicitTls = port === 465;
  const socket = connect({ hostname: host, port }, isImplicitTls ? { secureTransport: 'on' } : {});
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();

  async function readResponse() {
    let full = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      full += decoder.decode(value, { stream: true });
      if (/\r\n$/.test(full) && /^\d{3}[ ]/.test(full.split('\r\n').filter(Boolean).pop() || '')) break;
    }
    const code = parseInt(full.substring(0, 3), 10);
    return { code, text: full.trim() };
  }

  async function sendCommand(cmd) {
    await writer.write(new TextEncoder().encode(cmd + '\r\n'));
    return readResponse();
  }

  return { readResponse, sendCommand, close: () => { writer.close(); } };
}

export async function onRequestPost(context) {
  const { env } = context;

  const SMTP_USER = env.SMTP_USER;
  const SMTP_PASS = (env.SMTP_PASS || '').replace(/\s+/g, '');
  const SMTP_HOST = env.SMTP_HOST || 'smtp.gmail.com';
  const SMTP_PORT = parseInt(env.SMTP_PORT || '465', 10);

  if (!SMTP_USER || !SMTP_PASS) {
    return Response.json(
      { error: 'Missing SMTP credentials. Please configure SMTP_HOST, SMTP_USER, and SMTP_PASS.' },
      { status: 400, headers: H }
    );
  }

  let smtp;
  try {
    smtp = await createSmtpClient(SMTP_HOST, SMTP_PORT);

    const greeting = await smtp.readResponse();
    if (greeting.code !== 220) throw new Error(`Connection rejected: ${greeting.text}`);

    let ehlo = await smtp.sendCommand('EHLO ironhub.americanironus.com');
    if (ehlo.code !== 250) throw new Error(`EHLO rejected: ${ehlo.text}`);

    let r = await smtp.sendCommand('AUTH LOGIN');
    if (r.code !== 334) throw new Error(`AUTH LOGIN rejected: ${r.text}`);

    r = await smtp.sendCommand(b64(SMTP_USER));
    if (r.code !== 334) throw new Error(`Username rejected: ${r.text}`);

    r = await smtp.sendCommand(b64(SMTP_PASS));
    if (r.code !== 235) throw new Error(`Authentication failed: ${r.text}`);

    // Send a quick test email
    const FROM = env.DISPLAY_FROM_EMAIL || 'noreply@americanironus.com';
    r = await smtp.sendCommand(`MAIL FROM:<${SMTP_USER}>`);
    if (r.code !== 250) throw new Error(`MAIL FROM rejected: ${r.text}`);

    r = await smtp.sendCommand(`RCPT TO:<${SMTP_USER}>`);
    if (r.code !== 250) throw new Error(`RCPT TO rejected: ${r.text}`);

    r = await smtp.sendCommand('DATA');
    if (r.code !== 354) throw new Error(`DATA rejected: ${r.text}`);

    const msg = [
      `From: "American Iron Test" <${FROM}>`,
      `Reply-To: "American Iron" <noreply@americanironus.com>`,
      `To: ${SMTP_USER}`,
      `Subject: SMTP Connection Test - American Iron Dispatch`,
      `Date: ${new Date().toUTCString()}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=UTF-8`,
      '',
      `<div style="font-family: sans-serif; padding: 20px; border: 2px solid #fbbf24; border-radius: 12px; background-color: #fffbeb;">`,
      `<h2 style="color: #000; margin-top: 0;">Connection Test Successful</h2>`,
      `<p>Your SMTP configuration for the <strong>American Iron Dispatch Hub</strong> is working correctly.</p>`,
      `<hr style="border: none; border-top: 1px solid #fde68a; margin: 20px 0;" />`,
      `<p style="font-size: 12px; color: #92400e;">Timestamp: ${new Date().toISOString()}</p>`,
      `</div>`,
    ].join('\r\n');

    r = await smtp.sendCommand(msg + '\r\n.');
    if (r.code !== 250) throw new Error(`Message rejected: ${r.text}`);

    await smtp.sendCommand('QUIT');
    smtp.close();

    return Response.json(
      { success: true, message: 'SMTP connection verified and test email sent successfully.' },
      { status: 200, headers: H }
    );
  } catch (err) {
    try { smtp?.close(); } catch {}
    return Response.json(
      { error: 'SMTP Test Failed', details: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: H }
    );
  }
}
