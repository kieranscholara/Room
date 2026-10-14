# Acceptance tests and quality gates

Start the local Supabase stack and apply migrations before database/authenticated browser suites:

```sh
npm run setup:local
npm run db:migrate
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e
npm audit
```

The [validation record](VALIDATION.md) contains actual execution results. Test descriptions below describe coverage, not an unrecorded claim that a particular run passed.

## Unit, property and service tests

`npm test` runs Vitest with reproducible fast-check seeds. Scene/geometry/layout tests cover strict schemas and v1 migration, coordinate precision/rotation, SAT symmetry, walls/ceiling/openings/circulation, rug rules, deterministic bounded rearrangement, independent locks, rigid groups, impossible moves, snapping/guides and manual placement.

Editor service tests cover preview isolation/recomputation, forged operations/metadata, version conflicts, immutable dimensions/products, history branching, complete undo/redo, canonical persistence validation and local file reload. Catalogue tests cover strict products/default variants, safe integer prices/currency precision, CSV quoting/BOM/headers/grouping/bounds/errors and atomic parser results. Asset tests cover corrupt/spoofed images, full decode/limits, real GLB/glTF geometry/world transforms/index bounds, dimensional tolerance, external-resource rejection and supported performance/format limits.

The database suite intentionally skips in the normal unit command unless `ROOMSELL_RUN_DATABASE_TESTS=1` is set. This keeps unit execution independent of Docker; a skipped suite is not evidence that tenant security passed.

## Real database security

`npm run test:integration` checks local service health and enables `tests/database-security.test.ts`. It uses actual Auth identities/tokens, PostgreSQL roles/JWT claims, REST and private Storage across multiple organisations.

Coverage includes tenant read/write isolation, composite foreign keys, membership forgery/escalation, last-owner protections, invitation email/hash/expiry/revocation/reuse, customer project grants, denied direct scene/catalogue/asset writes, private proposals, competing commits and append-only versions/operations. It checks catalogue bounds/authority, atomic import rollback, private storage, variant retention limits and in-flight catalogue/role changes serialised with scene commits.

These checks are scoped to the local deployment. Hosted Auth configuration, reverse proxy behaviour and hosted policy installation need their own staging execution.

## Browser and app API acceptance

`npm run test:e2e` builds the current application and runs one Playwright worker against its production server on port 3100, with local Supabase explicitly selected. Synthetic editor files use ignored `.local/e2e`; authenticated tests create unique test identities/organisations in the local database. Run one suite at a time. Production-mode acceptance avoids development compilation and HMR timing affecting application checks.

Editor workflows exercise locks, move/rotate/rearrange, preview/discard/accept, backend reload, undo/redo, measured architecture, groups, comparison, wall snapping, mouse/touch dragging and tablet/mobile controls. HTTP tests cover malformed, cross-origin, locked and stale writes.

Account/project workflows cover browser signup/login/logout, organisation creation, invitations, role management/removal, wrong-email/revoked links, multi-tenant API isolation, actual version commits and read/edit/revoked customer sharing. Catalogue workflows cover real record entry, customer/project creation, variant selection, photo upload, current-price/budget updates, CSV row errors/atomic duplicate rejection, catalogue permission attacks, asset isolation and forged/stale additions.

Screenshots/traces on failure are written to ignored test-results/playwright-report. CI starts the same stack, applies migrations, runs the gates and retains browser failure artifacts. Installed system Chromium can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

## Later acceptance gates

Still required: 2D/3D agreement and representative model rendering; AI intent/lock/geometry constraints; complete tax/discount/shipping budgets; immutable issued quotations/PDF revisions; approval/review links; signed/idempotent billing events; durable retries/tenant jobs; hosted email/cookies; backup/restore and retention/deletion; full accessibility/browser/device and physical retailer acceptance.
