# Module ownership and dependency boundaries

## New concrete capability owners

| Files (under `apps/web` unless stated)                                                  | Responsibility                                                                                         | Authority boundary                                                                                    |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `lib/assistant-contract.ts`, `ai-provider.ts`, `design-assistant-service.ts`            | Bounded AI intentions, provider transport, catalogue/budget checking and checked preview orchestration | Cannot invent metadata, unlock or accept a scene.                                                     |
| `lib/jobs-service.ts`, `worker-service.ts`, `scripts/worker.mjs` at root                | Tenant-scoped queue, leases, retries, permission checks, storage cleanup, expiry and execution         | Internal worker route requires a server secret; database lease is mandatory.                          |
| `lib/room-reference-service.ts`                                                         | Private project photographs and lifecycle                                                              | Reuses full image validation; current project access governs bytes.                                   |
| `lib/order-service.ts`, migrations 012/014/015                                          | Snapshot orders and serialized stock reservations/transitions                                          | SQL owns stock arithmetic and order permission; no payment or upstream acknowledgement is invented.   |
| `lib/marketplace-service.ts`, consumer and marketplace routes                           | Explicit public DTO, publication, separately owned consumer persistence and consented enquiry          | Existing tenant catalogue policies remain private.                                                    |
| `lib/local-testing.ts`, root `scripts/seed-test-customer.mjs`, `fixtures/boreal-living` | Explicit fictional local customer, generated images and stock simulator                                | Fail closed outside verified local mode; never seed arbitrary existing tenants.                       |
| Root backup/restore scripts, `vercel.json`, `lib/public-origin.ts`, health route        | Repeatable operations and managed hosting preparation                                                  | Local restore targets a new temporary database/bucket; hosted rollout requires separate verification. |

## Approved implementation ownership — 14 October 2026

The existing application/modules are retained. The historical baseline below records the overlaps found before approval. Their current ownership is now:

| Module                                                    | Owns now                                                                                                     | Boundary                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `packages/catalogue/src/policy.ts`                        | Shared DTO views, catalogue availability/identity checks, selected-project DTO                               | No auth/database/network access; independent SQL admission remains required.                                 |
| `packages/catalogue/src/money.ts`                         | Null-preserving exact totals, safe decimal input/display, currency precision                                 | No mutable price lookup or quote issuance.                                                                   |
| `packages/catalogue/src/models.ts`, `asset-policy.ts`     | Matching variant/parent model policy, measured bounds, shared limits/tolerance                               | No mesh decoder, WebGL lifecycle or saved-scene mutation. Server byte validation remains `catalogue/assets`. |
| `packages/geometry/src/render-contract.ts`                | Canonical-to-view axes, yaw, plan coordinates, model floor-centre pivot                                      | No Three/React dependency; pure transforms shared with renderers.                                            |
| `room-viewer-3d.tsx`, `3d-model-runtime.ts`               | Derived read-only display, camera/resources, authorised asset loading, defensive decode/measurement/disposal | No authoritative collision/lock decision, second scene store or direct scene writes.                         |
| `packages/pricing/src/index.ts`                           | Explicit versioned financial policy, aggregation, exact rounding/allocation, recomputable calculations       | No catalogue retrieval, tax-jurisdiction inference, reservations or PDF presentation.                        |
| `quotation-service.ts`, `quotation-schemas.ts`            | Authorised current source, reviewed-source checks, issuance/idempotency, immutable snapshot DTO/integrity    | No invented SKU/prices; issued records are separate from scene undo history.                                 |
| `quotation-pdf.ts`                                        | PDF presentation of a verified issued snapshot                                                               | Never reads live prices; font replacement is disclosed.                                                      |
| `packages/inventory/src/index.ts`                         | Provider feed/mapping contract, bounded validation, freshness and external-to-internal mapping               | No scene edits or retailer identity invention.                                                               |
| `packages/inventory/src/server.ts`                        | Authenticated encrypted tokens, SSRF-resistant pinned HTTPS transport                                        | Server-only capability; no credential values in browser DTOs/logs.                                           |
| `inventory-service.ts` and migration 009                  | Verified manager orchestration, checked atomic reconciliation, audit/freshness/revision persistence          | No durable scheduler, unvalidated provider body writes or product geometry/SKU rewrites.                     |
| `runtime-target.mjs`, test preflight and `demo-policy.ts` | Exclusive runtime targets, fail-closed local tests and explicit demo exposure                                | No resetting hosted retailer data or silent production demo enablement.                                      |

Dependency direction remains presentation → application services → pure domain packages/persistence adapters. Geometry still depends only on scene-core; layout-engine still depends on geometry/scene-core. Catalogue's shared client policy is independent of its server-only sharp/glTF validator subpath. Pricing uses Zod only; inventory's Node transport/crypto stays behind `@roomsell/inventory/server`. Web viewer and PDF libraries belong to their concrete presentation adapters.

