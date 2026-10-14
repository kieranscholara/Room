# Architecture decision proposals

ADR-001–003 were accepted by the user’s implementation approval on 14 October 2026. The existing app, workspace and scene contract are retained. ADR-004 remains a future marketplace design proposal; no marketplace/publication schema was introduced.

## ADR-001 — Keep the existing modular monolith; extract orchestration only for a real worker

**Evidence:** Pure scene/geometry/layout packages already exist. EditorService has a persistence port but lives in `apps/web/lib/editor-service.ts`; there is one deployed app and no durable worker.

**Proposal:** Keep Next.js APIs, Supabase and the existing workspace. Define tenant-scoped job needs first. When a worker becomes a concrete second consumer, extract the validated command orchestration and ports into a small shared backend module/package with injected identity/time/ID interfaces where needed. Keep renderers and vendor clients in adapters.

**Alternatives:** Immediate microservices, a replacement app or a large framework rewrite add operational/contract risk without an existing consumer. Moving orchestration into scene-core creates a dependency-cycle risk because layout-engine already imports scene-core.

**Acceptance before extraction:** HTTP and worker paths run the same lock/geometry/version/catalogue admission tests; service-role jobs cannot bypass them. Existing API payloads, undo/redo and 2D workflows remain unchanged. Choose a queue/runtime only from actual duration/retry/operating requirements.

## ADR-002 — One scene, derived 3D renderer and explicit model fidelity

**Evidence:** Geometry already uses Three.js-compatible right-handed +Y yaw; Konva negates it for screen rotation. Scene v2 has metres, dimensions, y=0 ground anchors and one yaw. Models are validated/downloadable with measured world bounds, but are not normalised/rendered. Asset dimensions tolerate max(2 cm,2%).

**Proposal:** Keep v2 for the initial floor-based 3D viewer. Use the accepted/preview scene as the single store. Convert model origin to the canonical floor-centre pivot in a rendering adapter. Prefer a validated matching variant asset; reject an incompatible product-level fallback and display an explicit measured proxy. Decide whether tolerances warrant a visible warning or a documented rendering adjustment; never silently alter canonical dimensions to fit a mesh.

**Dependency justification:** Existing Konva renders 2D; a mesh-based WebGL viewer needs a 3D engine. Three.js is a candidate for scene/model loading; React Three Fiber is optional for integration with existing React. Installed Three.js 0.186.1 and React Three Fiber 9.8.1 after approval and React 19 peer checks; only the 3D view loads these modules. No additional convenience/control/decoder packages are justified yet; unsupported compressed assets currently remain rejected.

**Acceptance:** Actual renderer-projection parity tests, pivots, y-height, yaw, proxy labels, asset association, shared previews/history and mobile memory/fallback tests. Non-rectangular rooms, arbitrary vertical placement/pitch/roll and multi-room ownership are separately versioned decisions.

## ADR-003 — Separate live estimates from immutable quotation pricing

**Evidence:** Current subtotal reads mutable variant prices with exact integer arithmetic; scene history contains no issued commercial prices. There are no tax/discount/delivery rules, quotation entities/PDFs or inventory reservations.

**Proposal:** Reuse/consolidate current money primitives. Introduce explicit retailer policy for currency precision, tax inclusion/rates, line/invoice rounding, discounts and delivery. Issue immutable tenant-scoped snapshots referencing scene revision and catalogue identity/revision, with idempotent issuance. Render PDFs from those snapshots, not live catalogues.

**Alternatives:** Adding prices directly to mutable scene JSON or generating PDFs from current subtotal makes historical quotations unstable. Floating point money or inferred jurisdiction/tax defaults are unacceptable. Existing BigInt arithmetic avoids a new numeric dependency initially.

**Acceptance:** Currency/rounding/overflow tests, catalogue changes after issuance, duplicate/concurrent issue, restricted customer access and aggregate stock policy. pdf-lib 1.17.1 was justified and installed for authenticated server PDF rendering from immutable snapshots. Pricing uses existing BigInt/Zod without numerical dependencies.

## ADR-004 — Consumer design ownership and explicit retailer publication

**Evidence:** All current scenes/projects/private catalogues are retailer-organisation scoped; no consumer design-space or public-offer model exists.

**Proposal:** Design a separate consumer-owned design space and explicit published retailer-offer permissions when marketplace requirements are concrete. Stable retailer/product/variant references and consent/publication revocation precede cross-retailer recommendations. Keep current tenant-scoped commercial projects private.

**Alternatives:** Making organisationId optional, exposing all catalogues or treating a guessed SKU as a public reference breaks existing security invariants. Forcing every consumer into a fake retailer organisation hides ownership rather than defining it.

**Acceptance:** Ownership/publication/revocation threat model, consumer and retailer read/write matrices, stable references, pricing provenance and staged schema/migration tests before any public feature. No marketplace schema or publication access-policy change is included in steps 1–4.
