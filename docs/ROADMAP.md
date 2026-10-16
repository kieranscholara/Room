# Architecture-aligned roadmap

Status: 16 October 2026. The user confirmed a salesperson-operated photo consultation with a short measured calibration. The visible 2D section is removed; retailer projects are photo-only and legacy demo/personal rooms use 3D. Scene v2, geometry, locks, tenant isolation and checked saving remain the foundation. Earlier delivery milestones below are retained as implementation history; current results belong in VALIDATION.md.

## Photo-first selling MVP

Implemented in the existing app: photo upload; reviewed visible-object scan; confirmed room measurements/floor calibration; catalogue additions and reviewed catalogue/photo removals in **Complete the room**; actual SKU click/drop placement, immediate dragging/rotation and checked acceptance; local client design confirmation before quotation. Original-image cleanup remains a separately reviewed background edit. No dependencies or migrations are added for this consultation increment. See [PHOTO_SELLING.md](PHOTO_SELLING.md).

The next MVP gates are: run the current automated acceptance suite; test a real measured room with approved product models and live OpenAI; validate the chosen retailer's catalogue, commercial policy and real inventory contract; complete managed hosting/SMTP/backups/alerts gates before public use. The local confirmation is deliberately a session checklist; durable customer approval/signature is a separate requirement. Automatic depth/silhouette segmentation, lens correction, video/AR and guaranteed whole-room recognition remain future scope.

## Actual foundation

Implemented: strict metre-based scene v2/v1 migration; pure rotated geometry and bounded deterministic layout; object/group locks, openings, marked circulation, preview/accept/history; Next.js photograph consultation; real Supabase accounts, tenant RLS and checked scene commits; products/variants, bounded atomic CSV import, validated private product assets; customer contacts, measured projects, live catalogue subtotals and restricted customer sharing. Legacy Konva code remains unmounted rather than requiring a risky domain rewrite.

Added after approval: exclusive runtime/test targets, explicit demo gate, preview compatibility fingerprints, shared catalogue/render contracts and exact currency display; synchronized read-only 3D with validated models/proxies; configured exact pricing, immutable quotations/PDFs; encrypted custom REST inventory connectors with stable mappings, atomic reconciliation and freshness.

The six-area increment adds private references, bounded AI intentions/OpenAI transport, durable jobs, reservations/orders, deployment/restore tooling and separate consumer ownership/publication. Supplier fulfilment now supports the optional custom REST acknowledgement contract, exercised with Boreal Living. See CURRENT_STATE.md and TEST_CUSTOMER.md. Remaining external work: actual retailer/provider acceptance, securely configured OpenAI credentials, Vercel/Supabase projects, SMTP/alerts and hosted restore. These cannot be established by fictional supplier tests.

## Delivery sequence

1. **Implemented — safety before expansion:** A01 exclusive test/runtime database targets, A02 public demo isolation/bounded requests, A03 durable preview/result compatibility. The first three issue drafts are in [GITHUB_ISSUES.md](GITHUB_ISSUES.md).
2. **Implemented — small behaviour-preserving consolidation:** A04 shared catalogue DTOs/predicates and exact money arithmetic, with separate A04b currency-display boundary correction, followed by A05 renderer/asset contract characterisation. Keep SQL transaction admission defence and all current editor acceptance tests.
3. **Implemented — shared 3D:** approved model/pivot/tolerance/dependency decision and A06 derived read-only viewer on the current scene/store. No separate scene engine or schema rewrite for initial floor-based 3D.
4. **Implemented — commercial correctness:** A07 pure configured retailer pricing, then immutable quote snapshots and document rendering. A08 custom REST snapshot adapter with stable ID mapping, atomic reconciliation and freshness. Quote quantities are checked in aggregate; reservation is an explicit subsequent order action. A retailer feed and secure credentials must be configured before live operation.
5. **Implemented locally — room references and durable execution:** A09 project-private photographs, lifecycle/retention and tenant jobs; extract shared command orchestration only for the concrete worker consumer.
6. **Implemented with live acceptance pending — AI-assisted recommendations/design:** A10 strict bounded intents and fake adapter tests, then a justified provider implementation. Resolve only authorised real catalogue candidates, respect stock/budget/geometry/locks and require ordinary preview acceptance. Never infer confirmed measurements automatically.
7. **Prepared; external provisioning pending — hosted staging/operations:** A11 begins alongside the safety work and gates public rollout. Test Auth/email/proxy, resource limits, monitoring, DB/asset restore and physical retailer acceptance.
8. **Implemented bounded workflow — consumer marketplace:** A12 starts with ownership/publication decisions and threat modelling, then independently scoped features. Preserve private retailer isolation rather than making tenant identity optional.

The complete per-task files, rationale, risks, dependencies, tests, acceptance and complexity are in [ALIGNMENT_PLAN.md](ALIGNMENT_PLAN.md). Accepted and deferred decisions are in [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md); quality gates are in [QUALITY_GATES.md](QUALITY_GATES.md).

Later breadth includes non-rectangular/multiple rooms, vertical placement/free rotations, full project lifecycle, payments/shipping and additional provider integrations. Each is a separate requirement/migration decision, not a reason to rewrite the present editor. Original product scope remains in [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md).
