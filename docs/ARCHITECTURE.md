# RoomSell architecture alignment audit

## Six-area application implementation — current

The existing modular monolith, 2D editor and scene v2 are preserved. No dependencies were added in this increment. The earlier audit and steps 1–4 checkpoint below remain historical evidence.

Actual additions are project-private references (`room-reference-service.ts`); durable leased jobs (`jobs-service.ts`, `worker-service.ts`); strict catalogue/budget advice (`assistant-contract.ts`, `ai-provider.ts`, `design-assistant-service.ts`); checked reservations/orders (`order-service.ts`); and explicitly published offers plus separately owned consumer projects (`marketplace-service.ts`). These paths are under `apps/web/lib`. Migrations 011–016 define their database authority and RLS.

AI workers use the same `projectEditor`/`EditorService` preview path as a human. They never accept scenes. Prices, stock, permissions, scene versions and locks are independently checked. Recommendations are estimates; an issued quotation remains the authoritative immutable commercial document.

Consumer designs use scene v2 with `organisationId: consumer:<auth-user-id>` and a separate owned persistence adapter. Retailer `organisationId` is still mandatory and unchanged. Both renderers and the existing editor operate on this same scene. Consumer 3D currently uses measured proxies. Only selected published product images have a public delivery route; private catalogue and room-reference buckets stay private. A consented enquiry copies only the selected retailer's objects into a new retailer project.

Operational implementation includes database health checks, authenticated cron execution, safe hosted cookie/origin configuration, a Vercel deployment configuration and verified local database-plus-asset backup/restore scripts. Vercel/Supabase projects, live OpenAI, SMTP delivery, hosted monitoring and hosted restoration have not been provisioned or verified. The target remains managed hosting; see [DEPLOYMENT.md](DEPLOYMENT.md).

Boreal Living is an explicitly fictional, local-only fixture with generated photographs and isolated accounts. Its simulated feed reconciles fulfilled quantities. Real snapshot-only connectors cannot fulfil externally managed stock until an upstream order acknowledgement adapter exists; migration 015 fails closed. No external POS order, payment, shipment, billing or notification is implied.

## Approved implementation update — 14 October 2026

The user approved implementation after the audit. The existing 2D editor, canonical schema v2 and one Next.js application remain in place. The historical audit against `660d52f887eb396506e76401145ee99e0a93de8d` is preserved below; statements in that snapshot describe the baseline, not the new implementation. Full combined build/database/browser gates are pending at the time of this update; current verification belongs in `VALIDATION.md`.

### Actual architecture after alignment

The modular monolith now has seven capability packages: scene-core, geometry, layout-engine, catalogue, ui, pricing and inventory. Pricing isolates actual shared financial calculations; inventory isolates the actual external-feed contract and transport boundary. Neither package changes the 2D editor or introduces another application.

```mermaid
flowchart LR
  Plan[Existing Konva 2D editor] --> Store[One accepted and preview scene store]
  Viewer[Derived read-only Three.js view] --> Store
  Store --> EditorAPI[Authorised scene API]
  EditorAPI --> Service[EditorService + project adapter]
  Service --> Pure[scene-core + geometry + layout-engine]
  Service --> DB[PostgreSQL checked RPCs and RLS]
  Catalogue[Catalogue and selected-product services] --> DB
  Catalogue --> Storage[Private validated product assets]
  Viewer --> Catalogue
  QuoteAPI[Pricing and quotation services] --> Pricing[Pure exact pricing engine]
  QuoteAPI --> DB
  QuoteAPI --> PDF[Snapshot-only PDF adapter]
  InventoryAPI[Manager inventory service] --> Inventory[Bounded custom REST adapter]
  Inventory --> Provider[Configured retailer feed]
  InventoryAPI --> DB
```

- `scripts/runtime-target.mjs` owns exclusive local/hosted Supabase selection and local test preflight. Local mode uses only verified loopback status; test setup refuses hosted bindings before writes. `supabase-config.ts` delegates to this policy.
- `demo-policy.ts` requires `ROOMSELL_ENABLE_DEMO=1` for the demo page, scene APIs and file adapter. Disabled deployments return 404. The existing shared demo remains explicitly opt-in and single-process. HTTP JSON parsing is bounded and shared.
- `editor-service.ts` persists solver compatibility, base-scene SHA-256 and approved-result SHA-256 in server-owned preview envelopes. Acceptance validates those values and compares deterministic recomputation before writing. Legacy/incompatible previews fail with 409; accepted scene data does not change format.
- `packages/catalogue/src/policy.ts`, `money.ts`, `models.ts` and `asset-policy.ts` supply shared DTOs, exact identity/availability predicates, null-preserving totals, exact currency formatting, matching-model resolution and byte/tolerance constants. SQL catalogue admission remains independent under the organisation lock.
- `packages/geometry/src/render-contract.ts` supplies right-handed scene transforms, Konva yaw conversion, plan coordinate round trips and floor-centre model offsets. `room-viewer-3d.tsx` derives the accepted or preview scene; `3d-model-runtime.ts` loads only authorised project assets, rejects external model resources, remeasures actual geometry and releases resources. Missing, stale, incompatible, over-budget or failed models use labelled dimension proxies. Meshes retain measured dimensions within documented export tolerance; no silent scale is applied. WebGL failure leaves the working 2D view available.
- `packages/pricing/src/index.ts` computes explicitly supplied retailer rules using BigInt, half-up rounding and stable allocations. `quotation-service.ts` obtains current authorised source data, computes prices and binds issuance to a reviewed source fingerprint. `quotation-schemas.ts` verifies snapshot consistency; `quotation-pdf.ts` renders saved snapshots, not current catalogue prices.
- `packages/inventory` implements one real custom REST feed contract, external/internal mappings, bounded freshness/replay checks, authenticated HTTPS transport and encrypted credentials. `inventory-service.ts` orchestrates manager-only manual sync. Migration 009 applies complete mapped snapshots atomically, serialises with scene/catalogue writes, records sanitised outcomes and preserves physical scene/catalogue identities.

