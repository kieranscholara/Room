# Roadmap

## First three development milestones

1. **Measured editor rules:** scene schema v2/v1 migration, confirmed rectangular measurements, openings and explicit clearance/circulation zones, rotated geometry, independent locks, rigid groups, deterministic bounded Smart/manual placement, preview/accept, undo/redo, revision comparison and snapping/guides.
2. **Accounts and tenant persistence:** Supabase Auth SSR cookies, organisations, owner/admin/salesperson/designer/customer roles, checked invitations/team changes, customers with explicitly scoped project access, RLS/composite tenant foreign keys and transactional scene versions/operations.
3. **Catalogue and customer projects:** real product/variant/inventory fields, bounded atomic insert-only CSV imports with errors/history, validated private images/models, customer contact CRUD, measured project creation, catalogue furniture insertion/removal, selected live prices/budget comparison and customer sharing controls.

Tests and actual execution outcomes are recorded in [TEST_PLAN.md](TEST_PLAN.md) and [VALIDATION.md](VALIDATION.md). These milestones are a development foundation, not a production rollout certification.

## Remaining work, in order

1. **Shared 3D viewer:** React Three Fiber consumes the canonical metre transforms; load validated models, disclose measured proxies, and test agreement with 2D geometry. Handle orientation, lighting, fallback/performance and representative retailer assets.
2. **AI and complete budgets:** provider abstraction, strict schema-validated layout intentions, catalogue-only suggestions and independent geometry/lock enforcement. Add explicit currency/tax/discount/shipping rules; keep current live estimates distinct from immutable prices.
3. **Sales proposals and customer review:** immutable issued item/price snapshots, proposal revisions, PDF output, approvals/comments and revocable restricted review links. Existing authenticated project sharing is not this sales approval workflow.
4. **Billing, durable jobs and commercial operations:** subscription limits, signed/idempotent Stripe webhooks, queues/retries/usage, larger async imports/assets, platform administration, monitoring, backups/restores, retention/export/deletion and deployment controls.
5. **Hosted pilot acceptance:** validate email confirmation/delivery, HTTPS cookies/proxy, database/storage policies, real retailer measurements/models, accessibility/device matrices and security/performance in staging.

Further product breadth includes non-rectangular and multiple rooms, automatic circulation assessment, full project metadata editing/lifecycle, catalogue replacement workflows, inventory reservation and integrations. Large queued imports require explicit conflict/idempotency policies; the current 500-row synchronous importer intentionally rejects existing SKUs.

Each later milestone needs running acceptance tests and review before release. No future screen should imply invented inventory, prices, analytics or AI capabilities. The original [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) remains the full target specification.
