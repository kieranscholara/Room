# First three architecture issues — implementation record

These local drafts were approved and implemented as A01–A03. They have not been posted to GitHub. The original problem and acceptance criteria are retained for review. See [ALIGNMENT_PLAN.md](ALIGNMENT_PLAN.md) for later independent tasks.

## Issue 1 — Make local Supabase selection exclusive and prevent hosted test writes

**Priority:** high; **complexity:** S; **plan:** A01; **risk:** R1.

**Problem/evidence:** `apps/web/lib/supabase-config.ts` prefers SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY even when ROOMSELL_LOCAL_SUPABASE=1. A mock-binding reproduction selected hosted.invalid with the local flag true. Browser config currently sets only that flag, so its claimed local isolation is conditional on hosted bindings being absent.

**Scope:** Exclusive complete local/hosted binding resolution and a test destination preflight. Existing files: supabase-config.ts, playwright.config.ts, scripts/test-integration.mjs/local-stack.mjs and relevant setup/testing docs. Add isolated config/preflight tests. No dependency installation.

**Acceptance criteria:**

- Local mode uses only verified loopback local status under the approved policy; it cannot silently use hosted credentials/URL.
- Hosted mode requires a complete HTTPS binding set; no partial source mixing.
- Browser/integration setup rejects unexpected nonlocal destinations before signup or data writes; failure output contains names/status only.
- Mock local/hosted/both/partial/invalid cases and zero-remote-request preflight tests pass.
- Existing complete local and hosted application modes remain supported; unit/DB/browser gates stay green on the designated local target.

**Dependencies/risks:** No upstream task. Ambiguous configurations will need explicit correction; preserve valid intended hosted operation and avoid printing keys.

## Issue 2 — Disable shared anonymous demo routes by default in production

**Priority:** high before rollout; **complexity:** S; **plan:** A02; **risk:** R2.

**Problem/evidence:** The synthetic demo page, /api/scene and history route have no production gate. They expose shared mutable single-process file state. Demo POST also reads all text before rejecting bodies over 16 KiB.

**Scope:** Explicit demo/development deployment policy and streaming byte bound. Existing files: app/demo/page.tsx, app/api/scene/route.ts and history route, local-persistence.ts/http-api.ts, playwright.config.ts and deployment docs. Enable the demo explicitly in production-mode synthetic browser tests. Preserve authenticated project handlers.

**Acceptance criteria:**

- Public production defaults return a disabled/not-found response for demo page/API/history, without touching demo files.
- Explicitly enabled local/demo mode preserves existing lock, smart/manual, geometry, preview/accept, history, JSON-export and saved-file behaviour.
- Oversized/chunked payloads are rejected during reading with compatible error/status semantics; origin/JSON validation remains enforced.
- Existing retailer scenes, tenant permissions and account/catalogue routes are unaffected.
- Enabled flagship and disabled production route tests plus the existing acceptance suite pass.

**Dependencies/risks:** A01 for safe environment fixtures. Do not delete saved demo data or accidentally disable synthetic CI scenarios.

## Issue 3 — Reject incompatible durable previews at acceptance

**Priority:** high before solver/contract deployments; **complexity:** M; **plan:** A03; **risk:** R3.

**Problem/evidence:** EditorService recomputes an accepted operation without pinning solver compatibility or checking agreement with the saved trusted preview. Project previews persist across requests/deployments for 15 minutes. SOLVER.version exists but is not persisted in SavedProposal; an algorithm change can produce a different valid arrangement than the one approved.

**Scope:** Persist backend-only engine/contract compatibility and an approved-result identity; check recomputed trusted result before commit. Existing files: editor-service.ts, project-service.ts, layout-engine/src/index.ts and service/DB/API tests. Prefer current preview JSON payload to an unnecessary schema migration. No editor rewrite or client replacement-scene input.

**Acceptance criteria:**

- Compatible preview acceptance commits the approved geometry and preserves existing API shapes, locks, catalogue admission and history semantics.
- Engine mismatch, changed recomputation or incompatible legacy preview returns 409 with re-preview guidance.
- Rejection writes no scene/history/version/audit changes; stale-version/cross-actor/tampered preview protections still hold.
- A deployment-change test and a changed-result-without-version-bump test cover the actual compatibility gap.
- Stored server-owned preview data is authoritative; client-edited preview JSON is never trusted.

**Dependencies/risks:** Run after A01 operationally. Define canonical comparison and a legacy-preview rollout/expiry policy; do not create false mismatches from JSON property order or change accepted saved scenes.