### Authority and operational limits

Scene commits continue through the existing domain validation/persistence path. Quotations and connector reconciliation have separate checked SQL transactions: they do not submit replacement scenes. Issued quotes snapshot retailer/customer/project/source/policy/calculation and explicitly declare `inventoryReserved: false`. Placement still checks per-variant availability; quote issuance checks aggregate selected quantities without creating reservations.

The current connector needs an actual retailer endpoint and credentials matching the documented contract. Its full mapped feed is limited to 1 MiB/1,000 items, rejects snapshots over 15 minutes old, and requires all mappings exactly once. Public HTTPS transport uses pinned validated DNS addresses with 5-second DNS/15-second total limits. Connector credentials require `ROOMSELL_CONNECTOR_ENCRYPTION_KEY`; no credentials are returned to clients. It is not an integration with every POS/ERP vendor. Sync is manual and synchronous; there is no scheduler, durable job worker or reservation/order pipeline. Hosted operations, email confirmation/proxy trust, backups and production limits still need staging verification. PDF standard-font coverage is limited and replacement characters are disclosed; original snapshot text remains intact.

### Remaining proposed target architecture

AI recommendation/intention adapters, private room-reference photographs, durable jobs and consumer marketplace ownership/publication remain future work. They must use the existing scene preview/commit and authorised catalogue boundaries. A worker should be added for a real durable processing need; its scene writer must reuse domain validation. No separate scene engine, weakened tenant scope or editor rewrite is proposed.

## Baseline audit snapshot — historical

Audited 14 October 2026, against commit `660d52f887eb396506e76401145ee99e0a93de8d`. This audit changes documentation only. Application code, schemas, dependencies and working 2D behaviour remain unchanged. Proposed changes require approval.

### Actual architecture

The repository is already a TypeScript npm workspace with one Next.js application and five small packages. Keep this arrangement; creating another application or replacing the editor is unnecessary.

```mermaid
flowchart LR
  UI[React workspace and Konva 2D editor] --> Store[Zustand editor state]
  Store --> API[Next.js route handlers]
  API --> Auth[Supabase Auth and current membership]
  API --> Service[EditorService]
  Service --> Domain[scene-core + geometry + layout-engine]
  Service --> Adapter[Project persistence adapter]
  Adapter --> DB[PostgreSQL checked RPCs + RLS]
  API --> Catalogue[Catalogue and selected-product services]
  Catalogue --> Validation[Catalogue schemas + image/model validation]
  Catalogue --> DB
  Catalogue --> Storage[Private Supabase Storage]
  Service --> Demo[Separate single-process demo file adapter]
```

#### Modules and authority

- `packages/scene-core/src/index.ts` defines strict scene schema v2, v1 migration, operations, relationships and exact lock comparisons. Coordinates and dimensions are metres; rotation is radians about +Y.
- `packages/geometry/src/index.ts` contains pure oriented footprints, SAT collision tests, wall/ceiling checks, opening envelopes, distance guides and wall snapping.
- `packages/layout-engine/src/index.ts` contains pure deterministic manual and bounded Smart rearrangement, rigid groups and soft followers. It has no provider, network, React or pricing dependency.
- `apps/web/components/floor-plan.tsx` draws the scene and converts pointer/display coordinates. `editor.tsx` provides controls. `apps/web/lib/editor-store.ts` owns accepted/preview state and request-generation protection.
- `apps/web/lib/editor-service.ts` orchestrates preview, recomputation, locks, validation, accept and undo/redo through a persistence port. It is dependency-light TypeScript but currently lives inside the web app and uses Node crypto.
- `apps/web/lib/project-service.ts` supplies verified project access, catalogue-add checks and request-scoped Supabase persistence. `local-persistence.ts` supplies the separate demo adapter.
- `apps/web/lib/catalogue-service.ts`, `project-catalogue.ts` and `packages/catalogue` implement retailer records, bounded imports, validated assets and live selected-product prices.

#### Actual edit transaction

