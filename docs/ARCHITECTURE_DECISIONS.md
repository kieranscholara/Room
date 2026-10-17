# Architecture decision proposals

## ADR-007 — Edit the actual photograph with retailer image pixels

**Accepted:** The user's explicit approval to build the photographic replacement plan supersedes the retailer model-overlay presentation. Preserve the application, pure metric engine and financial authority. Add no dependencies.

**Decision:** Use Canvas 2D image cutouts with alpha-only masks, supplied catalogue image views and measured placement. Preserve source photographs; reviewed polygon/brush removal is a distinct image job. Export an exact PNG through durable jobs; optional consented AI contact lighting cannot repaint catalogue product pixels. Keep composition revisions separate from canonical scene v2. Require staff-confirmed current image proof for composition-backed quotations and retain image/hash/layers/actor in immutable evidence and PDF.

**Alternatives/tradeoffs:** A 3D product viewer does not meet the requested photograph-only workflow. Unconstrained generative furniture replacement can change the advertised product. Single-image cutouts preserve product identity but cannot invent unseen surfaces or certify volumetric visual fit; suitable supplied views and human review are required. Full scene/depth reconstruction is separate future scope.

**Evidence:** Migrations 020–022, composition/mask/renderer services, real database proof/tenancy cases and WebGL-disabled photographic replacement browser acceptance. Generated fixtures have recorded selections and assumed measurements. Live OpenAI quality and physical-room verification remain external gates.

## D-PHOTO-CONSULTATION — salesperson-operated photo-only workflow (16 October 2026)

**Accepted direction:** The owner explicitly removed the need for a visible 2D section and confirmed that the salesperson operates the app with the client, retaining a short measured floor calibration. This supersedes earlier keep-2D user-interface requirements; it does not authorise removing canonical metric validation.

**Decision:** Open retailer projects directly in the photograph workspace and use 3D only for legacy demo/personal rooms. Stop mounting the old Konva adapter while preserving scene v2, pure geometry/layout, locks, tenant access and checked preview/accept. Guide upload/scan/measurement, catalogue-grounded completion, explicit SKU placement and client review before quote. Advice can propose removal of existing scene objects and keep/remove actions for known reviewed photo regions; image cleanup remains a separately accepted background edit. No new dependency or migration is required.

**Review boundary:** Bind a local design-confirmation checklist to the current scene, photo revision and loaded chosen-product details. Invalidate it on change or reload. Gate new quotation controls while retaining issued history and all existing backend source/version, price/stock and permission checks. This does not create a persisted customer signature or alter quotation authority.

**Tradeoff/acceptance:** A single photo cannot establish all objects, depth or exact measurements. Keep human detection review, measured calibration/obstacles and model/proxy labels. Validate photo-only consultation, SKU choice, lock/collision preservation, stale advice/review and quotation history. Live OpenAI and real retailer/physical-room acceptance remain separate gates. Executed results belong in VALIDATION.md.

## ADR-005 — Durable supplier acknowledgement before externally managed fulfilment

**Accepted scope:** The user's 16 October 2026 request authorizes completing the local MVP with a fictional supplier. Retain the existing order service/database and add an optional custom REST fulfilment contract. No new package dependency or provider-native API is required.

**Decision:** Persist a frozen request under the retailer transaction before sending. Pin mapped external identities, quantities, order UUID and request hash. Require a same-origin HTTPS endpoint, encrypted credential, strict matching terminal receipt and supplier-side idempotency. Commit acknowledgement, stock and order status atomically. Definitive rejection leaves stock unchanged; unknown outcomes retain a cancellation/configuration/stock fence and recover by retrying the original key. Only one supplier connection per order is supported initially. Snapshot-only feeds remain read-only.

**Tradeoff:** Availability is reduced while a supplier outcome is unknown. Retrying the same request and alerting after five minutes is safer than generating another vendor order or releasing stock prematurely. A permanently unavailable vendor requires operator reconciliation; no automatic fence bypass is exposed. Boreal Living is a labelled in-process substitute, not proof of a real vendor's idempotency.

**Evidence:** Migrations 017–018, supplier schemas/transport, order service, fixture supplier ledger and unit/database/browser acceptance. Alternatives such as distributed two-phase commit, multi-supplier compensation or vendor-native APIs are separate scope. Existing scene/pricing snapshots remain unchanged.

ADR-001–003 were accepted by the user’s implementation approval on 14 October 2026. The existing app, workspace and scene contract are retained. ADR-004 was accepted by the subsequent explicit six-area implementation request. Its initial publication/consumer ownership workflow is now implemented and locally tested in migrations 013/016; hosted rollout remains gated.

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

## D-PHOTO — approved still-photograph selling view (16 October 2026)

**Context:** The owner clarified that the main consultation is a salesperson placing actual inventory into a client's photograph, with immediate movement and authoritative product dimensions. They confirmed a still image and manual measurements/floor marking. The previous reference-only photo domain did not satisfy this workflow.

**Decision:** Retain scene v2 and the existing editor; add a calibrated transparent Three.js furniture renderer over a private image. Recover a pinhole camera from four measured floor corners. Reuse the safe original-size catalogue model loader, pure geometry and ordinary preview/accept operations for every committed edit. Save calibration/regions/background in a separate revisioned photo workspace. No new dependencies or second scene engine.

**AI boundary:** Structured vision proposes approximate image selections; existing catalogue-grounded design assistance handles recommendations for explicitly chosen consented photos. Masked removal runs in the durable worker, preserves the original and composites only reviewed pixels. Exact source revision, tenant access, quota and leased completion govern application. A registered synthetic known-camera image and illustrative GLBs provide an honest local demo without a key.

**Tradeoffs:** Camera assumptions, manual marking and measurement error limit visual accuracy; no automatic depth/room measurement is claimed. Retained furniture needs measured obstacle footprints. Rectangular foreground regions are manual aids, not segmentation. AI removal is asynchronous; dragging is local. Manufacturer models, a physically measured client room and live OpenAI quality/latency remain acceptance requirements. Video/AR and automatic reconstruction are separate proposals.
