# Account-free Docker trial — 15 October 2026

Added `Dockerfile.trial`, `compose.yaml` and the one-command `scripts/try-customer.mjs` launcher. No new application dependencies or editor/geometry changes. The build context excludes local credentials, runtime data, environment files, Git metadata and dependencies. Optional live OpenAI credentials are supplied at runtime through ignored `.env.trial`.

Verified a fresh frozen dependency install in the Node 24 image, official local Supabase reuse and non-destructive migration, first fictional seed, simulated inventory synchronization, all three shortcut personas and a completed background test-assistance job with the accepted scene unchanged. Recreating the app container retained the same registered fictional accounts/projects and connector encryption key; inventory synchronization and assistance passed again afterward. The application container reports healthy. A real Chromium browser verified one-click retailer and customer entry, the measured consultation and ready 3D viewer without signup/email verification or browser errors. Docker Desktop host networking is required on supported Windows/macOS installations; Linux host networking was exercised here.

Lint, strict types, formatting and **235 unit tests** passed. The normal unit run deliberately skipped the 54 separately gated database tests. Existing platform acceptance coverage is recorded below; no claim is made that the full database/30-browser production suite was rerun for this launcher-only change. See [DOCKER_TRIAL.md](DOCKER_TRIAL.md) for the local Docker instructions and stop/data-retention behaviour. No Vercel, hosted Supabase keys, signup or email verification is needed for this trial. The local AI adapter is labelled and does not call OpenAI.

---

# Six-area platform validation — 14 October 2026

Executed in the same local cloud checkout with Node 24.19/npm 11.9, Next 16.4, PostgreSQL 17.11, Supabase CLI 2.120 and system Chromium. The earlier checkpoints below are historical; current results supersede their missing-feature statements.

| Check                                           | Result                                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint / strict TypeScript / Prettier             | Passed.                                                                                                                                                                                                       |
| Unit/property/service/contract tests            | **235 passed**; 54 database cases deliberately skipped here and executed separately.                                                                                                                          |
| Real local database security/integrity          | **54 passed**, zero skipped (15 foundation, 10 quotations, 8 inventory, 21 new platform tests).                                                                                                               |
| Production build and combined browser/API suite | **30 passed**, zero failed/skipped; existing editor/3D tests plus three full platform journeys.                                                                                                               |
| Dependency audit                                | **0 vulnerabilities**, no new dependencies added in this increment.                                                                                                                                           |
| Repeat local setup/migrations                   | Passed without reset, all 16 forward migrations current.                                                                                                                                                      |
| Fictional seed repeatability                    | Two consecutive default-seed runs passed, preserving existing scenes, inventory and publication decisions. Browser scenarios use separate fixture accounts/state.                                             |
| Disabled local features                         | Separate production-mode server returned 404 for `/demo`, demo API/history, `/testing` and test status with both flags disabled; anonymous session 401 and database health 200.                               |
| Deployment output tracing                       | 69 server traces inspected; **zero private local files** included (fixture credentials/tokens, `.env.local`, local runtime).                                                                                  |
| Backup and isolated restore                     | Final snapshot restored **32 public tables and 33 asset files**; row counts and SHA-256 byte round trips matched, original database unchanged. Temporary database/bucket are separately owned.                |
| Visual review                                   | Reviewed real browser screenshots for fictional retailer consultation/photos/advice/orders and privately owned consumer design/enquiry; existing renderer suite tests real WebGL models/proxies and fallback. |

The new browser journey uploads a private photo, queues checked test advice, recovers the durable result after reload, reviews/accepts a preview, preserves the fully locked wardrobe exactly, issues a quote, reserves/confirms as a customer and fulfils as staff. A queued simulated feed sync retains the decremented quantities. The consumer journey accepts published furniture, renders 3D proxies, reloads identical saved state, requires explicit enquiry consent, and denies unrelated retailer/customer access to personal/private projects. Public image delivery immediately returns 404 after unpublication.

New database cases verify actual Auth/RLS/Storage, staged-image path rejection, deduplication, concurrent worker claims, old-lease rejection, bounded retry and permission revocation; direct write denial; order race/expiry/ownership/snapshot integrity/aggregate stock; rejection of real snapshot-only provider fulfilment; publication consent; private consumer CAS/current-SKU/aggregate stock and selected-retailer enquiry. Unit tests cover strict AI intent, stock/tax/fee budget/lock checks, bounded provider parsing, nonredirecting transport, error classifications and safe hosted origin configuration. No numerical coverage percentage is claimed.

