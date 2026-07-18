# Iron Hub 6.0

Iron Hub is the quoting, invoicing, customer, inventory, voice, and document
workspace embedded in IronSuite. Production runs entirely on Cloudflare:

- The Hub is deployed as Cloudflare Pages at `iron-hub-flash-pro-6-0`.
- The authenticated `fixmyiron-suite-api` Worker owns AI, email, transcription,
  data persistence, audit logging, and tenant authorization.
- The standalone Pages origin rejects direct `/api/*` requests. Do not add
  provider keys, SMTP credentials, Gemini configuration, or a separate backend
  to this repository.

## Local checks

```sh
npm install
npm run lint
npm test
npm run build
npm run dev
```

The local dev server is for UI, import, and PDF checks. Authenticated AI,
email, transcription, and canonical Suite synchronization require an active
IronSuite session through the production Hub proxy.
