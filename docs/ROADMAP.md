# Roadmap

Milestone 1 combines Phase 1 foundation and Phase 2 measured editor: TypeScript monorepo, versioned schema, pure geometry/layout, CI, interactive Konva floor plan, server locks, Smart/manual modes, preview/accept, monotonic revisions, undo/redo, local persistence and acceptance tests.

Next bounded tickets, in priority order:

1. Review and strengthen editor gate: measure solver time on larger scenes, add explicit rigid group semantics, conservative circulation clearances, architectural editing and complete touch drag regression tests.
2. Supabase Auth and organisations: migrations, membership roles, tenant-aware repositories and real cross-tenant SQL/API/storage tests. Remove the unauthenticated file adapter from real deployments.
3. Catalogue and customer projects: validated products/variants, CSV row errors/idempotency, accurate dimensions, availability and organisation-scoped project operations.
4. Shared 3D viewer: React Three Fiber consumes the identical canonical scene; model asset validation and clearly disclosed proxies; geometry agreement tests.
5. AI and budgets: provider abstraction, strict intents, catalogue-only choices, integer minor-unit pricing and independent constraint checks.
6. Proposals/customer review: immutable issued snapshots, approval, PDF revisions and revocable restricted links.
7. Billing/jobs/production: Stripe subscriptions, durable job retries/usage, monitoring, backup/retention, performance and pilot security review.

Do not start major work on a later phase until the preceding running milestone passes its acceptance gate. No later-phase screens should present invented inventory, prices or analytics.