Initial failures were corrected fixture/assertion issues (service-role direct mutations deliberately disallowed by SQL; strict pricing item projection; expected inaccessible-project status 404) and a duplicate JSX key caught by typechecking. The final combined run above passed. Database protections were preserved rather than relaxed for fixture cleanup.

**External work not verified:** user has no Vercel/Supabase projects; live OpenAI has no configured key. No real retailer endpoint, outbound order acknowledgement, hosted email/SMTP, managed alerts, hosted Auth recovery/PITR/asset restore, remote CI or fresh cloud snapshot restoration was exercised. Local provider/hosting files and documentation are prepared; local success does not establish those external outcomes. See DEPLOYMENT.md, CURRENT_STATE.md and TEST_CUSTOMER.md.

---

# Architecture steps 1–4 validation — 14 October 2026

Executed in `/workspace/Room` with Node.js 24.19.0/npm 11.9.0, Next.js 16.4.0, PostgreSQL 17.11, Supabase CLI 2.120.0 and system Chromium. The historical milestone checkpoint is preserved below.

| Check                                | Verified outcome                                                                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen install                       | `npm ci --cache /tmp/roomsell-npm-cache --no-fund` passed with the updated lockfile.                                                                                  |
| Local setup and migrations           | Idempotent `setup:local` and `db:migrate` passed without reset. All ten forward migrations applied through the official ledger.                                       |
| Lint, strict types, formatting       | Passed.                                                                                                                                                               |
| Unit/property/service/contract tests | **208 passed**. **33 database tests intentionally skipped** in this command and run separately below.                                                                 |
| Real database security/integrity     | **33 passed**, zero skipped: original foundation 15, quotations 10, inventory 8.                                                                                      |
| Production build                     | Passed with new pricing, quotation/PDF and inventory routes plus derived 3D client chunks.                                                                            |
| Browser/API acceptance               | **27 passed**, zero failed/skipped, in the final combined `npm run test:e2e` production run.                                                                          |
| Disabled production demo             | `/demo`, `/api/scene` and `/api/scene/history` return 404 with `ROOMSELL_ENABLE_DEMO=0`; no demo data directory is created. Login returns 200, anonymous session 401. |
| Dependency audit                     | **0 vulnerabilities** at all severities. CI now includes `npm audit --audit-level=high`.                                                                              |
| Visual review                        | Reviewed real WebGL model/proxy view, dimensions, camera controls, selection, preview/history overlay and existing project panels.                                    |

New tests cover exclusive runtime/test bindings, bounded demo requests, preview engine/result compatibility, shared catalogue policy, exact large currency display, actual Three/Konva projection parity, authenticated GLTFLoader/model bounds, resource disposal, explicit tax/discount/fee math and immutable snapshots/PDFs. Financial property tests exercise 200 generated policies; geometry's existing generated cases remain intact.

Database tests exercise independent exact SQL financial validation, coherent-but-wrong calculation rejection before insertion, catalogue/source staleness, aggregate stock checks, concurrent/idempotent issuance, role-revocation locking, customer/project RLS, encrypted credential secrecy, mapping ownership, stale snapshots and atomic batch rollback. Inventory success is tested against controlled transport and real checked database reconciliation; no live retailer provider is configured or contacted.

Initial browser failures were fixture defects: an incorrect existing project-sharing HTTP status expectation, declared GLB accessor bounds which disagreed with the fixture's actual float32 data, and a non-exact selector matching both placement and new-furniture rotation fields. Assertions now follow the established endpoint contract and actual model bytes; production validation was preserved.

A stable generated local connector encryption key is stored only in ignored mode-0600 `apps/web/.env.local`, with the demo explicitly enabled for local use. Browser tests use a separate ephemeral key. Neither keys nor provider tokens are included in source/archives. The synthetic browser store and authenticated UUID fixtures remain separate from user scene data.

