# Edit and sell within the client's photograph

The salesperson works with the client in the uploaded photograph. Retailer projects do not mount a 2D plan, 3D furniture viewer or WebGL canvas. The metric scene remains an internal source of dimensions, positions, locks and collision checks. Catalogue image cutouts are drawn with Canvas 2D and exported into the actual photograph.

## Try the supplied customer without accounts or API keys

1. Start Docker Desktop with Linux containers and runtime host networking enabled. From the folder containing `compose.yaml`, run `docker compose up -d --build --force-recreate`.
2. Run `docker compose logs -f app` and wait for **READY**. Ctrl+C closes the log display without stopping the detached app.
3. Open `http://localhost:3000/testing` on your computer and choose **Open photograph replacement trial**. This signs in as fictional retailer Alex and opens a separate, initially empty photographic project. Existing consultations, stock and identities are retained.
4. The fictional bedroom photograph contains an original bed. Its calibration uses **assumed fictional measurements**, not a physically verified survey. Its source image, recorded object selections, prepared empty-room pixels and transparent Linen bed image are registered fixtures. No live analysis is claimed by this adapter.
5. Follow the steps below with the local fixture provider. The older **Open photo placement demo** remains available for the synthetic geometry example; it is separate from this photographic replacement trial.

## 1. Upload, scan and measure

1. For your own project, upload a normal still photograph under **Client room photograph**, then select it. Avoid panoramas, fisheye and perspective-corrected images. The replacement trial already has its photograph selected.
2. Under **Existing furniture in the photograph**, choose **Local fixture adapter · registered photos only** for supplied examples, or configured **OpenAI · live photograph processing** for your own photo. OpenAI requires explicit consent.
3. Click **Scan room photograph**. When the job completes, click **Use detected selections**. Review labels, outlined areas and missed objects. A single photograph cannot reveal every object or establish exact measurements.
4. Click an original object in the image or its selection card. Open its mask editor to exclude surrounding pixels or restore parts of the selection, then **Save reviewed selections**. Keep selection outlines inside their reviewed bounding rectangle. Include shadows you want removed; hidden wall/floor pixels must be reconstructed rather than recovered from the source.
5. In **Room essentials**, enter and confirm measured room width, depth and height. Enter the X/Z origin, width and depth of a measured rectangular floor patch. Mark its four image corners in the displayed order: origin, along width, opposite, along depth. Click **Save photo calibration**. The supplied trial already has this setup.
6. Inspect alignment. Crossed/degenerate marks are rejected; a low residual measures consistency, not certified accuracy. Changing room dimensions invalidates calibration. Retained furniture blocks new products only after you add and accept its measured physical footprint.

## 2. Remove or replace original furniture

1. Select the original bed in the photograph. Choose **Remove this object** or **Replace this object from store** on its selection card. This saves the reviewed removal choice and queues image cleanup. OpenAI consent is required for live processing.
2. Wait for **Photo cleanup: completed**, inspect **Reviewed cleaned photograph preview**, then click **Use cleaned photograph**. Replacement continues at **Store inventory**. The original source remains available with **Show original photo** and **Restore original background**.
3. Check edges and reconstructed flooring. Adjust the reviewed mask and repeat if needed. Only selected pixels may change; cleanup blends inward at selection edges and preserves every outside pixel. Kept foreground regions can restore original pixels in front of added furniture.
4. Removing photographed pixels does not silently remove a measured physical obstacle. Remove that obstacle separately only if the real furniture will leave the room. Removing an added catalogue product does not alter original photographed pixels.

## 3. Choose actual store inventory

1. Browse **Store inventory**, or request **Complete the room** advice with a brief and budget. Recommendations refer to current retailer variants, dimensions, availability and commercial prices. They cannot invent stock or accept changes automatically.
2. Click **Place Linen upholstered bed**, then click its intended floor position in the photograph. Alternatively drag a catalogue card onto the floor. Review and **Accept layout**.
3. Drag the actual image cutout to move it immediately. Release for a checked preview, then **Accept layout** or **Discard**. Locks, room bounds, measured obstacles, openings and collisions remain enforced.
4. Select the product and choose a supplied **Product photograph view**. **Refine product cutout** removes connected studio background and provides erase/restore brushes. Transparent catalogue images are preferred. No invented view or generic box substitutes for a missing product photograph.
5. **Rotate measured footprint** changes the physical orientation used by geometry. Select an appropriate supplied catalogue view for its appearance: a single image cannot reveal unseen sides. Rugs use a top-down product image projected onto the measured floor. Tall product images keep their source aspect ratio inside the projected metric envelope.

The immediate preview is an image composition, not a claim of perfect depth reconstruction. Use measured dimensions for physical fit; review occlusion, camera alignment and available catalogue angles with the client.

## 4. Save the exact photograph and quote

1. Accept or discard every open layout preview. Click **Save image layers**, then **Render final photograph**. Rendering runs as a durable background job; dragging does not call AI.
2. Review **Final edited room photograph preview**, then click **Use final photograph**. **Download edited photograph** saves its PNG. Changing furniture, calibration, background, image views or masks requires another save/render.
3. Optional **Refine contact lighting with OpenAI** requires separate explicit consent. It edits bounded contact areas; original catalogue cutout pixels are reinserted afterwards so the SKU is not repainted. Review the result before applying it.
4. In **Products and budget**, review the accepted SKUs, prices and positions. Tick **The client has reviewed these furniture choices and positions.**, then **Confirm design for quotation**. The server persists the staff actor/time and exact source, scene, composition and image hash. This is a staff review record, not a customer electronic signature. The visible checklist resets on reload or relevant changes.
5. Click **Review quotation**, review VAT, delivery and installation, then **Issue reviewed quotation**. The server rechecks actor, stock, prices, scene/photo versions and confirmed image proof atomically.
6. The issued quotation pins the exact immutable design image, chosen asset/mask identities and SKU pricing snapshot. Its PDF includes the final photograph. Subsequent edits cannot change an issued quotation; quoted source/final references are protected against deletion.

## OpenAI, limits and operations

Put `OPENAI_API_KEY=…` in your ignored `.env.trial` beside `compose.yaml`, then recreate the app with `docker compose up -d --build --force-recreate`. Never commit or share keys. The account needs billing and model access. Optional settings are `ROOMSELL_AI_MODEL` (default `gpt-4.1-mini`) and `ROOMSELL_IMAGE_MODEL` (default `gpt-image-1`); the server/worker also accepts `ROOMSELL_AI_API_KEY`.

Local scanning/cleanup accepts only registered fixture image hashes. It does not analyse arbitrary photographs. Live scan, cleanup and optional lighting are asynchronous, can incur charges and need human review. AI work shares a 20 jobs/person/hour and 100 jobs/retailer/hour quota. Deterministic photograph exports have a separate 60/person/hour quota. Projects retain the existing limit of 20 room references, including generated cleanup/render images; remove unquoted references when needed. Quoted originals/final images cannot be deleted.

No new dependencies were introduced. Forward migrations 020–022 add versioned composition, confirmed quotation evidence and export quotas. The source photo is never overwritten. Renderer inputs contain only selected object IDs, authorised image asset IDs and bounded alpha masks; prices, dimensions, arbitrary image URLs and caller-chosen scale are rejected. Live OpenAI quality, a real measured room, Windows execution and hosted operations require acceptance outside this cloud fixture run. See [VALIDATION.md](VALIDATION.md).
