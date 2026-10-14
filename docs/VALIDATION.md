# Editor, accounts and catalogue validation — 14 October 2026

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
