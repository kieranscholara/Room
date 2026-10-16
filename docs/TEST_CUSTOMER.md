# Boreal Living fictional customer

For the main photograph-selling workflow, start with **Open photo placement demo** on `/testing`. See [PHOTO_SELLING.md](PHOTO_SELLING.md) for upload, calibration, immediate SKU placement, original-object removal and live OpenAI setup.

Boreal Living is an authorised synthetic retailer, not a real company. Its catalogue, SKUs, contacts and inventory are deliberately fictional. Generated studio product photographs and a staged bedroom reference are illustrative and are not proof of product dimensions or fit. Measured dimensions in the catalogue/scene remain authoritative.

## Start the scenario

For Docker-only startup, follow [DOCKER_TRIAL.md](DOCKER_TRIAL.md): `docker compose up --build`. No Node installation or hosted accounts are needed.

For the alternative host-Node workflow, install Node.js 24 and start Docker Desktop/Engine. From the repository root run:

```sh
npm run try:customer
```

This handles missing npm dependencies, verified local services, migrations, local test flags, a stable connector key, app startup, idempotent fixture preparation and a worker. No Vercel account, hosted Supabase keys, signup or email confirmation is needed. The first run may take several minutes to download service images. Keep the terminal open when the command starts processes; Ctrl+C stops its own app/worker, with saved data retained. A second run reuses a matching healthy app and verified worker.

If you already run the app manually, the separate commands remain `npm run seed:test-customer` and `npm run worker`.

Open `/testing` in the running application. Choose Showroom manager (Alex), Shared project customer (Maya) or Marketplace consumer (Leo). No passwords need to be copied. The shortcut exists only with `ROOMSELL_ENABLE_TEST_CUSTOMER=1`, `ROOMSELL_LOCAL_SUPABASE=1` and a verified local target. It rechecks the registered synthetic account IDs and does not impersonate ordinary users.

The seed is repeatable: it repairs missing supplied images, reference and initial publication without replacing existing scenes, stock or an administrator's existing publication decisions. It verifies the exact registered company/product/account identities. Secrets are generated locally and stored in `.local/fixtures` with restricted permissions; never share or commit that directory.

## Retailer and customer journey

1. As manager, inspect Catalogue photographs and actual dimensions/SKUs. The measured bedroom contains a bed, two bedside tables, rug, desk and fully locked wardrobe.
2. Inventory has a clearly labelled simulated provider panel. Change a test SKU's upstream stock, then run synchronous sync or queue background sync. Only the registered fictional connector uses this in-process provider; other connections use the secure real HTTPS adapter.
3. Open Maya's project. View/upload a private room reference. The photograph does not confirm measurements. Select the local test assistant and request advice; the worker processes the durable job. Reloading the project recovers the latest job. Review its suggested layout and explicitly accept it. The wardrobe must remain exact.
4. Review and issue the configured quotation. Switch to Maya and reserve the quotation for 15 minutes, then confirm or cancel. Return as Alex to record fulfilment. No payment or email is sent. The fictional upstream reconciles fulfilled quantities so later sync cannot restore sold stock.
5. For independent scenarios, create a fresh project rather than deleting or resetting the supplied consultation. Sharing grants view/edit/order separately; contacts alone provide no access.

The fictional supplier now implements the optional custom REST fulfilment contract: exact mapped external IDs, quantities, order UUID and a frozen request hash; an immutable `BOREAL-…` acknowledgement; idempotent retries; explicit rejection if upstream test stock is unavailable. Its order ledger is retained privately alongside fixture state. It is an in-process simulator, not a real external supplier. Ordinary connections keep DNS-pinned public HTTPS transport and need a compatible supplier endpoint.

To test a supplier decline, confirm an order, reduce an involved SKU's simulated upstream stock to zero **without synchronizing first**, then record fulfilment. The supplier declines, local stock is not decremented, and cancellation remains available. Cancel, synchronize and issue a new quotation after reviewing stock. A network timeout instead leaves the order pending: retry fulfilment rather than creating another supplier order.

The sign-in page also offers password recovery. Local test mail is captured on port 54324 and does not leave the machine. Open the recovery email in the browser that requested it. One-click fictional personas do not require this flow.

## Consumer journey

As Leo, open `/marketplace`, inspect explicitly published fictional offers and open/create a private measured personal room. Preview and accept a published product, set locks and compare 2D/3D. Personal rooms use exact measured 3D proxies. Reload to verify persistence.

Check the explicit consent box and request a quotation from a selected retailer. A new retailer project receives the measured room, that retailer's products and Leo's account contact. The original personal design stays private. Retailer staff can then issue an accurate quotation in the normal flow. Unpublish an offer in the manager's Marketplace panel to revoke its public image/API access.

## Live integrations and test limits

OpenAI is separately selectable once a server-only `ROOMSELL_AI_API_KEY` or `OPENAI_API_KEY` is supplied securely. The local test adapter is explicitly labelled and does not call OpenAI. Selecting the photo checkbox sends at most two project references to OpenAI; leave it unselected to avoid sending photographs.

The provider simulator is for development and small acceptance datasets (bounded to 10,000 fulfilled item rows). Its filesystem state is not a production inventory system. Automated browser tests use a separate fictional fixture set, `.local/e2e-fixtures`, with a separate encryption key and worker token. Stop local worker processes before automated database/browser tests: the lease tests require no unrelated pending jobs and never reset the database.
