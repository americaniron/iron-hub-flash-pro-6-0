/**
 * Cloudflare Pages Function: POST /api/send-email
 *
 * Direct SMTP email sender for Google Workspace (smtp.gmail.com:465).
 * Replaces the Cloud Run proxy path with a native Cloudflare implementation
 * using cloudflare:sockets for TCP/TLS connections.
 *
 * This file takes priority over [[path]].ts for the /api/send-email route.
 *
 * Env vars: SMTP_USER, SMTP_PASS, SMTP_HOST, SMTP_PORT, SMTP_SECURE
 */

// ---------------------------------------------------------------------------
// SMTP CLIENT — Cloudflare TCP sockets
// ---------------------------------------------------------------------------

async function createSmtpClient(host, port) {
  const { connect } = await import('cloudflare:sockets');
  const useImplicitTls = port === 465;
  const transportMode = useImplicitTls ? 'on' : 'starttls';

  const socket = connect(`${host}:${port}`, {
    secureTransport: transportMode,
    allowHalfOpen: false,
  });

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let writer = socket.writable.getWriter();
  let reader = socket.readable.getReader();

  async function readResponse() {
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw makeErr('Connection closed unexpectedly', buffer);
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\r\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].length >= 4 && /^\d{3} /.test(lines[i])) {
          return { code: parseInt(lines[i].substring(0, 3), 10), text: buffer.trim() };
        }
      }
    }
  }

  async function sendCommand(command) {
    await writer.write(encoder.encode(command + '\r\n'));
    return readResponse();
  }

  async function upgradeToTls() {
    writer.releaseLock();
    reader.releaseLock();
    const tlsSocket = socket.startTls();
    writer = tlsSocket.writable.getWriter();
    reader = tlsSocket.readable.getReader();
  }

  function close() {
    try { writer.releaseLock(); } catch (_) {}
    try { reader.releaseLock(); } catch (_) {}
    try { socket.close(); } catch (_) {}
  }

  return { readResponse, sendCommand, upgradeToTls, close, isStartTls: !useImplicitTls };
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function makeErr(message, response, command) {
  const err = new Error(message);
  err.smtpResponse = typeof response === 'object' ? response.text : (response || '');
  err.command = command || '';
  err.code = typeof response === 'object' ? String(response.code) : '';
  return err;
}

function b64(str) { return btoa(str); }
function utf8b64(str) { return btoa(unescape(encodeURIComponent(str))); }

/** Process a data-URL attachment into {filename, base64Content, contentType} */
function processAttachment(att) {
  if (att.path && typeof att.path === 'string' && att.path.startsWith('data:')) {
    const parts = att.path.split(';base64,');
    if (parts.length === 2) {
      return {
        filename: att.filename || 'attachment',
        base64Content: parts[1],
        contentType: parts[0].split(':')[1]?.split(';')[0] || 'application/octet-stream',
      };
    }
  }
  return null; // Skip non-base64 attachments (can't handle file paths in Workers)
}

/** Build the branded HTML email body — matches server.ts template exactly */
function buildHtmlBody(textBody) {
  const year = new Date().getFullYear();
  return `<div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
  <div style="background-color: #000000; padding: 30px; text-align: center; border-bottom: 4px solid #ffcd00;">
    <h1 style="color: #ffcd00; margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 2px;">American Iron Dispatch</h1>
  </div>
  <div style="padding: 40px; color: #111827; line-height: 1.6;">
    <div style="white-space: pre-wrap; font-size: 16px; color: #374151;">${textBody}</div>
  </div>
  <div style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
    <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">
      American Iron LLC &copy; ${year}
    </p>
    <p style="margin: 10px 0 0; font-size: 11px; color: #9ca3af;">
      13930 N. Dale Mabry HWY. Site 5. Tampa, FL. 33618
    </p>
    <p style="margin: 5px 0 0; font-size: 11px; color: #ffcd00; font-weight: bold;">
      www.AmericanIronUS.com
    </p>
    <p style="margin: 15px 0 0; font-size: 10px; color: #9ca3af; font-style: italic;">
      This is an automated dispatch from the American Iron Logistics &amp; Supply Hub.
    </p>
  </div>
</div>`;
}

