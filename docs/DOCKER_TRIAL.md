# Account-free fictional customer trial in Docker

This is a local test environment for Boreal Living, a fictional furniture retailer, its customer Maya and simulated inventory. It needs no Vercel deployment, hosted Supabase keys, signup or email confirmation. Node/npm are included in the Docker image. The salesperson works with the client in the photograph workspace; the visible 2D section is removed while metric geometry, locks and authoritative scene validation remain.

## Start

1. Install/start Docker Desktop with Linux containers. Use Docker Desktop 4.34 or later. On Windows/macOS, enable **Settings → Resources → Network → Enable host networking**, apply and restart Docker. Linux Docker Engine supports this directly.
2. Download/extract or check out the `roomsell/bedroom-editor-milestone` branch of `kieranscholara/Room`. Open a terminal in the folder containing `compose.yaml`.
3. Run `docker compose up --build`.
4. Wait for the log line beginning **READY**. The first image build and official service-image downloads can take several minutes. Keep at least 3 GiB free after downloads; leave additional space for images and data.
5. Open the local app on port 3000 and go to `/testing`. Choose **Open photograph replacement trial** for the photographic bed replacement example, or **Enter as retailer** / **Enter as customer**. The third persona is the optional marketplace consumer.

The command installs the locked dependencies, starts/reuses the official local Supabase services, applies forward migrations without reset, creates only the registered fictional dataset and runs both the application and worker. Private generated passwords and keys stay in retained local Docker storage. The launcher never prints them.

The container uses host networking to reach the official CLI's loopback-published Supabase services. Port 3000 must be free; an unrelated/mismatched app is left untouched. Stop an existing RoomSell host server before using the Docker trial. The launcher mounts the local Docker engine socket so the CLI can manage its sibling service containers. Use it only as a local development tool.

On Windows, you can also double-click `Start-RoomSell.cmd` after starting Docker Desktop. It checks the Docker daemon and keeps startup errors visible. The Windows batch entry point has been reviewed; the Docker build/runtime have been exercised on Linux, not on a Windows machine.

Builds use ordinary Docker networking. Only the running app requests host networking. If an older downloaded copy reports `additional privileges requested: pass "--allow=network.host"`, obtain the updated branch or remove **only** `network: host` nested inside `build:` in `compose.yaml`. Keep the separate `network_mode: host` runtime setting. `COMPOSE_BAKE=false` is not a reliable workaround on all Docker versions.

## Update using a ZIP

Download the exact current-commit ZIP supplied with the delivery. Extract it to a new folder and copy your existing ignored `.env.trial` beside its `compose.yaml`. In that folder run `docker compose up -d --build --force-recreate`, wait for READY in `docker compose logs -f app`, then hard-refresh `http://localhost:3000/testing`. The fixed Compose project and existing named volumes retain data. Do not run `down -v` or delete Supabase volumes. Rebuilding an old folder cannot fetch new source files.

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

Use the complete [photograph editing walkthrough](PHOTO_SELLING.md). Start with **Open photograph replacement trial**: scan the registered fictional photograph, review its bed selection, replace it with the Linen store bed image, drag and accept its position, save/render/use the final photograph, confirm and quote. The image is included in the issued PDF. The primary retailer workspace uses Canvas 2D image cutouts, with no 3D furniture viewer.

The older six-object measured project and **Open photo placement demo** remain separate. Inventory, customer reservation/order, simulated supplier fulfilment and the optional consumer workflow remain in [TEST_CUSTOMER.md](TEST_CUSTOMER.md). No payment is collected and no real supplier is contacted. Updates preserve existing data rather than reset the consultation.

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
