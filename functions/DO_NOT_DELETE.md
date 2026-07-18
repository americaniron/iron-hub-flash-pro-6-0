# Iron Hub Pages Boundary

Iron Hub is delivered inside IronSuite. The authenticated Suite Cloudflare
Worker owns email, AI, voice, data, and synchronization integrations. The root
Pages middleware rejects all direct `/api/*` traffic so this origin cannot
expose a provider proxy, SMTP relay, or unauthenticated database endpoint.

Do not add Pages API functions, provider credentials, or public integration
routes to this project. Integrations belong in `fixmyiron-suite-api`, where
authorization, tenant isolation, rate limits, and audit logging are enforced.