These are local results. Hosted email/proxy/deployment, remote CI/branch protection, fresh cloud snapshot restoration, backup/restore drills and physical retailer verification remain unverified. Room references, AI providers, durable jobs, reservations/orders and consumer marketplace capabilities are future work; see [ROADMAP.md](ROADMAP.md), [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) and [INVENTORY.md](INVENTORY.md).

---

# Original editor, accounts and catalogue checkpoint — 14 October 2026

Executed in `/workspace/Room` with Node.js 24.19.0, npm 11.9.0, Next.js 16.4.0, PostgreSQL 17.11, the installed Supabase CLI 2.120.0 and system Chromium.

| Check                             | Verified outcome                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Frozen dependency install         | `npm ci --cache /workspace/.npm-cache --no-audit --no-fund` passed.                                                               |
| Local infrastructure              | Official Supabase slim PostgreSQL/Auth/Storage/API/mail services are healthy; repeat `setup:local` passed without resetting data. |
| SQL migrations                    | All seven migrations applied through the official local ledger; repeat `db:migrate` is a no-op.                                   |
| ESLint and strict TypeScript      | Passed, including application and catalogue package declarations.                                                                 |
| Prettier                          | Passed.                                                                                                                           |
| Unit/property/service tests       | **84 passed**. The 15 database tests are intentionally skipped by this command.                                                   |
| Real database security tests      | **15 passed**, zero skipped, through `npm run test:integration`.                                                                  |
| Production build                  | Passed, including all authenticated catalogue/project/asset routes.                                                               |
| Production browser/API acceptance | **21 passed**, zero failed/skipped, through `npm run test:e2e`.                                                                   |
| Dependency audit                  | **0 vulnerabilities** across all severities. Vitest 4.1.11 replaces the earlier vulnerable development dependency chain.          |
| Visual review                     | Reviewed the accepted catalogue project, floor plan, measured guides, locks, product/budget panel and sharing controls.           |

The normal unit suite covers scene migration, strict operations, rotated geometry, architectural envelopes, locks, groups, deterministic search, persistence/version checks, CSV parsing, exact currency arithmetic and byte-level asset validation. It also reproduces delayed request responses during project navigation and cross-module service errors after development reloads. Image tests fully decode PNG/JPEG/WebP; GLB/glTF tests measure transformed, indexed geometry independently of declared bounds and reject unsafe/unsupported resources and limits.

The database suite uses actual Auth identities, PostgREST, PostgreSQL role/JWT claims and private Storage. It checks two-tenant isolation, composite foreign keys, last-owner/invitation protections, explicit customer sharing, direct-write denial, immutable scene history, concurrent version conflicts, role revocation, atomic catalogue/import rollback, retained-variant limits and a real catalogue-change/scene-commit locking race.

The browser suite tests account/team flows, wrong-email/replayed/revoked invitations, customer CRUD, real product entry/default variants, decoded private photograph delivery, atomic valid/invalid/duplicate CSV imports, a measured project starting empty, catalogue preview/accept and current budget totals, locked-product removal, customer view-only sharing/revocation, catalogue metadata forgery/staleness, selected-product asset access, geometry errors, room architecture/groups, revisions, mouse/touch placement and exact undo/redo.

The initial Webpack development run exposed slow cold page compilation and cached services whose old error constructor failed `instanceof` after module reloads. Trusted service errors now use a validated shared brand, preserving their HTTP status while sanitising ordinary exceptions. The acceptance command builds the app and starts a fresh production server, avoiding compilation/HMR timing in workflow assertions. Development continues to use the supported Webpack option because this cloud environment previously showed a Turbopack development reload loop.

Browser tests explicitly select local Supabase and use a separate ignored synthetic scene directory. Authenticated browser fixtures have unique test identities/organisations; they remain local test data. Screenshots are ignored at `test-results/catalogue-project.png` and `test-results/room-studio-desktop.png`. The primary synthetic demo scene is separate from the suite's scene files.

GitHub CI is configured to install/start/migrate the local stack and run lint, formatting, types, unit/database tests and production browser acceptance. These results are from this cloud checkout; a remote GitHub CI result and fresh cloud snapshot restoration have not been independently verified. Hosted email confirmation, hosted deployment, physical retailer models, independent security/accessibility audits and the remaining commercial features are outside this validation. See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) and the preserved editor benchmark checkpoint in [EDITOR_MILESTONE.md](EDITOR_MILESTONE.md).
