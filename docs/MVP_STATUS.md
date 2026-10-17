# RoomSell fictional-customer MVP

The current delivery is a salesperson-operated photograph consultation with a local, account-free trial. Retailer projects are photo-only; the visible 2D section is removed. Existing metric geometry, locks, tenant boundaries and immutable quotation authority are retained. Boreal Living products, images, policy, users, inventory and supplier acknowledgements are explicitly synthetic. No payment or real supplier order is sent.

## Included journey

1. Start Docker Desktop with Linux containers and host networking enabled. Open `Start-RoomSell.cmd` on Windows, or run `docker compose up --build` from the repository root.
2. Wait for READY, then open the local app on port 3000 at `/testing`. Click **Open photograph replacement trial** for the photographic replacement workflow, or enter as Alex, the retailer. No hosted keys, signup or email verification are required.
3. Inspect the seven products, dimensions, availability, private images and explicit SKU mappings. Change simulated upstream stock and synchronize.
4. Open Maya's project directly in the photograph workspace. Upload a photograph, scan visible furniture with human correction, then confirm room dimensions and mark a short measured floor rectangle. The photographic fixture already has assumed fictional calibration and a supplied transparent retailer bed image; the separate older synthetic example retains its known camera.
5. Use **Complete the room** for catalogue additions, chosen-product removals and known photo-region keep/remove advice. The salesperson chooses actual SKUs, clicks their position in the photo, drags/rotates and accepts checked edits. Original-object image removal has its own reviewed background job. Neither advice nor image editing automatically changes the scene. The local adapter handles only registered fictional photographs; live processing needs OpenAI. Catalogue image cutouts replace the retailer model overlay; no WebGL is required. See [PHOTO_SELLING.md](PHOTO_SELLING.md).
6. Save image layers, render the final photograph and explicitly use the reviewed result. In **Products and budget**, review accepted furniture/positions with the client, tick the review checkbox and click **Confirm design for quotation**. Review VAT/delivery and issue the immutable quotation/PDF. Staff confirmation is persisted against exact scene/photo/composition revisions and final image hash; the visible checklist resets after change/reload. Issued quotations retain that image, layer evidence and a photograph in their PDF. This is not a customer signature; issued history remains available. Enter as Maya to review, reserve and confirm an order.
7. Return as Alex and record fulfilment. The fictional supplier returns a durable acknowledgement; retrying reuses its reference without selling stock twice. Later inventory sync preserves the reduction. Explicit supplier rejection leaves stock intact and permits cancellation; unknown outcomes are held for recovery.
8. Optionally enter as Leo, build a private consumer design from published offers in the separate 3D-only workspace and approve a selected-retailer enquiry.
9. Sign-in recovery can be tested separately through local captured mail. The real confirmation/recovery backend remains in place; fictional shortcuts do not disable production authentication.
10. Stop/recreate the app without deleting volumes. The consultation, personas, inventory, supplier ledger and encryption key are retained.

## Release gate

Executed checks and limitations are recorded in VALIDATION.md. Docker was exercised on Linux with ordinary build networking. A Windows entry file and instructions are supplied; successful execution on the user's Windows machine has not been observed remotely.

The following need actual service access and cannot be completed by inventing a supplier:

- **Live OpenAI:** add `OPENAI_API_KEY` or `ROOMSELL_AI_API_KEY` securely in environment settings (or ignored `.env.trial` on your own computer), enable billing/limits and test scan, recommendations and reviewed removal. Never paste the key into chat or source. A scan cannot guarantee detection of every visible or hidden object.
- **Managed hosting:** the public Supabase URL and Vercel deployment/project were supplied and recorded in DEPLOYMENT.md. Connect secure service/deployment authority, apply migrations and run the deployment/staging gates. The cloud network proxy currently blocks both targets; the exact-host allowlist update is saved but requires review/save/publish. No live project or website was provisioned or altered by this delivery.
- **External email:** choose and verify an SMTP sender in Supabase; test confirmation, recovery and expired/replayed links using delivered mail. Local captured-email success does not establish deliverability.
- **Production operations:** enable managed backups/PITR plus Storage byte backups, decide retention/RPO/RTO, configure alert destinations and run an isolated hosted restore. Local backup/restore is implemented and testable.
- **Real retailer rollout:** replace the fictional catalogue/policy and validate one measured room and supplier contract with the actual retailer. This is unnecessary for the synthetic trial.

Payments, shipping, platform billing, non-rectangular/multiple rooms, editable/photorealistic 3D and marketplace search/moderation at scale are later product scope, not part of this trial.
