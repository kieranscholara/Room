# Architecture quality gates

## Current photograph image-editing gates — 17 October 2026

- Alpha-only background/brush/outline operations preserve source RGB and restore original alpha. Cleanup preserves every unselected source pixel, including non-square/EXIF-oriented photos. Rugs map real product pixels onto the floor; envelope projection never changes metric dimensions.
- Composition DB cases reject cross-tenant assets, forged object/product associations, incomplete/duplicate layers, direct writes, stale source revisions, CAS races, unfinished/stale renders and customer confirmation.
- Quotation DB cases require confirmed current image proof, pin exact image/hash/layers/staff attribution and prevent deleting quoted source/final references; legacy quote financial/stock/permission cases still pass.
- Browser acceptance replaces an original object in the actual photographic fixture, chooses/moves a real SKU image, saves/reloads its render and issues a photo-bearing PDF with WebGL disabled. Missing images cannot silently become generic product boxes. Existing inventory, layout locks, pricing, auth, orders and consumer tests remain.
- CI retains lint, strict types, format, unit/property, real local integration, production build and browser checks. Never run concurrent local workers against acceptance-test jobs. Live provider image quality and a measured customer room are separate acceptance checks.

## Current photograph consultation gates

Retailer projects must open directly in the photograph workspace with no visible 2D section; legacy demo/personal rooms use 3D. Preserve metric coordinate/lock/collision/SKU/persistence tests even though the old Konva adapter is no longer mounted.

Acceptance must cover reviewed catalogue-object removals and known-region photo keep/remove advice, stale advice rejection, actual recommended SKU selection followed by explicit photo click placement, and independent image cleanup review. Verify the local client design confirmation is unavailable for uncalibrated/unloaded images, unconfirmed dimensions, stale/unavailable/unpriced products or open previews. Scene/photo/product-review changes and reload must require confirmation again; issued quotation history must remain readable. Confirm server source/version, stock, permission and exact pricing checks still govern issuance. This checklist does not establish durable legal approval.

Executed results belong in VALIDATION.md. Live OpenAI quality and a measured client room require separate acceptance; tests must not imply guaranteed all-object detection or photorealism.

## Added platform gates

Unit checks reject invented/duplicate AI variants, quantity/stock and tax/fee budget violations, exact lock changes, malformed/oversized provider responses, unsafe redirects and permanent-versus-retryable failures. Editor tests reject worker previews from another scene, tenant, endpoint, version or pending edit.

Real database tests check private reference metadata/bytes, staged path forgery, job deduplication/concurrent claims/stale leases/bounded retry/revocation, direct write denial, reservation races and expiry, buyer ownership, immutable prices, aggregate fulfilment stock, snapshot-only provider guards, publication consent/revisions, owner-only personal scenes, new SKU admission and consented retailer enquiries.

Production browser coverage includes the fictional retailer/customer order path, photograph upload, durable assistance after reload, exact locked objects, stock reconciliation after fulfilment, owned consumer 3D and reload, enquiry consent, tenant/consumer denial and immediate image revocation. Browser fixtures use `.local/e2e-fixtures`, separate from the interactive test company.

CI retains frozen install, audit, local migration, lint, formatting, types, unit/database/build/browser checks. Add a scheduled backup/restore drill and hosted health/queue-age/failed-job alerts in the deployment operator's platform. Hosted email and live provider smoke tests require secure staging credentials and must not expose private data in artifacts.

These gates distinguish tests present now from requirements for future capabilities. Current executed evidence is in [CURRENT_STATE.md](CURRENT_STATE.md); the previous full build/browser baseline remains in [VALIDATION.md](VALIDATION.md). The initial audit changed documentation only. After approval, the implementation added characterisation/security/renderer/commercial tests without weakening existing assertions. Final results are in VALIDATION.md.

