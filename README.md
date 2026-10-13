# RoomSell AI

RoomSell's first milestone is a running, measured 2D bedroom editor with deterministic rearrangement and server-enforced furniture locks. It uses **synthetic demo furniture**, not retailer inventory. This is a local development application, not yet a production SaaS.

## Run

Use Node.js 24 (minimum 22) and npm. From the existing repository checkout:

```sh
npm ci
npm run dev
```

The application serves on port 3000. In restricted cloud workspaces, use `npm ci --cache /workspace/.npm-cache` so npm writes to an available directory. No external credentials or database are required for this milestone.

Try the flagship scenario: select the bed, keep Smart Rearrange selected, set Z to **3.8** and rotation to **180°**, then **Preview placement**. Both bedside tables and the rug follow the bed. The wardrobe stays fully locked at its exact saved transform. Accept or discard the preview. Undo/redo restore exact earlier object states; page reload retrieves the saved revision.

You can also drag unlocked furniture in the plan, rotate it with the properties controls, toggle separate position/rotation/product locks, switch to manual mode, pan/zoom, and export canonical scene JSON. Every accepted edit is saved automatically; previews are not saved. Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z redoes; Escape discards a preview.

## Validate

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

If Chromium is already installed, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e` instead of downloading a browser. Browser tests use an isolated `.local/e2e` data directory and port 3100; do not run two instances of that suite concurrently. They clear only their test data at the start of the run.

`npm run start` serves a completed production-mode build, but the **application itself remains a local demo**. Never expose it to real users or place customer/retailer data in it before authentication and tenant isolation are implemented.

## Packages and persistence

- `packages/scene-core`: strict, versioned Zod scene and operation contracts; synthetic fixture.
- `packages/geometry`: oriented footprints, SAT collisions, room/ceiling/architecture checks.
- `packages/layout-engine`: bounded deterministic candidate search; locks and group preferences.
- `packages/ui`: accessible shared button and form primitives.
- `apps/web`: Next.js App Router application, Konva editor, Zustand/Immer client state, authoritative local scene API.

The backend writes `.local/scene.json` relative to `apps/web`, using atomic replacement. Set `ROOMSELL_DATA_DIR` to a persistent writable directory to retain local designs. Stop the server before backing up or intentionally deleting that directory. One server process owns the local file; multiple replicas are unsupported. History holds the latest 100 undo/redo snapshots. No Supabase migration is needed yet.

See [architecture](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md), [test plan](docs/TEST_PLAN.md), and [limitations](docs/KNOWN_LIMITATIONS.md). The existing [AGENTS.md](AGENTS.md) engineering rules apply.
