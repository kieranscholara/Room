# Security boundary

The current application is deliberately a **local synthetic development demo**. No authentication, real tenant authorisation, RLS, private asset storage or customer share links are implemented. Do not use real customer, supplier or retailer records and do not deploy it publicly as a SaaS.

Implemented boundaries: strict operation schemas, server-enforced locks, server-owned proposals, version conflicts, immutable product metadata during transforms, same-origin browser mutation checks, no client secrets, bounded solver work, and atomic local writes. These do not replace authentication or database policies. The file adapter is single-process and has no shared database lock.

Phase 3 requires Supabase session validation on every server route, role checks, membership-based RLS and automated two-organisation attacks across API, SQL and storage. Never ship a service-role key to the browser. Private assets require organisation-scoped paths, signed URLs and validation. Add production request streaming/size limits, rate limiting, secure cookies, audit logging and export/deletion flows.

Commercial gates also require signed/idempotent Stripe webhooks, durable job tenancy, monitored backups/restores and documented retention. Provision credentials through secure environment settings; never source-code or chat. Production security and GDPR readiness are explicitly unverified.
