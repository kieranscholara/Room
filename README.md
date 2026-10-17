# RoomSell AI

RoomSell is a salesperson-operated consultation: upload the client's room photograph, review AI object selections, confirm room measurements and a short floor calibration, choose retailer inventory, position products in the photograph, confirm the client's choices, then quote. Retailer projects open directly in the photograph workspace; the visible 2D section has been removed. One metric scene still enforces dimensions, locks and fit. Real projects start empty and use products entered or imported by their retailer.

The application also includes Supabase accounts and organisation permissions, configured pricing, immutable quotations/PDFs, private photographs, checked design assistance, durable jobs/orders, a bounded consumer marketplace and a custom REST inventory connector. Separate legacy demo/personal-room workspaces use a 3D view. `/demo` is enabled only with `ROOMSELL_ENABLE_DEMO=1`.

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

For a fictional customer trial entirely through Docker, use Docker Desktop 4.34+ with Linux containers and **Settings → Resources → Network → Enable host networking** turned on (Linux Docker Engine already supports host networking). In the repository folder run:

```sh
docker compose up --build
```

On Windows you can also double-click `Start-RoomSell.cmd`. Builds use ordinary networking; host networking is needed only by the running local app.

Wait for **READY**, then open `/testing` in the local application on port 3000. Click **Open photograph replacement trial** for the generated photographic bedroom and recorded replacement adapter, or **Enter as retailer** / **Enter as customer** for the full workspace. The older synthetic placement example remains available separately. No signup, password entry, email verification, Vercel account or hosted Supabase key is required. Node/npm are included in the image. The first build/service downloads may take several minutes; later launches reuse them.

The local-only launcher uses your Docker engine socket to start the official Supabase services. It retains fictional accounts, stock, scenes and the connector encryption key in Docker volumes. Keep this setup local; it is not a hosted deployment configuration. See [the Docker walkthrough](docs/DOCKER_TRIAL.md).

If you prefer Node.js 24 on your computer with Docker only for Supabase, `npm run try:customer` is also available. Generated images and inventory are explicitly fictional. The labelled local AI adapter needs no API key and is not OpenAI; live OpenAI is optional. See [the customer walkthrough](docs/TEST_CUSTOMER.md) and [photo selling guide](docs/PHOTO_SELLING.md).

## Use the application

1. Open `/workspace`, create an account and organisation, and choose its currency. Local signup signs in immediately; hosted email confirmation needs the provider configuration described in the deployment guide.
2. As an owner or admin, create real products and variants in Catalogue, or import the documented CSV format. Enter authoritative dimensions, prices, availability, stock and lead times. Upload validated photographs or model files if available.
3. Create a customer contact and project with a budget. Open the project, upload a room photo and scan it using OpenAI or the labelled registered-fixture adapter. Review missed/incorrect object selections. Confirm measured room dimensions and mark a measured floor rectangle. AI does not establish measurements or guarantee identification of every object.
4. Use **Complete the room** for catalogue additions, suggested removals of chosen products and keep/remove advice for reviewed photo regions. Choose an actual SKU from a recommendation or **Store inventory**, then click/place, drag or rotate it in the photograph. **Accept layout** saves each checked preview. Select an original object and use **Remove this object** or **Replace this object from store**, then review and apply its cleaned background. Source pixels outside the reviewed mask remain unchanged; neither AI nor dragging accepts changes automatically.
5. Invite colleagues or customers through Team. Copy the generated invitation link to the intended recipient. Owners/admins can grant a customer account view or edit access to a particular project; a contact record alone grants no access.

Click **Save image layers**, **Render final photograph**, then **Use final photograph** after reviewing the result. Download the PNG if needed. **Products and budget** shows accepted choices, catalogue prices and the saved budget. Review them with the client, tick **The client has reviewed these furniture choices and positions.**, then click **Confirm design for quotation**. The server records staff confirmation against the exact image hash and scene/photo/composition revisions; this is not a customer signature. Scene/photo/image changes require a new render and review; reload resets the visible checklist. Issued quotations pin that exact image and include it in the PDF. New quotation controls are gated by that confirmation; existing issued quotation history remains available. Owners/admins configure explicit tax/discount/fee/rounding rules in Pricing. The server independently rechecks source/version, aggregate stock and exact pricing when issuing immutable quotation/PDF snapshots. Authorised customers can reserve/confirm an order; retailer fulfilment preserves quoted prices.

Retailer projects draw actual catalogue image cutouts with Canvas 2D; no 3D furniture viewer or WebGL is required. Appropriate supplied product views and alpha-mask brushes control appearance. Footprint rotation does not invent unseen product surfaces. Rugs project a top-down product photograph onto the floor; tall images preserve their source aspect inside a metric envelope. Photo alignment depends on confirmed measurements and calibration. Retained original furniture needs a measured obstacle footprint to participate in fit checks.

Inventory lets owners/admins configure a public HTTPS custom REST snapshot endpoint and explicit provider-to-variant mappings. A server-only `ROOMSELL_CONNECTOR_ENCRYPTION_KEY` (32 random bytes in base64) is required to save credentials or sync. Configure secrets through deployment settings; never paste them into source. Live retailer integration requires an actual endpoint/feed and token. See [inventory contract](docs/INVENTORY.md).

For the main test, open `/testing` and choose **Open photograph replacement trial**. Scan the fictional photographic room, replace its original bed with the actual Linen catalogue image, move it, render/save and quote. The fixture has assumed fictional measurements and recorded cleanup, not physically verified calibration or live AI. Follow the exact [photo editing walkthrough](docs/PHOTO_SELLING.md).

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
- `apps/web`: Next.js Canvas 2D photograph consultation, shared scene store, separate legacy 3D adapters, account/workspace flows and authenticated server APIs. Legacy Konva code remains in the repository but is not mounted in the editor UI.
- `supabase/migrations`: tenant tables, RLS and checked transactional write functions.

Real project scenes, versions, proposals and catalogues persist in PostgreSQL; assets use a private Storage bucket. The unauthenticated synthetic demo keeps its separate atomic local file adapter. That adapter supports one server process and must contain synthetic data only.

The first three development milestones cover editor rules, accounts/tenant persistence, and catalogue/customer/project workflows. Private references, AI previews, reservations/orders, durable jobs and owned consumer designs are implemented in the bounded local workflow. Password recovery, optional idempotent supplier acknowledgement and operational checks are also implemented. Live provider acceptance, public hosting/SMTP/alerts/restore and billing remain on the [roadmap](docs/ROADMAP.md). See [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [limitations](docs/KNOWN_LIMITATIONS.md), and the repository's [engineering rules](AGENTS.md).
