# Known limitations

- Local development demo only: no accounts, production tenant isolation, Supabase, real catalogue, pricing, quotations, AI provider, billing, storage uploads or background workers.
- Measured rectangular room and fixed rectangular exclusion zones; no wall/window/door editor, door swing arcs or non-rectangular rooms.
- 2D proxies only; no 3D models/viewer or conceptual image generation. Synthetic product IDs are clearly labelled DEMO.
- Separate position/rotation/product locks work. Group followers are preferences, not hard group locks. Product replacement is not exposed.
- Solver uses a bounded grid search, may fail despite a feasible continuous layout, and cannot prove optimality or infeasibility. Relationships follow the directly requested anchor; nested/rigid group optimisation is deferred.
- No circulation/passage guarantee beyond explicit architectural exclusion zones. Furniture edge contact is allowed. Drag snaps to a 0.1 m grid; no automatic wall snapping or distance guides yet.
- JSON export works; arbitrary file import is not implemented. Saved scenes reload from the local backend.
- Local file persistence supports one process and the latest 100 history snapshots, without multi-replica transactions. Preview IDs expire on commit/restart. Concurrent tabs receive 409 and must reload.
- Lock changes are versioned; explicit undo/redo restore earlier lock states together with geometry.
- Production accessibility/security/performance audits, browser matrices and physical retailer validation remain required. Automated desktop/tablet browser coverage is a first milestone gate, not comprehensive touch-device certification.