/** Build a full MIME message with optional attachments */
function buildMimeMessage({ from, replyTo, to, subject, textBody, htmlBody, messageId, attachments }) {
  const date = new Date().toUTCString();
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const encodedSubject = `=?UTF-8?B?${utf8b64(subject)}?=`;

  const headers = [
    `From: ${from}`,
    `Reply-To: ${replyTo || from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `X-Mailer: IronHub/5.7`,
  ];

  if (attachments && attachments.length > 0) {
    // Multipart/mixed for email + attachments
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

    let body = headers.join('\r\n') + '\r\n\r\n';

    // HTML part
    const htmlB64 = utf8b64(htmlBody);
    const htmlLines = htmlB64.match(/.{1,76}/g) || [htmlB64];
    body += `--${boundary}\r\n`;
    body += `Content-Type: text/html; charset=UTF-8\r\n`;
    body += `Content-Transfer-Encoding: base64\r\n\r\n`;
    body += htmlLines.join('\r\n') + '\r\n\r\n';

    // Attachment parts
    for (const att of attachments) {
      body += `--${boundary}\r\n`;
      body += `Content-Type: ${att.contentType}; name="${att.filename}"\r\n`;
      body += `Content-Disposition: attachment; filename="${att.filename}"\r\n`;
      body += `Content-Transfer-Encoding: base64\r\n\r\n`;
      const attLines = att.base64Content.match(/.{1,76}/g) || [att.base64Content];
      body += attLines.join('\r\n') + '\r\n\r\n';
    }

    body += `--${boundary}--\r\n`;
    return body;
  } else {
    // Simple HTML email, no attachments
    headers.push(`Content-Type: text/html; charset=UTF-8`);
    headers.push(`Content-Transfer-Encoding: base64`);

    const htmlB64 = utf8b64(htmlBody);
    const htmlLines = htmlB64.match(/.{1,76}/g) || [htmlB64];

    return headers.join('\r\n') + '\r\n\r\n' + htmlLines.join('\r\n');
  }
}

// ---------------------------------------------------------------------------
// MAIN HANDLER — POST /api/send-email
// ---------------------------------------------------------------------------

export async function onRequestPost(context) {
  const { request, env } = context;

  const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  // ── Environment ──
  const SMTP_USER = env.SMTP_USER;
  const SMTP_PASS = (env.SMTP_PASS || '').replace(/\s+/g, ''); // strip spaces from app password
  const SMTP_HOST = env.SMTP_HOST || 'smtp.gmail.com';
  const SMTP_PORT = parseInt(env.SMTP_PORT || '465', 10);
  const FROM_EMAIL = env.FROM_EMAIL || SMTP_USER;
  const REPLY_TO_EMAIL = env.REPLY_TO_EMAIL || 'noreply@americanironus.com';
  const DISPLAY_FROM_EMAIL = env.DISPLAY_FROM_EMAIL || 'noreply@americanironus.com';

  if (!SMTP_USER || !SMTP_PASS) {
    return Response.json({
      error: 'Email service not configured',
      details: 'Missing SMTP_USER or SMTP_PASS.',
      troubleshooting: 'Set SMTP_USER and SMTP_PASS in Cloudflare Pages environment variables.',
    }, { status: 500, headers: H });
  }

  // ── Parse body (matches server.ts interface) ──
  let data;
  try { data = await request.json(); }
  catch (_) { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: H }); }

  const { to, subject, body: textBody, attachment, filename, attachments } = data;

  if (!to || !subject || !textBody) {
    return Response.json({ error: 'Missing required fields' }, { status: 400, headers: H });
  }

  // ── Process attachments ──
  const processedAttachments = [];
  if (attachments && Array.isArray(attachments)) {
    for (const att of attachments) {
      const p = processAttachment(att);
      if (p) processedAttachments.push(p);
    }
  } else if (attachment) {
    const p = processAttachment({ filename: filename || 'Document.pdf', path: attachment });
    if (p) processedAttachments.push(p);
  }

  // ── Build email ──
  const htmlBody = buildHtmlBody(textBody);
  const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2, 12)}@americanironus.com>`;

  const mimeMessage = buildMimeMessage({
    from: `"American Iron Dispatch" <${DISPLAY_FROM_EMAIL}>`,
    replyTo: `"American Iron" <${REPLY_TO_EMAIL}>`,
    to,
    subject,
    textBody,
    htmlBody,
    messageId,
    attachments: processedAttachments,
  });

  // ── Send via SMTP ──
  let smtp;
  try {
    smtp = await createSmtpClient(SMTP_HOST, SMTP_PORT);

    // 1. Greeting
    const greeting = await smtp.readResponse();
    if (greeting.code !== 220) throw makeErr('Connection rejected', greeting, 'CONNECT');

    // 2. EHLO
    let ehlo = await smtp.sendCommand('EHLO ironhub.americanironus.com');
    if (ehlo.code !== 250) throw makeErr('EHLO rejected', ehlo, 'EHLO');

    // 3. STARTTLS (port 587 only)
    if (smtp.isStartTls) {
      const tls = await smtp.sendCommand('STARTTLS');
      if (tls.code !== 220) throw makeErr('STARTTLS rejected', tls, 'STARTTLS');
      await smtp.upgradeToTls();
      ehlo = await smtp.sendCommand('EHLO ironhub.americanironus.com');
      if (ehlo.code !== 250) throw makeErr('EHLO after TLS rejected', ehlo, 'EHLO');
    }

    // 4. AUTH LOGIN
    let r = await smtp.sendCommand('AUTH LOGIN');
    if (r.code !== 334) throw makeErr('AUTH LOGIN rejected', r, 'AUTH LOGIN');

    r = await smtp.sendCommand(b64(SMTP_USER));
    if (r.code !== 334) throw makeErr('Username rejected', r, 'AUTH user');

    r = await smtp.sendCommand(b64(SMTP_PASS));
    if (r.code !== 235) throw makeErr('Authentication failed — check app password', r, 'AUTH pass');

    // 5. MAIL FROM
    r = await smtp.sendCommand(`MAIL FROM:<${FROM_EMAIL}>`);
    if (r.code !== 250) throw makeErr('Sender rejected', r, 'MAIL FROM');

    // 6. RCPT TO
    r = await smtp.sendCommand(`RCPT TO:<${to}>`);
    if (r.code !== 250) throw makeErr('Recipient rejected', r, 'RCPT TO');

    // 7. DATA
    r = await smtp.sendCommand('DATA');
    if (r.code !== 354) throw makeErr('DATA rejected', r, 'DATA');

    // 8. Send message (dot-stuff leading dots per RFC 5321)
    const stuffed = mimeMessage.replace(/^\./gm, '..');
    r = await smtp.sendCommand(stuffed + '\r\n.');
    if (r.code !== 250) throw makeErr('Message rejected', r, 'END DATA');

    // 9. QUIT
    try { await smtp.sendCommand('QUIT'); } catch (_) {}

    // ── Success ── (matches server.ts response format)
    return Response.json({
      success: true,
      messageId,
    }, { status: 200, headers: H });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({
      error: 'Failed to send email',
      details: msg,
      code: error.code || 'UNKNOWN_ERROR',
      command: error.command || undefined,
      response: error.smtpResponse || undefined,
      troubleshooting: error.code === 'EAUTH' || msg.includes('Authentication')
        ? "Authentication failed. Ensure you are using a Google 'App Password', not your regular password."
        : 'Verify SMTP_USER, SMTP_PASS, SMTP_HOST, SMTP_PORT in Cloudflare Pages environment variables.',
    }, { status: 500, headers: H });

  } finally {
    if (smtp) smtp.close();
  }
}

// ---------------------------------------------------------------------------
// CORS PREFLIGHT
// ---------------------------------------------------------------------------

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}