1. A client submits an operation and expected scene version, not a replacement scene.
2. Project routes authenticate through `auth.getUser()` and check current membership/project access.
3. Scene schemas, catalogue identity checks and the layout engine validate a preview. The accepted scene remains unchanged.
4. Acceptance loads the actor's saved preview, repeats catalogue checks and recomputes the operation.
5. The domain service checks locks, identity/dimensions and geometry before persistence.
6. PostgreSQL `commit_scene` locks the organisation and scene, repeats edit authority and version checks, and checks new catalogue-object metadata under the catalogue write lock.
7. One transaction stores the new scene, room projection, version/audit rows and undo/redo stacks, and removes obsolete previews.

The service-role client is a trusted server boundary. SQL does not independently implement all geometry or lock rules. Authenticated users cannot invoke the service-only scene commit directly. Future workers must use the same validated orchestration rather than bypassing it with arbitrary scene JSON.

#### Actual persistence and security

Project scene JSON is authoritative; scalar room columns are a transactional projection. Undo/redo restores complete snapshots, including locks, while increasing the current version. Stacks are bounded at 100 each; the API returns 100 revisions. Database history rows persist separately. Project previews are actor-scoped and expire after 15 minutes. The demo adapter has one process-local queue and in-memory previews; it is not a multi-server datastore.

Auth uses request-scoped SSR clients and HttpOnly, SameSite=Lax cookies. Secure cookies depend on a trusted HTTPS forwarding header. RLS, explicit grants and composite tenant foreign keys protect relational records. Role/access revocation serialises with sensitive organisation transactions. Customer contact records do not confer account access; customer members receive explicit project grants.

There are seven SQL migrations under `supabase/migrations`. Product/variant writes and imports are atomic service-only RPCs with actor rechecks. Assets are validated before private storage, then registered with authority/dimension checks. Application asset routes recheck access; project customers receive only selected-product assets.

The local runtime has a confirmed configuration ambiguity: `supabase-config.ts` reads local status when the local flag is set, but still prefers separately supplied hosted environment bindings. See risk R1. The existing claim that a local flag alone forces test isolation is therefore too strong.

#### Features that are absent

No 3D renderer, AI provider/intention adapter, inventory connector, reservation system, room-reference-photo domain, issued quotation/PDF engine, durable job infrastructure or consumer marketplace exists in the audited application. Validated model uploads currently provide downloads. Smart rearrangement is deterministic search. Budget UI is a current catalogue subtotal, without taxes, discounts or immutable quotation pricing.

### Proposed target architecture — not implemented

Retain a modular monolith: the existing Next.js app, pure scene/geometry/layout packages, PostgreSQL/Auth and private storage. Add modules only for concrete capabilities and add a worker only when durable processing is required. Initial 3D needs no scene rewrite: render the same accepted or preview scene through a second adapter.

```mermaid
flowchart LR
  Views[2D and future 3D views] --> Scene[One canonical scene and preview state]
  Scene --> Commands[Authorised scene application service]
  AI[Future validated AI intentions] --> Commands
  Commands --> Geometry[Existing geometry and layout engines]
  Commands --> Persistence[Versioned checked persistence]
  Connectors[Future retailer connectors] --> Catalogue[Authoritative catalogue and inventory]
  Catalogue --> Commands
  Catalogue --> Pricing[Pure pricing rules]
  Pricing --> Quotes[Immutable issued quotations]
  Photos[Private room references] --> Jobs[Tenant-scoped durable jobs]
  Jobs --> AI
  Jobs --> Commands
  Marketplace[Future consumer discovery and design spaces] --> Published[Explicit published retailer offers]
```

- **Scene/rendering:** preserve v2 metre coordinates, ground-centred pivots and rotation semantics. 3D meshes/proxies are derived views, never a second editable source of truth.
- **Catalogue/inventory:** keep internal UUIDs stable; introduce provider-scoped external IDs, freshness, reconciliation and idempotent ingestion. Quantity/reservation policy belongs here, not in renderers.
- **Pricing/quotations:** use exact minor-unit arithmetic and explicit retailer tax/discount/delivery rules. Persist issued item/pricing snapshots separately from mutable catalogue prices and scene undo history.
- **AI/photos:** store references with project-scoped access. AI proposes validated intents against real authorised candidates. It cannot invent SKUs, dimensions, prices, locks or trusted room measurements. Human approval uses the ordinary scene preview/commit path.
- **Jobs:** queue records carry tenant/project/actor identity, idempotency and retry state. Recheck permissions and versions at execution/commit. Extract shared scene orchestration only when a second backend consumer exists; keep the editor unchanged.
- **Marketplace:** introduce explicit consumer ownership and retailer publication permissions. Do not make existing tenant fields optional or weaken private catalogue RLS.

Read [CURRENT_STATE.md](CURRENT_STATE.md) for evidence, [SCENE_CONTRACT.md](SCENE_CONTRACT.md) and [INVARIANTS.md](INVARIANTS.md) for contracts, [MODULE_OWNERSHIP.md](MODULE_OWNERSHIP.md) for boundaries, [ARCHITECTURE_RISKS.md](ARCHITECTURE_RISKS.md) for risk severity, and [ALIGNMENT_PLAN.md](ALIGNMENT_PLAN.md) for sequenced tasks. Major choices are proposals in [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md), not approved implementations.
