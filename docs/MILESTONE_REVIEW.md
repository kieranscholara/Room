# First milestone review

Review performed against the repository's geometry, lock and acceptance rules. This is a self-review, not an independent security or production audit.

## Correctness boundaries reviewed

- Canonical scene validation rejects unknown fields, invalid IDs/relationships, nonfinite transforms and invalid zones. Layout requests require confirmed room measurements.
- Geometry uses full rotated footprints rather than unrotated bounding boxes. Rugs may overlap furniture but every object obeys room/ceiling/architecture constraints. Door safety uses a conservative rectangular exclusion zone.
- The requested object cannot move/rotate through its locks. Fixed locked objects stay exact; rotation-only locks retain exact radians during candidate generation. Product identities and dimensions have no mutation path.
- Preview results are separated from persistence. Acceptance recomputes the original server-owned operation. Version checks happen inside the serial write queue before any mutation. Returned proposal objects cannot be used to inject changed geometry.
- Undo/redo intentionally restore entire snapshots, including prior locks, and always advance the committed version. A branch clears redo history.
- Persistence validates saved scenes/history, uses atomic file replacement and never reports a write as successful before it completes. The adapter remains explicitly single-process/local-only.

## Findings resolved during validation

Browser hydration required explicit loopback development-origin configuration in Next.js 16.4. Browser POST origin checks now compare the actual HTTP Host rather than Next.js's internal bind address. The negative acceptance assertion is scoped to the editor's alert, avoiding Next.js's route announcer. Labels remain upright when furniture rotates, and the decorative inspector illustration is labelled illustrative rather than dimensionally accurate.

## Deferred risks and gates

No authentication, production multi-tenant/RLS testing, database transactions, real catalogue, quotation or payment workflow is claimed. Grid-search limits may miss feasible layouts. Nested/rigid groups, circulation preferences and larger-scene performance need a separate bounded editor enhancement. The next major gate is Supabase Auth plus organisation/RLS isolation, with actual cross-tenant database tests.
