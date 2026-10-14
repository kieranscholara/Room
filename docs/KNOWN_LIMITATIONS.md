# Known limitations

- The first three development milestones are implemented; hosted production rollout, AI, shared 3D rendering, sales proposals/PDFs, billing and durable workers remain future work.
- Rooms are rectangular, 2–30 m wide/deep and 2–6 m high; one room/scene per project. A scene supports up to 30 objects, 15 rigid groups and 50 each of zones/openings. Non-rectangular/multiple rooms are unsupported.
- Door swings and window access use conservative rectangular envelopes. Explicit person-marked circulation zones are checked; automatic passage/reachability analysis is absent.
- The deterministic solver caps candidates/search and can miss feasible layouts. It proves neither optimality nor global infeasibility. See measured fixture observations in [EDITOR_MILESTONE.md](EDITOR_MILESTONE.md).
- Furniture uses 2D rectangular proxies with authoritative outer dimensions. Validated model uploads are available for download, without a 3D rendering view or visual realism certification. Supported categories are bed, wardrobe, bedside, rug and desk.
- Catalogue edits preserve saved scene geometry and can make selections stale. The app reports stale metadata and current prices; automatic product replacement/resizing is unavailable.
- In-stock additions check positive variant stock, but do not reserve/decrement inventory or guarantee availability at checkout. Current totals exclude tax, shipping and discounts and are not issued quotations.
- CSV imports are synchronous, insert-only, at most 1 MiB/500 rows, and atomic. Existing SKUs reject retries rather than upserting. A product retains at most 100 variants including inactive ones; changing an existing variant preserves its ID.
- Catalogue responses contain at most 100 products with offset navigation; workspace availability filtering applies only to the loaded page. Customer/project lists currently cap at 500 without full pagination.
- Assets have a 20 MiB route cap, with images limited further to 10 MiB. GLB/glTF must be static, self-contained triangle geometry within documented bounds/performance limits; compressed, animated, external-resource and several advanced model formats are unsupported.
- Storage registration/removal uses cleanup compensation across database and Storage. Failed cleanup can leave private unlinked bytes; there is no durable orphan-cleanup worker yet.
- Project creation captures metadata and measurements. Scene/room edits and customer CRUD work; full project metadata/status/deletion workflow is not exposed.
- Team invitations require a recipient account and generate copyable URLs; the app sends no invitation email. Customer account access is explicitly shared per project; anonymous proposal/review links are absent.
- Local email confirmation is disabled. Hosted email confirmation/delivery, trusted proxy/Secure-cookie configuration and hosted deployment still need staging validation. Platform-wide administration is absent.
- Undo/redo retain up to 100 snapshots per direction, and the revision endpoint shows 100 versions. Committed PostgreSQL version/operation tables have no retention/export policy yet. Project previews expire after 15 minutes; the pending-count check is not a strict concurrent quota.
- Arbitrary scene JSON import is unavailable; canonical export and backend reload are supported. Lock states deliberately restore with explicit undo/redo.
- The synthetic `/demo` adapter is unauthenticated, single-process and separate from account data; its proposals expire on restart. Restrict it before public production rollout.
- Production rate limits, monitoring, backup/restore guarantees, retention/export/deletion rules, independent security/accessibility audits, physical retailer verification and comprehensive device tests remain required.
