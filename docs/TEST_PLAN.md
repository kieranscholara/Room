# Acceptance tests and quality gates

## Current photograph image-editing acceptance

The real photographic fixture test disables WebGL, reviews/removes the original bed, places and drags the actual Linen catalogue image, renders/reloads the final PNG, confirms its exact proof and issues a quotation/PDF containing that image. Unit cases protect alpha/RGB identity, polygon/brush correction, outside-mask pixels, source dimensions, rug projection and kept furniture during optional lighting. Database cases protect tenant/asset associations, CAS, stale/uncompleted jobs, staff confirmation, exact quote proof and reference retention.

Each browser invocation archives its previous **disposable browser** profile/stock/supplier records under ignored restricted `.local/e2e-archives`, then seeds a distinct fictional retailer/actors. Existing browser database records remain available for diagnosis. This avoids sharing hourly AI quota and stock history across repeated acceptance runs. Stable browser encryption/worker keys and the interactive `.local/fixtures`/Docker trial remain untouched. Stop the interactive app/worker while browser/database suites run. No quota is disabled for testing.

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

The current user flow is the salesperson-operated photo consultation with no visible 2D section. Verify upload/scan human correction, confirmed dimensions and floor calibration, catalogue/known-photo-region suggestions, explicit SKU placement and checked movement/removal, followed by local client confirmation before a new quote. Test confirmation invalidation on scene/photo/review changes and reload, while retaining access to issued history. Legacy demo/personal rooms use 3D; retained Konva projection tests are domain characterisation only. See [QUALITY_GATES.md](QUALITY_GATES.md) and [PHOTO_SELLING.md](PHOTO_SELLING.md).

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

Before live rollout, verify representative retailer models and a physically measured photograph, live provider quality/latency, hosted email/cookies, backups/restore and retention/deletion, accessibility/device performance and the actual inventory contract. Photo/canonical transform parity, bounded AI/lock/geometry checks, exact commercial budgets, immutable quotation revisions and durable jobs remain regression gates. Durable customer signatures/review links and billing events are separate future capabilities; the local client review is not legal acceptance.
