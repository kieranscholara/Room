# Account-free fictional customer trial in Docker

This is a local test environment for Boreal Living, a fictional furniture retailer, its customer Maya and simulated inventory. It needs no Vercel deployment, hosted Supabase keys, signup or email confirmation. Node/npm are included in the Docker image. The salesperson works with the client in the photograph workspace; the visible 2D section is removed while metric geometry, locks and authoritative scene validation remain.

## Start

1. Install/start Docker Desktop with Linux containers. Use Docker Desktop 4.34 or later. On Windows/macOS, enable **Settings → Resources → Network → Enable host networking**, apply and restart Docker. Linux Docker Engine supports this directly.
2. Download/extract or check out the `roomsell/bedroom-editor-milestone` branch of `kieranscholara/Room`. Open a terminal in the folder containing `compose.yaml`.
3. Run `docker compose up --build`.
4. Wait for the log line beginning **READY**. The first image build and official service-image downloads can take several minutes. Keep at least 3 GiB free after downloads; leave additional space for images and data.
5. Open the local app on port 3000 and go to `/testing`. Choose **Open photo placement demo** for the calibrated synthetic room, or **Enter as retailer** / **Enter as customer**. The third persona is the optional marketplace consumer.

The command installs the locked dependencies, starts/reuses the official local Supabase services, applies forward migrations without reset, creates only the registered fictional dataset and runs both the application and worker. Private generated passwords and keys stay in retained local Docker storage. The launcher never prints them.

The container uses host networking to reach the official CLI's loopback-published Supabase services. Port 3000 must be free; an unrelated/mismatched app is left untouched. Stop an existing RoomSell host server before using the Docker trial. The launcher mounts the local Docker engine socket so the CLI can manage its sibling service containers. Use it only as a local development tool.

On Windows, you can also double-click `Start-RoomSell.cmd` after starting Docker Desktop. It checks the Docker daemon and keeps startup errors visible. The Windows batch entry point has been reviewed; the Docker build/runtime have been exercised on Linux, not on a Windows machine.

Builds use ordinary Docker networking. Only the running app requests host networking. If an older downloaded copy reports `additional privileges requested: pass "--allow=network.host"`, obtain the updated branch or remove **only** `network: host` nested inside `build:` in `compose.yaml`. Keep the separate `network_mode: host` runtime setting. `COMPOSE_BAKE=false` is not a reliable workaround on all Docker versions.

## Update your existing Git checkout

Open a terminal in the existing project folder and run:

```sh
git fetch origin
git switch roomsell/bedroom-editor-milestone
git pull --ff-only
docker compose up -d --build
docker compose logs -f app
```

Wait for **READY**, then refresh `http://localhost:3000/testing`. Ctrl+C exits the log display; the detached app keeps running. This updates the existing source and container, retaining `.env.trial` and the saved Docker volumes. It does not require another ZIP download.

## Try the consultation

1. Enter as retailer (Alex), inspect Catalogue and Inventory. Seven fictional products cover bed, wardrobe, bedside, rug and desk, with illustrative images and explicit measured dimensions.
2. Open Maya's measured bedroom project. A bed, two bedside tables, rug, desk and fully locked wardrobe are already placed.
3. In the calibrated synthetic photo, drag an unlocked product, review the preview and **Accept layout**. Rotate/remove a product or place an actual SKU from **Store inventory**. Check that locked furniture stays exact; reload to verify saved positions and calibration.
4. Scan/review visible furniture using the labelled synthetic adapter. In **Complete the room**, request catalogue additions, chosen-product removals or keep/remove advice for known photo regions using **Local fictional-customer test adapter**. Review each action explicitly. Original-image cleanup requires a separately reviewed background job. This test output is not from OpenAI.
5. In **Products and budget**, review the chosen furniture/positions with the client, tick the review checkbox and click **Confirm design for quotation** before reviewing and issuing a new quotation/PDF. This is a local session review and resets after relevant changes/reload. See [PHOTO_SELLING.md](PHOTO_SELLING.md) for the complete steps, including your own photo's short measured calibration.
6. Return to `/testing` and enter as customer (Maya) to review the shared design and quotation. You can reserve, confirm or cancel the fictional order; as retailer you can record fulfilment. A durable Boreal supplier acknowledgement appears on the order. Repeating fulfilment reuses the same supplier reference and does not decrement stock twice.
7. In Inventory, change a simulated upstream SKU quantity and synchronize. The simulated provider reconciles fulfilled quantities; no actual retailer is contacted.

No payment is collected and no real email is sent. If you make changes, the next launch preserves them rather than resetting the consultation.

## Stop and return later

`docker compose down` stops/removes the launcher application container and its own worker. Data stays in the `roomsell-trial_trial-state` volume and official Supabase named volumes. A later `docker compose up --build` restores the same fictional accounts, key, scenes and stock.

The official CLI starts Supabase as sibling containers, outside the Compose app service. To stop those services too, run this **before** taking the app down:

```sh
docker compose exec app node node_modules/supabase/dist/supabase.js stop --project-id roomsell-ai
docker compose down
```

Do not delete the volumes or use destructive reset options if you want to keep test data. Host-Node and Docker launchers should not run simultaneously against different local fixture profiles on port 3000.

## Optional real OpenAI

The trial works without any external keys. To test live OpenAI later, create an ignored `.env.trial` file next to `compose.yaml` and add your key as `OPENAI_API_KEY` (or `ROOMSELL_AI_API_KEY`). Add a value locally, never in chat or source. Recreate the app with `docker compose up -d --build --force-recreate` and select OpenAI in the photo tools or assistant. Explicitly choose whether photographs are sent. Live provider quality, billing/model access and physically measured-room accuracy require separate acceptance.

Hosted Supabase keys are not needed for this trial. Keep them out of `.env.trial`; local seed/preflight deliberately rejects hosted bindings. The file is excluded from Git and Docker build context. Do not run automated database/browser acceptance tests concurrently with this trial's background worker.
