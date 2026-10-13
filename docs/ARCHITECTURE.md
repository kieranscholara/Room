# Architecture and milestone gates

## Working milestone 1: foundation and measured editor

Next.js serves the UI and an authoritative scene API. The canonical scene is shared by the React Konva floor plan, pure geometry functions, and deterministic solver. Client state uses Zustand/Immer. Geometry and layout packages contain no React, network calls, or LLMs. The scene schema validates all API operations. Server-generated previews are accepted by ID and base version, not by trusting an arbitrary client scene.

Flow: operation → schema validation → version check → lock check → trial geometry → candidate search → preview → explicit acceptance → revalidation → atomic local persistence. Committed versions increase monotonically. Undo/redo intentionally restore prior complete scene snapshots under the same version check. An in-process queue serialises writes.

The file adapter is a working local development substitute for the future PostgreSQL transaction layer. It provides no accounts or tenant security and must only contain synthetic data. Next.js runs as one process with one writable data directory. The server remains the authority even when UI controls disable an action.

Shared UI uses small native accessible primitives with Tailwind available and custom styling. Full shadcn/ui composition, Three.js rendering, catalogue and pricing packages are deferred until their actual workflows are implemented; no empty packages or inactive product controls are included.

## Subsequent gates

1. Foundation/editor: strict TypeScript, documented contracts, CI, geometry properties, running editor, server lock/version tests and browser acceptance.
2. Multi-tenant foundation: Supabase Auth, organisations/members, role checks, migrations/RLS and real cross-tenant database tests. Move file persistence into transactional repositories without changing domain APIs.
3. Real catalogue/3D: validated products/variants/assets, imports, shared transforms in React Three Fiber, proxy disclosure and tests comparing both views.
4. AI/budget: provider abstraction, schema-validated intentions only, authoritative catalogues and integer minor-unit calculations.
5. Sales: immutable issued price snapshots, PDFs, approval/revision workflow and restricted customer links.
6. Commercial deployment: durable jobs, signed Stripe webhooks, subscription limits, monitoring, retention, backups and pilot rollout.

Each gate needs working acceptance tests and code review before major work proceeds. No production-readiness claim follows from the local milestone. See ROADMAP for immediate tickets.