The equivalent TypeScript catalogue predicates/DTOs/totals are consolidated. The independently checked SQL policy remains deliberate defence, rather than a copy to remove. Large UI components may still be extracted later behind acceptance tests; no replacement of the working editor is justified. AI, private room-reference records, durable jobs and marketplace permissions remain future owners.

## Baseline module register — historical

Ownership means responsibility in code, not an assignment to a particular employee. Existing modules remain in place. Proposed future modules have no implementation yet.

| Module                                       | Owns today                                                                                 | Must not own                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| packages/scene-core                          | Scene/operation schemas, migration, identifiers, lock comparisons                          | React state, pixels, provider calls, database reads, financial calculations                   |
| packages/geometry                            | Footprints, rotations, SAT, architecture envelopes, guides/snapping                        | Tenant permissions, SKUs/prices, UI components or AI decisions                                |
| packages/layout-engine                       | Pure deterministic manual/smart proposals, groups/followers, search budgets                | Network/database writes, LLM calls, price ranking or catalogue mutation                       |
| packages/catalogue (index)                   | Product/variant/asset contracts, bounded CSV parsing, exact price conversion/total helpers | Auth cookies, arbitrary provider credentials or quote issuance                                |
| packages/catalogue/assets                    | Server-side full image/model byte validation and measured model bounds                     | Browser renderer state or silently changing catalogue dimensions                              |
| packages/ui                                  | Accessible shared controls                                                                 | Scene authority, retailer business rules                                                      |
| apps/web/components + editor-store           | Presentation, selection, viewport, accepted/preview UI state, request scoping              | Authoritative collision/lock decisions, direct SQL or service secrets                         |
| apps/web/lib/editor-service                  | Application orchestration and persistence port                                             | Framework-specific rendering; bypassing pure validation or trusting returned client proposals |
| project-service                              | Verified project context, authoritative catalogue add admission, Supabase adapter          | General AI inference or retailer connector-specific parsing                                   |
| catalogue-service / project-catalogue        | Tenant-scoped catalogue CRUD/import/assets and selected-price/asset resolution             | Historical quote totals, reservation guarantees or consumer public discovery                  |
| supabase-server / http-api / supabase-config | Verified identities, SSR cookies, private clients, HTTP validation, runtime bindings       | Geometry algorithms or anonymous cross-tenant access                                          |
| supabase/migrations                          | Relational integrity, RLS/grants, atomic CAS and current authority/catalogue checks        | Full independent geometry duplication or UI-specific workflow state                           |
| scripts + CI                                 | Local service/migration/test setup and safe targets                                        | Resetting retailer data, sourcing production credentials into tests                           |

Allowed current dependency direction is UI → app services → pure packages/persistence adapters. Within pure packages: layout-engine → geometry → scene-core. Catalogue contracts are parallel to scene geometry; server-only asset validation stays behind its separate subpath. No React/Next/database/AI dependency should be added to geometry or layout-engine.

### Existing ownership overlaps to consolidate safely

- `workspace-business-types.ts` repeats catalogue DTO interfaces already present in `packages/catalogue/src/index.ts`; use type imports/Pick where payloads are intentionally narrower.
- Catalogue-object identity/availability checks repeat across project-service, project-catalogue and project-editor. Put a pure predicate/selection contract in the existing catalogue package, but retain an independent under-lock SQL guard and parity tests.
- `project-catalogue.ts` sums money separately from `catalogueTotalMinor`; share arithmetic only after preserving null/unknown, currency, overflow and API output semantics.
- The demo route duplicates HTTP origin/content/error validation, and reads all request text before its size check. Reuse a bounded reader with response-contract tests, not a blind handler replacement.
- Large UI files combine loading, forms, catalogue placement, budgeting and sharing (catalogue-panel 847 lines; editor/project-editor 574/576). Extract subcomponents/hooks one at a time after user-flow tests; size alone is not a reason to rewrite the editor.

### Future ownership proposals

Inventory adapters map external records into canonical retailer IDs and reconcile stock; pricing computes explicit pure retailer rules; quotations own immutable issued snapshots; AI converts provider responses to bounded domain intents; room references own private project photos; durable jobs own execution/retry/idempotency and tenant authority; marketplace owns explicit publication and consumer design ownership.

A future worker is a concrete reason to extract shared application orchestration into a small package. Do not move EditorService into scene-core if doing so creates a scene-core → layout-engine → scene-core dependency cycle. Keep its existing port now; approve placement when a second runtime actually needs it. New services/packages/dependencies require a capability justification, not organisational preference.
