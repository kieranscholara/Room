# Proposed architecture alignment plan

Status: approved implementation of A01–A08 (roadmap steps 1–4); later capabilities remain scoped proposals. Preserve the working editor, API shapes, measured transforms and existing accepted scenes. Complexity: S = one focused PR; M = several bounded changes; L = a capability/decision split into multiple PRs. Estimates describe scope, not a delivery promise. No new dependency is required for A01–A05.

## A01 — Make runtime and test database targets exclusive (S)

- **Files:** `apps/web/lib/supabase-config.ts`, `playwright.config.ts`, `scripts/test-integration.mjs`, `scripts/local-stack.mjs`; new isolated configuration tests and documentation corrections.
- **Why:** R1 proves the local flag can select hosted bindings. Treat local status and complete hosted bindings as mutually exclusive sources; validate the destination before test writes.
- **Risks:** Existing ambiguous setups may stop working; errors must identify missing names without exposing values. Maintain legitimate hosted HTTPS operation.
- **Dependencies:** None; resolve target safety before expanding browser fixtures.
- **Tests:** Local/hosted/both/incomplete bindings, loopback ports/protocols, malformed status, mocked destination preflight proving zero remote requests.
- **Acceptance:** Local tests never select hosted data even when hosted variables exist; mixed/incomplete bindings fail closed under the approved policy; existing local/hosted modes work with complete intended bindings. No credentials in output/source.

## A02 — Gate the shared demo and bound its request reader (S)

- **Files:** `apps/web/app/demo/page.tsx`, `app/api/scene/route.ts`, history route, `apps/web/lib/local-persistence.ts`, `http-api.ts`, `playwright.config.ts`, relevant demo/browser tests and deployment docs.
- **Why:** R2: shared anonymous file writes should require an explicitly enabled development/demo mode; the current size check runs after full-body buffering.
- **Risks:** A default production flag can break synthetic browser acceptance unless tests enable it explicitly. Preserve enabled demo response messages/statuses and existing files; do not change authenticated project routes.
- **Dependencies:** A01 for reliable environment/test selection.
- **Tests:** Disabled-production page/API/history, enabled demo flagship workflows, chunked oversized bodies, malformed JSON/origin checks, no file creation/write when disabled.
- **Acceptance:** Production defaults to disabled demo; explicit demo mode retains current functionality and stored scenes; oversized requests are stopped while reading; authenticated retailer flows unchanged.

## A03 — Bind durable acceptance to the approved preview (M)

- **Files:** `apps/web/lib/editor-service.ts`, `project-service.ts`, `packages/layout-engine/src/index.ts`, `tests/service.test.ts`, DB/API tests; use existing JSON preview payload unless a forward migration is demonstrably necessary.
- **Why:** R3: store an explicit engine/contract version and trusted approved-result fingerprint or exact projection. Recompute and validate as today, then ensure compatibility/result agreement before saving.
- **Risks:** Legacy previews need a clear 409/re-preview rollout. Fingerprint canonicalisation must not confuse JSON property order with geometry changes. Never use a client-supplied approved scene.
- **Dependencies:** None beyond safe test fixtures; run A01 first operationally.
- **Tests:** Same-version accept, different solver version, changed result despite same version, legacy/expired preview, tampering, stale expectedVersion, locks and deployment rollover. Every rejected case leaves scene/history/audit rows unchanged.
- **Acceptance:** Accepted geometry equals the trusted preview's approved result; incompatible previews return 409 with re-preview guidance. Current compatible preview/undo/redo behaviours and API request shapes remain intact.

## A04 — Consolidate catalogue contracts and pure selection/pricing policy (M)

- **Files:** `packages/catalogue/src/index.ts`, `apps/web/components/workspace-business-types.ts`, `project-editor.tsx`, `apps/web/lib/project-service.ts`, `project-catalogue.ts`; parity cases for migration 005.
- **Why:** R7: reduce DTO/predicate/arithmetic drift before inventory, AI and quotation consumers reuse these rules.
- **Risks:** Accidentally changing unavailable/null totals, currency checks, exact physical metadata or exported payload fields. SQL under-lock validation must remain independently authoritative.
- **Dependencies:** Characterisation tests first; A03 protects preview semantics during later changes.
- **Tests:** Compare current payloads and decisions for inactive parent/variant, zero stock, made-to-order, wrong tenant/currency, stale dimensions, missing references, unknown prices, repeated variants and overflow. Type-level DTO compatibility and existing browser/API acceptance.
- **Acceptance:** Existing endpoints/UI produce the same supported results. Shared types/pure predicates/arithmetic replace equivalent TypeScript duplication. The SQL guard and its race tests are preserved; no new package/dependency is necessary.

