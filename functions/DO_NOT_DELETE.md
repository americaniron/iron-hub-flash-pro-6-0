# PROTECTED DIRECTORY - DO NOT DELETE

The files in `functions/api/` are **Cloudflare Pages Functions** (serverless endpoints).
They are CRITICAL for the application to work. Deleting them breaks:

- **send-email.js** — Email dispatch via SMTP (customers won't receive quotes)
- **gemini.js** — Gemini AI proxy (AI features stop working)
- **ai-status.js** — AI configuration check
- **test-email.js** — SMTP connection testing

These files are protected by a GitHub Actions workflow that will automatically
restore them if deleted. Do NOT remove this directory or its contents.
