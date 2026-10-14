# RoomSell AI

RoomSell has synchronized 2D/3D room views, Supabase accounts and organisation permissions, a retailer catalogue connected to customer projects, configured pricing, immutable quotations/PDFs, private room photographs, checked design assistance, durable jobs/orders, a published-offer consumer marketplace and a custom REST inventory connector. Real projects start empty and use products entered or imported by their retailer. `/demo` provides a separate synthetic bedroom fixture when explicitly enabled with `ROOMSELL_ENABLE_DEMO=1`.

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

## Test with a fictional customer

After starting the app, run `npm run seed:test-customer` and `npm run worker` in another terminal. Open `/testing` to enter the isolated Boreal Living manager, customer or consumer account. Generated images and inventory are explicitly fictional. See [the customer walkthrough](docs/TEST_CUSTOMER.md). OpenAI and public managed hosting require secure credentials/projects; [deployment instructions](docs/DEPLOYMENT.md) describe the prepared Vercel/Supabase setup.

## Use the application

1. Open `/workspace`, create an account and organisation, and choose its currency. Local signup signs in immediately; hosted email confirmation needs the provider configuration described in the deployment guide.
2. As an owner or admin, create real products and variants in Catalogue, or import the documented CSV format. Enter authoritative dimensions, prices, availability, stock and lead times. Upload validated photographs or model files if available.
3. Create customer contact records and a project with a budget and confirmed room measurements. Open the project, add doors/windows and exclusion areas, and preview furniture from the organisation's catalogue.
4. Accept a preview to save it. Move and rotate furniture, set independent locks, create rigid groups, compare revisions, and undo/redo. The backend checks geometry, permissions and the current version before committing.
5. Invite colleagues or customers through Team. Copy the generated invitation link to the intended recipient. Owners/admins can grant a customer account view or edit access to a particular project; a contact record alone grants no access.

The project product panel shows current catalogue prices and their total against the saved budget. These are live design estimates. Owners/admins configure explicit currency/tax/discount/fee/rounding rules in Pricing. Staff review and issue quotations from accepted measured scenes; issued amounts remain immutable and downloadable as PDF. Quotes check aggregate available stock at issuance. Customers with explicit ordering permission can then reserve/confirm an order; retailer fulfilment preserves immutable quoted prices.

Switch between 2D floor plan and 3D room view to inspect the same accepted or preview scene. Validated matching models use floor-centred pivots without scaling; missing/incompatible assets use labelled dimension proxies. Placement controls and protected previews still own edits.

Inventory lets owners/admins configure a public HTTPS custom REST snapshot endpoint and explicit provider-to-variant mappings. A server-only `ROOMSELL_CONNECTOR_ENCRYPTION_KEY` (32 random bytes in base64) is required to save credentials or sync. Configure secrets through deployment settings; never paste them into source. Live retailer integration requires an actual endpoint/feed and token. See [inventory contract](docs/INVENTORY.md).

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

Database and authenticated browser tests require the local stack and migrations. The integration command runs real Auth/PostgreSQL/REST/Storage security tests; the normal unit command skips that suite unless explicitly enabled. If Chromium is already installed, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`. This command builds the app and tests its production server. Stop your local worker before database/browser acceptance tests so it cannot claim their jobs. Run one browser suite at a time: it uses port 3100, rejects hosted Supabase bindings before writes, explicitly enables the demo, and keeps the synthetic scene store under `.local/e2e`.

The [validation record](docs/VALIDATION.md) records actual results. The [test plan](docs/TEST_PLAN.md) describes coverage and remaining gates.

## Structure and limits

- `packages/scene-core`: strict scene schema v2, versioned operations and lossless v1 migration.
- `packages/geometry`: rotated footprints, collisions, room/ceiling checks and architectural clearances.
- `packages/layout-engine`: bounded deterministic search, independent locks and rigid groups.
- `packages/catalogue`: product/variant contracts, bounded CSV parsing, integer pricing and asset validation.
- `packages/pricing`: exact configured commercial calculations and validated quotation math.
- `packages/inventory`: bounded snapshot/mapping contracts and secure HTTPS/encryption adapters.
- `packages/ui`: accessible shared controls.
- `apps/web`: Next.js application, React Konva editor, account/workspace flows and authenticated server APIs.
- `supabase/migrations`: tenant tables, RLS and checked transactional write functions.

Real project scenes, versions, proposals and catalogues persist in PostgreSQL; assets use a private Storage bucket. The unauthenticated synthetic demo keeps its separate atomic local file adapter. That adapter supports one server process and must contain synthetic data only.

The first three development milestones cover editor rules, accounts/tenant persistence, and catalogue/customer/project workflows. Private references, AI previews, reservations/orders, durable jobs and owned consumer designs are implemented in the bounded local workflow. Live provider acceptance, public hosting/email/monitoring/restore, billing and upstream order acknowledgement remain on the [roadmap](docs/ROADMAP.md). See [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [limitations](docs/KNOWN_LIMITATIONS.md), and the repository's [engineering rules](AGENTS.md).
