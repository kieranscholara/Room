# Known limitations

## Current photograph editor limits — 17 October 2026

Retailer editing now uses actual catalogue image cutouts in the uploaded photo, without a 3D furniture view. Immediate movement is local; vision, cleanup and optional lighting are asynchronous. One photograph cannot establish all objects, hidden surfaces or exact room geometry. Room measurements/calibration must be supplied and reviewed; original furniture needs measured obstacles for physical collision checks.

Tall product cutouts preserve supplied aspect/view inside a projected metric envelope, so apparent alignment is approximate. Footprint rotation does not synthesize a new product angle. Rugs use a supplied top-down image. Masks and reconstructed backgrounds may need manual correction; appropriate catalogue photos/transparent assets matter. No live OpenAI visual-quality result or physically verified fit is claimed by the fictional fixture. Staff confirmation is persisted image evidence, not a customer signature.

The existing bounded limits include 30 objects, 20 room references including generated renders, bounded masks and per-actor/organisation job quotas. Quoted source/final references are intentionally retained. Earlier model/proxy descriptions below apply to legacy workspaces, not the current retailer photo compositor.

## Current platform boundary

The current increments supersede older missing-feature statements below. Private references, bounded AI/OpenAI transport, durable jobs, reservation/order lifecycle, optional idempotent supplier acknowledgement, password recovery and owned consumer publication/enquiry are implemented locally. Live OpenAI, real retailer provider acceptance, managed projects/SMTP/alerts/hosted restore remain unconfigured. Snapshot-only stock providers cannot fulfil orders without configuring the supported acknowledgement contract. One supplier connection per order is supported; an unknown outcome remains held for idempotent recovery. No payments, billing, shipping, global marketplace search/moderation or 3D mesh editing is included. Hosted request-size limits and commercial retention need deployment acceptance. See CURRENT_STATE.md and DEPLOYMENT.md for current evidence and operating limits.

Retailer projects now open directly in a salesperson-operated photograph consultation; the visible 2D section is removed. Legacy demo/personal rooms use 3D only. Scene geometry remains metric and authoritative. AI scans approximate visible areas for human correction; it cannot guarantee all-object detection, automatic dimensions, depth or photorealistic product appearance. Photo alignment needs measured floor calibration and suitable product models; retained original furniture needs a measured obstacle footprint for collision checks.

Client design confirmation before a new quotation is a local session checklist bound to the scene/photo/product review. It resets after relevant changes or reload and is not a saved signature or server authorisation. Backend issuance independently checks source/version, permissions, prices and stock. See [PHOTO_SELLING.md](PHOTO_SELLING.md).

## Earlier checkpoint limitations (historical)

- Architecture roadmap steps 1–4 are implemented; actual retailer feed configuration, hosted production rollout, room references, AI, reservations/orders, marketplace, billing and durable workers remain future work.
- Rooms are rectangular, 2–30 m wide/deep and 2–6 m high; one room/scene per project. A scene supports up to 30 objects, 15 rigid groups and 50 each of zones/openings. Non-rectangular/multiple rooms are unsupported.
- Door swings and window access use conservative rectangular envelopes. Explicit person-marked circulation zones are checked; automatic passage/reachability analysis is absent.
- The deterministic solver caps candidates/search and can miss feasible layouts. It proves neither optimality nor global infeasibility. See measured fixture observations in [EDITOR_MILESTONE.md](EDITOR_MILESTONE.md).
- Furniture uses authoritative rectangular geometry and synchronized 2D/3D views. The read-only 3D viewer uses matching validated models or labelled measured proxies; it makes no visual realism certification. Supported categories are bed, wardrobe, bedside, rug and desk.
- Catalogue edits preserve saved scene geometry and can make selections stale. The app reports stale metadata and current prices; automatic product replacement/resizing is unavailable.
- In-stock additions check positive variant stock, but do not reserve/decrement inventory or guarantee availability at checkout. The live catalogue subtotal excludes commercial adjustments; issued immutable quotes apply explicit configured tax, delivery, installation and discounts, checking aggregate stock without reserving it.
- CSV imports are synchronous, insert-only, at most 1 MiB/500 rows, and atomic. Existing SKUs reject retries rather than upserting. A product retains at most 100 variants including inactive ones; changing an existing variant preserves its ID.
- Catalogue responses contain at most 100 products with offset navigation; workspace availability filtering applies only to the loaded page. Customer/project lists currently cap at 500 without full pagination.
- Assets have a 20 MiB route cap, with images limited further to 10 MiB. GLB/glTF must be static, self-contained triangle geometry within documented bounds/performance limits; compressed, animated, external-resource and several advanced model formats are unsupported.
- Storage registration/removal uses cleanup compensation across database and Storage. Failed cleanup can leave private unlinked bytes; there is no durable orphan-cleanup worker yet.
- Project creation captures metadata and measurements. Scene/room edits and customer CRUD work; full project metadata/status/deletion workflow is not exposed.
- Team invitations require a recipient account and generate copyable URLs; the app sends no invitation email. Customer account access is explicitly shared per project; anonymous proposal/review links are absent.
- Local email confirmation is disabled. Hosted email confirmation/delivery, trusted proxy/Secure-cookie configuration and hosted deployment still need staging validation. Platform-wide administration is absent.
- Undo/redo retain up to 100 snapshots per direction, and the revision endpoint shows 100 versions. Committed PostgreSQL version/operation tables have no retention/export policy yet. Project previews expire after 15 minutes; the pending-count check is not a strict concurrent quota.
- Arbitrary scene JSON import is unavailable; canonical export and backend reload are supported. Lock states deliberately restore with explicit undo/redo.
- The synthetic `/demo` adapter is unauthenticated, single-process and separate from account data; its proposals expire on restart. It is disabled unless ROOMSELL_ENABLE_DEMO=1 is explicitly set.
- Production rate limits, monitoring, backup/restore guarantees, retention/export/deletion rules, independent security/accessibility audits, physical retailer verification and comprehensive device tests remain required.

- Inventory supports manual bounded custom REST snapshot synchronization of explicitly mapped variants, not Shopify/WooCommerce-native APIs, webhooks, scheduling or automatic product creation. No live feed is configured by source code. Provider timestamps must advance and be within 15 minutes. Encryption-key rotation needs credential re-enrolment.
- Quotation lists show the latest 50 issued records; formal tax/legal invoice numbering, payment, checkout, order lifecycle and reservation expiry are separate commercial requirements. PDFs use a standard embedded font and replace unsupported characters; multilingual font coverage remains a follow-up.