## A04b — Preserve exact currency display across the supported range (S)

- **Files:** `apps/web/components/workspace-business-types.ts`, existing catalogue money helper if reused, new money-format tests; catalogue/project budget UI consumers remain unchanged.
- **Why:** R13 confirms a one-cent display discrepancy at the allowed safe-integer boundary, despite correct stored minor units and arithmetic.
- **Risks:** Locale grouping, negative amounts and zero/three-decimal currencies can be broken by a handcrafted formatter. Do not silently narrow the schema's financial range.
- **Dependencies:** Characterise normal and extreme inputs; use the shared policy from A04 where appropriate. Existing BigInt/Intl primitives should suffice without a new dependency.
- **Tests:** Exact formatted fractions at maximum/near-boundary values, normal EUR, JPY/KWD precision, negative/zero amounts and supported locale/grouping behaviour.
- **Acceptance:** Supported integer minor amounts display without losing a minor unit; normal existing values retain their formatting; persisted values, totals and API payloads remain unchanged. This is an explicit approved bug fix separate from the behaviour-preserving consolidation.

## A05 — Characterise renderer transforms and model selection (S–M)

- **Files:** `packages/geometry/src/index.ts`, `packages/scene-core/src/index.ts`, `apps/web/components/floor-plan.tsx`, `packages/catalogue/src/assets.ts`, `apps/web/lib/project-catalogue.ts`, geometry/asset tests; new renderer-contract fixtures.
- **Why:** Establish parity and a model-origin/tolerance policy before a 3D consumer is introduced. Extract a pure display conversion only if tests show an actual shared need.
- **Risks:** Negating +Y yaw twice, losing ground-centre pivot, using a parent model for a differently sized variant, or silently scaling measured objects.
- **Dependencies:** Approve ADR-002 before changing model/render policy.
- **Tests:** Asymmetric dimensions at 0, ±pi/2, pi and oblique yaw; arbitrary zoom/pan pointer round trips; transformed indexed model bounds, floor origin and exact selected-variant association.
- **Acceptance:** Saved schema/transforms remain byte-equivalent. Konva footprints match geometry. A documented pure model-to-scene transform or labelled fallback is defined; renderer-specific state remains outside the scene.

## A06 — Add a derived, initially read-only 3D view (M; feature addition)

- **Files:** Existing scene/geometry/store/Editor integration; add a separate 3D view adapter rather than replacing `floor-plan.tsx`.
- **Why:** Complete PARTIAL shared-scene readiness with the existing floor-based v2 contract.
- **Risks:** Client-only WebGL/SSR, device memory, texture limits, misleading proxies and view drift.
- **Dependencies:** A05/ADR-002; justify and approve Three.js and optionally React Three Fiber before installing. Do not add broad convenience libraries by default.
- **Tests:** Actual 3D projected bounds versus geometry/2D; accepted versus preview versus discarded state; rotation/locks/history; missing/invalid models; representative physical retailer assets and mobile fallback.
- **Acceptance:** Both views show the same IDs, footprint dimensions, transforms and revision. 3D introduces no independent editable geometry store or implicit saves. A labelled proxy handles unavailable models.

## A07 — Add exact retailer pricing rules, then quotation snapshots (M then L)

- **Files:** Existing catalogue money helpers, `project-catalogue.ts`, project budget UI, foundation product/project columns; new pricing/quotation modules and forward SQL migrations.
- **Why:** Current subtotal cannot represent an issued retailer quotation. Separate pure price calculations from immutable document issuance.
- **Risks:** Tax inclusion/rounding ambiguity, mutable live prices corrupting history, currency precision and concurrent issue/retry.
- **Dependencies:** A04 and approved ADR-003; explicit retailer rules, not inferred jurisdiction/default tax.
- **Tests:** EUR/JPY/KWD, integer overflow, configured line/invoice tax rounding, discounts/shipping, price changes after issue, concurrent issue and idempotent retries, tenant read restrictions.
- **Acceptance:** Live estimates remain clearly live. An issued quote persists item IDs/SKUs/descriptions/quantities, currency, rules/version, exact amounts and scene revision; subsequent catalogue edits never alter it. PDF is a subsequent renderer of that immutable snapshot.

## A08 — Define and implement one inventory connector (M; staged)

