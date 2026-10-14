# RoomSell AI

RoomSell has a measured 2D room editor, Supabase accounts and organisation permissions, and a retailer catalogue connected to customer projects. Real projects start empty and use products entered or imported by their retailer. `/demo` provides a separate synthetic bedroom fixture for trying the editor.

## Run locally

Use Node.js 24 and npm, with a running Docker daemon. From this checkout:

```sh
npm ci
npm run setup:local
npm run db:migrate
npm run dev
```

The application serves on port 3000. `setup:local` starts the official Supabase PostgreSQL, Auth, Storage and API services using slim images. It checks service health and captures local credentials in ignored, restricted files under `.local/infra`. It creates `apps/web/.env.local` with `ROOMSELL_LOCAL_SUPABASE=1` only when no existing application environment is present. Existing environment settings are preserved. `db:migrate` applies pending SQL migrations without resetting data.

In restricted cloud workspaces, `npm ci --cache /workspace/.npm-cache` directs npm's cache to a writable directory. The first Docker image download can take several minutes and requires disk space. See [deployment and environment setup](docs/DEPLOYMENT.md) for hosted bindings and operating limits.

## Use the application

1. Open `/workspace`, create an account and organisation, and choose its currency. Local signup signs in immediately; hosted email confirmation needs the provider configuration described in the deployment guide.
2. As an owner or admin, create real products and variants in Catalogue, or import the documented CSV format. Enter authoritative dimensions, prices, availability, stock and lead times. Upload validated photographs or model files if available.
3. Create customer contact records and a project with a budget and confirmed room measurements. Open the project, add doors/windows and exclusion areas, and preview furniture from the organisation's catalogue.
4. Accept a preview to save it. Move and rotate furniture, set independent locks, create rigid groups, compare revisions, and undo/redo. The backend checks geometry, permissions and the current version before committing.
5. Invite colleagues or customers through Team. Copy the generated invitation link to the intended recipient. Owners/admins can grant a customer account view or edit access to a particular project; a contact record alone grants no access.

The project product panel shows current catalogue prices and their total against the saved budget. These are live design estimates; tax, discounts, stock reservations and issued quotations are future work. Models are validated assets available for download; the editor currently renders measured 2D rectangular proxies.

For the synthetic scenario, open `/demo`, select the bed, keep Smart Rearrange selected, set Z to **3.8** and rotation to **180°**, and preview. Bedside tables and the rug follow their anchor preferences while the fully locked wardrobe stays exact.

## Validate

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:integration
npm run build
npx playwright install chromium
npm run test:e2e
npm audit
```

Database and authenticated browser tests require the local stack and migrations. The integration command runs real Auth/PostgreSQL/REST/Storage security tests; the normal unit command skips that suite unless explicitly enabled. If Chromium is already installed, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`. This command builds the app and tests its production server. Run one browser suite at a time: it uses port 3100, forces local Supabase, and keeps the synthetic scene store under `.local/e2e`.

The [validation record](docs/VALIDATION.md) records actual results. The [test plan](docs/TEST_PLAN.md) describes coverage and remaining gates.

## Structure and limits

- `packages/scene-core`: strict scene schema v2, versioned operations and lossless v1 migration.
- `packages/geometry`: rotated footprints, collisions, room/ceiling checks and architectural clearances.
- `packages/layout-engine`: bounded deterministic search, independent locks and rigid groups.
- `packages/catalogue`: product/variant contracts, bounded CSV parsing, integer pricing and asset validation.
- `packages/ui`: accessible shared controls.
- `apps/web`: Next.js application, React Konva editor, account/workspace flows and authenticated server APIs.
- `supabase/migrations`: tenant tables, RLS and checked transactional write functions.

Real project scenes, versions, proposals and catalogues persist in PostgreSQL; assets use a private Storage bucket. The unauthenticated synthetic demo keeps its separate atomic local file adapter. That adapter supports one server process and must contain synthetic data only.

The first three development milestones cover editor rules, accounts/tenant persistence, and catalogue/customer/project workflows. Shared 3D rendering, AI layout intentions, immutable sales proposals/PDFs, billing, durable background jobs and production operations remain on the [roadmap](docs/ROADMAP.md). See [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [limitations](docs/KNOWN_LIMITATIONS.md), and the repository's [engineering rules](AGENTS.md).
