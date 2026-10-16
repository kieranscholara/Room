# Photo-first selling

The salesperson operates RoomSell with the client. Retailer projects open directly in the client's photograph; the 2D section is no longer visible. Product positions, dimensions, locks and fit checks still use one metric scene. Legacy demo and personal-room workspaces show 3D only.

## Start with the fictional retailer

1. In the existing Git checkout, run `git pull --ff-only`, then `docker compose up -d --build`. Wait for **READY** in `docker compose logs -f app`. Keep the existing Docker volumes.
2. On your computer open `http://localhost:3000/testing` and click **Open photo placement demo**. No signup or API key is needed.
3. The labelled synthetic room has a known camera calibration. Seven fictional product models have exact catalogue bounds; their appearance is illustrative, not a manufacturer's representation. The separate generated photorealistic bedroom has no claimed calibration ground truth.
4. Follow the consultation links: **Upload, scan and measure**, **Complete the room**, **Choose and position furniture**, then **Confirm and quote**.

## Upload, scan and measure

1. For a new consultation, create a contact/project and budget, then open the project as retailer staff. Use **Upload photo** and choose it under **Client room photograph**. Use an ordinary undistorted still photograph with its original aspect ratio; avoid panoramas, fisheye and perspective-corrected images.
2. Under **Existing furniture in the photograph**, choose the provider. For the supplied synthetic image choose **Local fixture adapter · synthetic demo only**. For other images use configured **OpenAI · live photograph processing** and give explicit consent.
3. Click **Scan room photograph**, wait, then **Use detected selections**. Review the labels and approximate rectangles; add or correct missed/partly hidden objects. A single photograph cannot reveal every object or establish exact room measurements.
4. Choose **Keep in photograph** or **Remove from photograph**, then **Save reviewed selections**. These choices describe image areas; they do not silently change catalogue objects or physical obstacles.
5. In **Room essentials**, enter and confirm the measured room width, depth and height. Measure a visible rectangular floor patch and enter its room X/Z origin, width and depth. Mark its four corners clockwise: origin, along width, opposite, along depth. A partial-room patch is supported.
6. Click **Save photo calibration**. Crossed, degenerate or inconsistent points are rejected. Room dimension changes invalidate calibration. Inspect alignment: calibration residual measures consistency, not certified measurement accuracy.
7. A retained original object blocks new furniture only after its footprint is measured. Under **Confirm an existing object's physical footprint**, enter its X/Z and size, preview the obstacle and accept it. Manage/remove existing obstacles in **Room essentials**.

## Complete the room and choose inventory

1. Open **Complete the room**. Select a provider, enter the client's brief and budget preferences, and select the relevant photograph with consent where applicable. Submit **Request design assistance**.
2. Review the result. Additions reference current retailer variants/SKUs; quantity, availability, commercial budget, scene version and permissions are checked. Advice cannot invent inventory, dimensions or prices.
3. **Preview removal of …** proposes removal of an existing chosen catalogue object. Review and **Accept layout** to commit it; locked objects remain protected.
4. For existing photo-region suggestions, select the advice you agree with and click **Save reviewed photo choices**. Only known reviewed selections can be changed. A suggested removal marks an area; it does not perform image cleanup automatically.
5. Click **Choose … for photograph** on a recommendation, then click the intended floor position in the photo. Alternatively find a variant in **Store inventory**, drag its card onto the floor, or click **Place …** then the floor. The recommendation button does not choose an arbitrary placement for the client.

## Position furniture in the photo

1. Drag an unlocked product model to move it immediately. Release to obtain the authoritative checked preview. **Accept layout** saves, or **Discard** returns to the saved design.
2. Select the product by model or name; use **Rotate selected furniture** or **Remove selected furniture**, then accept the checked preview. These controls affect added catalogue objects, not pixels in the original image.
3. Collisions, room bounds, openings, measured obstacles, catalogue identity and locks remain enforced. Product geometry is never stretched to fit the photo. Missing/incompatible models are clearly labelled measured boxes.
4. Saved positions and calibration survive reload. Visual alignment depends on the photograph, manual measurements and calibration; confirm critical clearances physically before promising fit.

To remove original furniture from the photograph, save its reviewed **Remove from photograph** selection, then click **Remove reviewed areas from photo**. Wait for the background job, inspect the preview and click **Use cleaned photograph**. **Show original photo** and **Restore original background** preserve access to the source. Only reviewed pixel areas are replaced; surrounding pixels stay unchanged. Remove a measured physical obstacle separately if that furniture will actually leave the room.

## Confirm and quote

1. Accept or discard every open preview. In **Products and budget**, review the saved products, dimensions, prices and positions with the client. **Review … in photograph** selects a product; **Refresh product prices and assets** refreshes catalogue details.
2. Tick **The client has reviewed these furniture choices and positions.**, then click **Confirm design for quotation**. A loaded, calibrated photo, confirmed room dimensions and available non-stale priced products are required.
3. Click **Review quotation**, inspect taxes/delivery/installation and issue the reviewed quotation. Download its PDF from the issued history.
4. Confirmation belongs to this open consultation; it is not a persisted customer signature or legal acceptance. Furniture/scene changes, selected photo or photo-revision changes, refreshed product details, an open preview or reload require another confirmation. Existing issued quotations remain accessible independently.
5. Server quotation source/version, stock, permissions and exact pricing checks remain authoritative. The local review gate adds a sales step and does not replace them. Existing order/reservation and fictional supplier testing remains in [TEST_CUSTOMER.md](TEST_CUSTOMER.md).

## OpenAI and implementation limits

For Docker, put `OPENAI_API_KEY=…` in an ignored `.env.trial` beside `compose.yaml`, then recreate with `docker compose up -d --build`. Never commit or share the key. The account needs billing/model access. Optional model settings are `ROOMSELL_AI_MODEL` (default `gpt-4.1-mini`) and `ROOMSELL_IMAGE_MODEL` (default `gpt-image-1`). The app/worker also accepts `ROOMSELL_AI_API_KEY`.

The local adapter uses registered fixture pixels, recorded selections and a known empty synthetic image. It does not analyse arbitrary photographs. Live scanning/removal is asynchronous and can incur charges; dragging is local and never calls OpenAI per movement. Vision/image request deadlines are bounded; provider timeouts can retry or fail.

Calibration assumes a pinhole camera with centred principal point and square pixels. There is no live camera/AR, automatic room measurement, guaranteed photorealism, automatic depth/silhouette segmentation or guaranteed detection of all objects. Manual rectangular foreground areas are visual aids. Accurate-looking products require appropriate retailer models; a generic box is a dimension proxy.

`photo_workspaces` holds separately revisioned calibration/selections/background while scene v2 remains canonical. Current project authority, CAS, shared AI quotas, durable leases and exact completed-source revision guard processing/application. Scene and image edits always require explicit human action. Executed checks belong in [VALIDATION.md](VALIDATION.md); live provider quality and a physically measured client room remain external acceptance gates.
