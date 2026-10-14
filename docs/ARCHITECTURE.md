# Architecture

Next.js serves account/workspace pages, the React Konva editor and authoritative HTTP APIs. Zustand/Immer holds client editor state. Framework-independent TypeScript packages own scene contracts, geometry, layout and catalogue validation. Geometry and search contain no React, network or LLM calls.

## Editor authority

The operation flow is schema validation → current permission/version checks → lock checks → geometry/search → server-owned preview → explicit acceptance → recomputation and validation → transaction. The client cannot commit a replacement scene. Scene schema v2 adds measured room openings and rigid groups; strictly recognised v1 scenes migrate without changing identities, dimensions, transforms or locks.

`EditorService` uses a persistence interface. Authenticated project routes provide a request-scoped Supabase adapter; `/demo` uses an atomic local file adapter. Both share geometry and operation rules. PostgreSQL commits lock the organisation and scene, recheck the actor's current edit permission, compare the expected version, append a scene version and operation, update undo/redo state, and invalidate obsolete previews. Adding furniture repeats catalogue identity/dimension/availability checks under the same organisation lock used by catalogue writes.

Undo/redo restore complete validated snapshots while advancing the committed version. Each direction retains up to 100 snapshots. The revision endpoint returns the latest 100 committed snapshots. PostgreSQL versions and operations persist separately from the undo stacks. Saved project previews are actor-scoped and expire after 15 minutes; the local demo's previews live in one process.

## Accounts and tenant data

Supabase Auth verifies users. Server routes use request-scoped SSR clients and HttpOnly, SameSite=Lax session cookies. Session checks use `auth.getUser()`. Hosted connections require HTTPS, and cookie security depends on the trusted reverse proxy's HTTPS header. The service-role client and provider keys are server-only.

Organisation memberships define owner, admin, salesperson, designer and customer roles. RLS and explicit SQL grants restrict database reads and writes; composite foreign keys prevent cross-organisation relationships. Sensitive RPCs repeat authority checks after locking the organisation. Customer accounts see only explicitly shared projects, with independent view/edit grants. Customer contact records are business data and do not create account permissions.

## Catalogue and projects

Products and variants hold retailer-entered identities, dimensions, active/availability flags, stock, lead time and safe integer minor-unit prices. Owners/admins make atomic product/variant writes through service-only checked functions. Omitted variants and archived products retain their identities for historical scenes. Bounded CSV imports validate the whole file and insert all rows or none; completed/failed summaries are persisted.

Images and self-contained GLB/glTF files are validated before private storage. Asset metadata is registered only after storage succeeds and current authority/dimensions are checked again. App asset URLs authenticate every request; customer delivery is limited to assets belonging to variants already selected in an authorised project. The browser receives no provider credentials or unrestricted storage URL.

New projects capture customer, budget, currency, style, room type and measured room dimensions. Each project currently has one room and scene. Furniture additions use real variant IDs and immutable scene snapshots of their measured metadata. The project product endpoint resolves current prices, reports stale selections and sums integer minor units. It does not issue a quotation or reserve inventory.

## Implemented milestones and later gates

The first three milestones cover measured editor rules, accounts/tenant persistence, and catalogue/customer/project workflows. The local test stack runs the actual PostgreSQL/Auth/REST/Storage services; CI applies migrations and runs database security checks alongside unit, build and browser gates.

Later milestones add a shared 3D view, schema-validated AI intentions, complete budget/tax rules, immutable issued proposals/PDFs, billing and durable jobs. Production rollout additionally needs hosted configuration validation, rate limits, monitoring, backups/restores, retention and physical retailer acceptance. See [roadmap](ROADMAP.md) and [limitations](KNOWN_LIMITATIONS.md).
