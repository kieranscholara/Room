# Photo-first selling

This is the single-photograph workflow requested by the product owner. The existing measured 2D editor is retained. A photograph is a calibrated view of the same scene, not a second furniture database.

## Try the fictional example in Docker

1. Download the latest `roomsell/bedroom-editor-milestone` branch and open its folder.
2. Start Docker Desktop with Linux containers and host networking enabled, then run `docker compose up --build`. Wait for **READY**. The existing trial volume and saved designs are preserved.
3. On your computer, open `http://localhost:3000/testing` and click **Open photo placement demo**. No signup or API key is needed.
4. The labelled synthetic measurement image is pre-calibrated. The original photorealistic fictional bedroom remains available in the photograph selector, but has no claimed measurement ground truth. Its calibration must be marked manually.
5. Drag an available store item onto the floor in the image, or click **Place …** and then click a floor position. A checked preview appears. Click **Accept layout** to save, or **Discard**.
6. Grab a product model to move it immediately, rotate it with **Rotate selected furniture** or use the existing exact placement controls, and remove it with **Remove selected furniture**. Each finished edit uses the existing checked preview/accept workflow. Locks, collisions, groups and catalogue checks remain enforced.
7. Switch to **2D floor plan** and **3D room view**. They show the same accepted or preview objects. Reloading restores saved placement and photograph calibration.
8. For original furniture removal, choose **Local fixture adapter · synthetic demo only**, click **Scan room photograph**, **Use detected selections**, set the chest action to **Remove from photograph**, then **Save reviewed selections**. Click **Remove reviewed areas from photo**, review its preview and click **Use cleaned photograph**. The Docker trial runs the worker automatically. **Show original photo** and **Restore original background** retain access to the original.

The seven GLB assets are simple illustrative fictional products with exact catalogue bounds. They are not manufacturer models or photorealistic representations. The local scan/removal adapter uses a recorded selection and known empty synthetic image; it never claims to analyse arbitrary customer photographs.

## Use an actual client photograph

1. Open the client project as a salesperson. Confirm the measured room width, depth and height in **Room essentials**. Measure a visible rectangular patch on the floor; its origin and dimensions use the room's X/Z coordinates.
2. Select **Client photograph → Upload photo**. Use an ordinary undistorted photograph; avoid panoramas, fisheye or perspective-corrected images. Keep the original camera aspect ratio.
3. Mark the four visible floor corners clockwise: origin, along width, opposite, along depth. Enter the rectangle's measured X/Z origin, width and depth. A partial-room rectangle is supported when the whole floor is not visible.
4. Click **Save photo calibration** and inspect floor alignment. Invalid, crossed, degenerate or inconsistent points are rejected. Changes to room dimensions invalidate the calibration. The residual measures consistency of the four marks; it does not certify a real room measurement.
5. Place actual inventory as above. Product dimensions and saved coordinates stay authoritative. Visual alignment depends on the photo, manual measurements and calibration; confirm critical clearances physically before promising fit.
6. Original furniture visible in the image is not automatically collision geometry. For a retained item, expand **Confirm an existing object's physical footprint**, enter measured X/Z and footprint, preview the obstacle and accept it. Existing obstacle zones are managed in Room essentials. Deleting pixels never silently deletes a physical obstacle or a purchased SKU.
7. For live scanning/removal, configure an OpenAI key securely in the app/worker environment. The Docker trial supports an ignored `.env.trial` file with `OPENAI_API_KEY=…`; never commit it or paste it into chat. Optionally set `ROOMSELL_AI_MODEL` (default `gpt-4.1-mini`) and `ROOMSELL_IMAGE_MODEL` (default `gpt-image-1`). Recreate the app with `docker compose up --build`. The account needs model access and billing.
8. Choose **OpenAI · live photograph processing**, explicitly consent to sending the selected image, then scan and review all areas before removal. Manual selections work independently of scanning. Removal is a background image edit, not an AI request on every drag. Review reconstruction before using it.
9. The existing **Design assistance** panel can use consented room photographs as visual context and recommend only this retailer's available, authorised catalogue candidates within the budget. It independently checks SKU, stock, prices, policy and geometry. The salesperson chooses placement; AI does not infer trusted room measurements.

## Implemented boundaries

- Pinhole camera with centred principal point and square pixels, recovered from four coplanar metric correspondences. Product meshes are never stretched to fit a photo. Unsupported/missing product models are clearly labelled measured boxes.
- Photo calibration and reviewed regions are saved separately in revisioned `photo_workspaces`. The metre scene remains v2. Private reference bytes retain project access controls.
- Scan output contains labels and approximate rectangles only. It cannot assign SKUs, measurements or locks. Rectangular foreground areas are an explicit manual visual aid; there is no automatic depth map or silhouette segmentation.
- Cleanup uses a square letterboxed source/mask for the provider. Only selected pixels are composited back into an original-size PNG. The original file is immutable. Generated files stay private and require a completed job for the exact source workspace revision before application.
- Jobs share actor/tenant AI quotas, durable deduplication, current permission checks and leased completion. Live vision has a 40-second request deadline and image editing 45 seconds; provider latency can fail/retry. Local drag rendering does not depend on either call.
- There is no live camera/AR feed, automatic room measurement, guaranteed photorealism, automatic foreground segmentation or automatic removal from a physical room. This is a bounded still-photo selling MVP.

## Verification

Camera recovery/inverse projection, drag-plane projection, non-stretched fictional models, strict provider schemas, unchanged pixels outside selections, tenant/CAS/cleanup authority and real browser journeys are automated. See [VALIDATION.md](VALIDATION.md) for executed results. Live OpenAI account/model quality and a physically measured client room remain external acceptance checks; no credentials were supplied to this environment.
