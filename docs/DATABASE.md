# Persistence and database roadmap

Implemented: an atomic local JSON file with canonical scene, 100 recent undo snapshots and 100 redo snapshots. Writes use a temporary file and rename; an in-process queue serialises version checks and commits. Files are mode 0600. One server process is supported. There are no SQL migrations or production database tables yet.

Phase 3 will introduce Supabase PostgreSQL migrations for organisations, organisation_members, customers, products, variants, assets, inventory, projects, rooms, scenes, scene_versions, scene_operations and audit_logs. Later migrations add proposals/items/events, jobs, subscriptions and usage. Use organisation-scoped unique SKUs and composite tenant foreign keys to prevent relational cross-tenant references. Every tenant table needs indexed organisation IDs and RLS based on verified membership, not client-supplied roles.

Scene commits will run under a row lock/compare-and-swap transaction with an append-only operation and version record. Catalogue identity/dimensions are resolved server-side. Historical issued proposal items must store immutable SKU, description, quantity, currency and integer-minor-unit price snapshots. Never reference mutable product prices for historical totals.

The SQL design and migration/security tests must be implemented and verified before real data is introduced. No undocumented manual database setup or claimed RLS enforcement exists in this milestone.