| Failure prevented                      | Existing coverage                                                                                                                              | Required addition before the relevant change                                                                                                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Broken position/rotation/product locks | geometry/editor-rules/service tests, generated smart operations, rigid groups, browser flagship and HTTP rejection; exact transform/SKU checks | Operation-by-lock matrix for every new command/source; AI must reject lock mutations; worker/current membership coverage; explicit undo/redo remains a separate human history action.                                                       |
| Incorrect coordinates                  | right-handed rotation test, JSON round trip, rotated bounds, mouse/touch drag, snapping/guides                                                 | Asymmetric golden footprints and world/pixel round trips at varied fit/zoom/pan; unit boundaries, negative/oblique yaw; no stored-pixel fixtures.                                                                                           |
| Collision regressions                  | 250 seeded SAT symmetry cases and 60 generated smart-operation cases, boundaries, ceiling, rugs, windows/doors/zones                           | Translation/rotation metamorphic properties, tolerance boundaries and varied rigid-group fixtures. Check node/candidate budgets and input immutability; a bounded no-solution result never proves global infeasibility.                     |
| Rendered/metric scene disagreement     | Camera/image-world round trips, actual Three projection/model bounds and retained legacy Konva transform characterisation                      | Check calibrated photo placement and separate 3D against canonical transforms/dimensions, asymmetric yaw, floor pivots, previews/history and proxy fallback. Legacy Konva tests do not justify exposing a 2D UI or certify photo alignment. |
| Corrupted saves/history                | Strict schemas/v1 migration, file restart round trip, backend validation, stale CAS, immutable DB rows, request navigation races               | Unsupported/future-schema rolling deployment, corrupted snapshot/failed-save recovery, backup restore and preview engine/result compatibility. Test no scene/history/audit writes on rejected acceptance.                                   |
| Incorrect SKU associations             | Strict catalogue inputs, variant tenant FKs, forged add rejection, stale catalogue acceptance and under-lock race                              | Shared TypeScript/SQL metadata parity, catalogue revision/external IDs, selected-variant model association, historical quote identity, retired/deleted-reference handling and duplicate instance quantities.                                |
| Cross-tenant exposure                  | 15 real DB tests plus browser/API tenant/role/customer/private-asset scenarios                                                                 | Same matrix on every connector/job/room-reference/quote/publication path; revoked jobs before completion; endpoint and direct REST denial; production target-isolation preflight.                                                           |
| Incorrect financial claims             | Exact decimal conversion/minor totals, currency/overflow tests, current prices refreshed at accept                                             | Exact UI formatting at the safe-integer boundary (R13), then tax/discount/shipping/rounding and immutable issued snapshots, idempotent issue, current inventory freshness and aggregate quantity/reservation policy.                        |
| Unsafe runtime/deployment              | Current lint/types/build/browser and local services                                                                                            | Exclusive local/hosted bindings, disabled public demo, streaming size caps, hosted Auth/proxy/restore/rate limits.                                                                                                                          |

## Existing CI

`.github/workflows/ci.yml` already runs npm ci, local stack setup/migrations, lint, formatting, strict types, unit tests, real database tests, Chromium installation and `npm run test:e2e` (which builds then starts a production server). Browser failures retain traces. This is useful existing infrastructure; retain it.

`npm run check` is narrower: lint/types/unit/build, without formatting, real DB or browser gates. Do not interpret it as the whole release gate. Normal Vitest intentionally skips the DB suite; the separate integration command must execute all DB cases without skips. Vitest has no configured numerical coverage instrumentation/threshold today.

## CI implementation and remaining improvements

1. Implemented: fail-closed target preflight before any integration/browser fixture, direct database-suite guards, explicit demo flag and isolated ephemeral connector encryption key in browser tests. Hosted Supabase bindings are rejected before local test writes.
2. Require green lint/types/unit/DB/production-browser checks through branch protection; actual branch-protection/remote-run status is unverified in this audit.
3. Add the missing contract/preview cases before consolidating code. Preserve deterministic seeds and readable failure artefacts.
4. Test pending migrations against an empty isolated database and explicit old-schema upgrade fixtures, without resetting shared development/retailer data.
5. Implemented: CI runs `npm audit --audit-level=high`; local all-severity audit is also recorded. A dependency-direction check for pure modules remains a follow-up. Avoid forced breaking upgrades without review.
6. Add coverage reporting only after choosing/justifying a compatible provider; prefer requirements-based branch cases over arbitrary whole-repository percentage claims. New dependencies need approval/justification.
7. Implemented: 3D projection/model/browser, pricing/immutable quotation and inventory schema/reconciliation/tenant tests. Worker/AI cases remain required when those capabilities are implemented.
8. Keep hosted staging/restore/physical-retailer acceptance as separate release gates. A local CI pass cannot certify them.

Every independently testable PR should include its relevant characterisation/regression tests and existing acceptance checks. Broad release gates remain required before enabling a capability publicly. Do not disable assertions or weaken tenant/lock tests to accommodate a refactor.

## Calibrated photograph gate

- Pure camera fixtures recover metric vertical/floor projections and grabbed-point drag planes. Pointer inversion must use the recovered metric camera even when manual marks are noisy. Reject crossed/degenerate/inconsistent floor marks and non-finite input; never rescale a SKU mesh.
- Load every fictional GLB through both upload validation and the actual Three decoder; its rendered bounds must match the explicit catalogue dimensions.
- Validate AI selection schemas, refusal of invented measurements/overflow areas, bounded provider responses, masked edit requests and original-pixel preservation outside all reviewed regions. Unit tests use stub transports, never a real key.
- Database tests cover photo CAS, project/tenant identity, direct-write denial, confirmed dimensions, completed-source-revision cleanup admission, deletion, revocation and shared AI quota.
- Production browser coverage includes upload/manual calibration, immediate model drag and exact catalogue association, rotation/removal, canonical persistence and separate 3D rendering, locks/collision rejection, reviewed synthetic scan/removal, original restoration, stale edits and foreign access denial. The current consultation adds reviewed completion advice and confirmation-before-quotation checks above.
- Real-provider quality and physical fit require separate measured-room/provider acceptance; a synthetic camera fixture does not establish real-photo accuracy. All of these tests run through the existing CI commands without another dependency.
