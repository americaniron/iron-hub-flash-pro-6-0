# Iron Hub 6.0

Iron Hub is the quoting, invoicing, customer, inventory, voice, and document
workspace embedded in IronSuite and available as a standalone Cloudflare Pages
application. Production runs entirely on Cloudflare:

- The Hub is deployed as Cloudflare Pages at `iron-hub-flash-pro-6-0`.
- The authenticated `fixmyiron-suite-api` Worker owns AI, email, transcription,
  data persistence, audit logging, and tenant authorization.
- The standalone hosts (`sellparts.fixmyiron.com` and
  `iron-hub-flash-pro-6-0.pages.dev`) use a one-time handoff from the existing
  IronSuite sign-in. The Pages hostname permanently redirects to
  `sellparts.fixmyiron.com`. After the user is verified at Suite, the callback
  stores a short-lived HttpOnly session only on the standalone host. Its Pages
  Function forwards only the documented Hub API allowlist with that scoped
  session; no Clerk token or API key is exposed to the Hub browser code.
- Do not add provider keys, SMTP credentials, Gemini configuration, or a
  separate backend to this repository.

## Local checks

```sh
npm install
npm run lint
npm test
npm run build
npm run dev
```

The local dev server is for UI, import, and PDF checks. Authenticated AI,
email, transcription, and canonical Suite synchronization require a current
Clerk session with the Iron Hub Pro entitlement.