- **Files:** Catalogue schemas/service and migrations 004/006/007; new provider adapter/external-ID mapping and forward migrations.
- **Why:** External retailer stock needs idempotent reconciliation, freshness and stable internal identity before recommendations/orders depend on it.
- **Risks:** Reused/mutable SKUs, conflicting updates, missing products, partial feed retries, stale stock and aggregate demand exceeding stock.
- **Dependencies:** A01/A04, actual provider API/sample feed and inventory ownership policy. Separate mapping/reconcile tests from scheduling rollout.
- **Tests:** Duplicate/out-of-order events, provider ID conflicts, wrong tenant, partial failure, disabled product, stale feed, same-variant aggregate quantities and accepted scenes retaining physical snapshots.
- **Acceptance:** One real supported provider maps to stable variant UUIDs, records freshness/external revision and applies complete validated batches. Sync never silently replaces/resizes scene objects. Reservation/order guarantees are separately explicit.

## A09 — Add private room references and durable tenant jobs (M; staged)

- **Files:** Existing project access/service, image validator, storage policies and server-only boundary; add private reference records/job records and forward migrations.
- **Why:** Product photographs are not project room references; longer asset/AI processing requires retries and permissions beyond a request lifetime.
- **Risks:** Photo/privacy exposure, orphan storage, duplicate jobs, revoked access, worker bypass of geometry, and unsafe inferred measurements.
- **Dependencies:** A01/A02; approve shared application-service extraction only for the actual worker runtime (ADR-001). Define retention and worker authentication.
- **Tests:** Reference upload/read/delete across tenants/customer grants; retries/idempotency, orphan reconciliation, revoked actor/version at job completion; geometry/locks through the common writer; no automatic measurement confirmation.
- **Acceptance:** Private project references remain scoped and revocable. Jobs have tenant/project/actor identity, states and bounded retries. A worker cannot commit arbitrary replacement scenes. Backups/restore cover DB and assets.

## A10 — Add AI recommendation/intention adapter (M; staged)

- **Files:** Existing catalogue/geometry/layout contracts and project operation service; add strict AI contracts, fake adapter and then one provider adapter.
- **Why:** AI is currently absent. Keep provider output outside the trusted geometry/financial authority.
- **Risks:** Invented SKU/price/dimensions, prompt injection from catalogue/photos, budget overrun, lock mutation and unauthorised data disclosure.
- **Dependencies:** A03/A04/A07/A08, A09 for photo/long-running workflows. Text-only deterministic adapter tests can precede provider integration. Justify provider SDK or direct HTTPS choice before dependency installation.
- **Tests:** Unknown/foreign IDs, invalid/malicious provider JSON, attempts to unlock/change measurements/prices, stock quantity/freshness, impossible layouts, timeout/retry and budget calculations independently verified.
- **Acceptance:** AI produces allowed bounded intents/candidate references only. Server resolves real products and recomputes constraints/prices; human acceptance uses the protected preview flow. Failed advice leaves accepted scenes unchanged.

## A11 — Hosted staging and operational gates (M; parallel checklist split into PRs)

- **Files:** Supabase/server configuration, deployment scripts/docs and CI; new infrastructure/runbooks as actually selected.
- **Why:** Local passing tests do not establish production email, proxy security, restore or capacity.
- **Risks:** Accidental production test writes, unsafe forwarding headers, resource exhaustion and untested disaster recovery.
- **Dependencies:** A01/A02 before public access; gate each enabled feature's requirements separately.
- **Tests:** Hosted confirmation/session refresh/expiry and Secure cookies; private storage/RLS; DB+asset restore to isolated target; rate limits, bounded processing and measured organisation lock contention.
- **Acceptance:** Staging uses safe designated test targets and observability. Restore drills and rollout/rollback runbooks pass. Do not redesign coarse locks until measurements justify it and revocation tests stay valid.

## A12 — Consumer marketplace ownership decision (L; proposal first)

- **Files:** Current organisations/members/projects/catalogue schema and project access policy, scene ownership contract; new consumer/publication domain only after approval.
- **Why:** A consumer design and an explicitly published retailer offer need ownership/permissions beyond a single private retailer project.
- **Risks:** Cross-tenant exposure, unapproved publication/IP, multi-retailer financial assumptions and incompatible scene migration.
- **Dependencies:** ADR-004, stable catalogue identity/pricing and production gates; no immediate scene rewrite.
- **Tests:** Unpublished products remain private, consumer owns only its designs, consent/publication revocation, multi-retailer references admitted only through approved public offers.
- **Acceptance:** Separate consumer/published-offer ownership works without weakening existing tenant isolation. Any incompatible scene/DB extension has staged readers, forward migration, rollback and representative preserved scenes.

A01–A08 are implemented, including A04b. A08 provides a real HTTPS custom REST adapter and tested reconciliation; configuring an actual retailer feed remains external work. A09–A12 describe subsequent capabilities and production gates. The first three issue drafts are retained as completed implementation records in [GITHUB_ISSUES.md](GITHUB_ISSUES.md); no issues were posted externally.
