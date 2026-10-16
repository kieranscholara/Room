# RoomSell fictional-customer MVP

The current delivery is a local, account-free customer trial. It preserves the existing measured editor and uses explicitly synthetic Boreal Living products, images, commercial policy, users, supplier inventory and acknowledgements. It does not collect payment or send real supplier orders.

## Included journey

1. Start Docker Desktop with Linux containers and host networking enabled. Open `Start-RoomSell.cmd` on Windows, or run `docker compose up --build` from the repository root.
2. Wait for READY, then open the local app on port 3000 at `/testing`. Enter as Alex, the retailer. No hosted keys, signup or email verification are required.
3. Inspect the seven products, dimensions, availability, private images and explicit SKU mappings. Change simulated upstream stock and synchronize.
4. Open Maya's measured room. Move furniture, review Smart Rearrange previews, preserve locks, compare 2D/3D, accept, reload and undo/redo.
5. Upload a private reference photograph. Request labelled local test advice, wait for the worker, review its validated intent and explicitly accept a proposed layout. No OpenAI call occurs in this mode.
6. Review configured VAT/delivery and issue an immutable quotation/PDF. Enter as Maya to review, reserve and confirm it.
7. Return as Alex and record fulfilment. The fictional supplier returns a durable acknowledgement; retrying reuses its reference without selling stock twice. Later inventory sync preserves the reduction. Explicit supplier rejection leaves stock intact and permits cancellation; unknown outcomes are held for recovery.
8. Optionally enter as Leo, build a private consumer design from published offers, compare 2D/3D and approve a selected-retailer enquiry.
9. Sign-in recovery can be tested separately through local captured mail. The real confirmation/recovery backend remains in place; fictional shortcuts do not disable production authentication.
10. Stop/recreate the app without deleting volumes. The consultation, personas, inventory, supplier ledger and encryption key are retained.

## Release gate

Executed checks and limitations are recorded in VALIDATION.md. Docker was exercised on Linux with ordinary build networking. A Windows entry file and instructions are supplied; successful execution on the user's Windows machine has not been observed remotely.

The following need actual service access and cannot be completed by inventing a supplier:

- **Live OpenAI:** add `ROOMSELL_AI_API_KEY` securely in environment settings (or ignored `.env.trial` on your own computer), enable billing/limits and run one synthetic request. Never paste the key into chat or source.
- **Managed hosting:** the public Supabase URL and Vercel deployment/project were supplied and recorded in DEPLOYMENT.md. Connect secure service/deployment authority, apply migrations and run the deployment/staging gates. The cloud network proxy currently blocks both targets; the exact-host allowlist update is saved but requires review/save/publish. No live project or website was provisioned or altered by this delivery.
- **External email:** choose and verify an SMTP sender in Supabase; test confirmation, recovery and expired/replayed links using delivered mail. Local captured-email success does not establish deliverability.
- **Production operations:** enable managed backups/PITR plus Storage byte backups, decide retention/RPO/RTO, configure alert destinations and run an isolated hosted restore. Local backup/restore is implemented and testable.
- **Real retailer rollout:** replace the fictional catalogue/policy and validate one measured room and supplier contract with the actual retailer. This is unnecessary for the synthetic trial.

Payments, shipping, platform billing, non-rectangular/multiple rooms, editable/photorealistic 3D and marketplace search/moderation at scale are later product scope, not part of this trial.
