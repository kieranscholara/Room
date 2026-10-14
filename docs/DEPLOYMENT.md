# Environment setup and deployment

## Local development

Use Node.js 24, npm and a running Docker daemon:

```sh
npm ci
npm run setup:local
npm run db:migrate
npm run dev
```

The setup script uses the installed Supabase CLI and official slim service images. It runs PostgreSQL 17, Auth, Storage, Kong/PostgREST and local mail capture; optional studio, realtime, analytics and edge services are disabled. API, database and mail use ports 54321, 54322 and 54324 respectively. The app serves on port 3000; `npm run dev -- --port 3001` changes that port. Dev uses Next.js's Webpack option after a Turbopack development reload loop was observed in this cloud environment. Production build uses the normal Next.js build command.

Keep at least 3 GiB free before/during stack startup, plus sufficient space for image downloads and data. The script checks service health; it does not skip failed health checks or disable registry TLS. Its separate ignored Docker client profile avoids injecting a proxy into container-loopback health requests and preserves the user's Docker configuration. The configured CLI registry uses official reachable images.

`setup:local` is repeatable. It captures local status atomically in restricted `.local/infra/status.json` and creates an application environment file containing only the local flag when none exists. Existing app environment settings are preserved; set `ROOMSELL_LOCAL_SUPABASE=1` to exclusively select verified local services; hosted bindings are ignored in local runtime mode. Integration/browser preflight refuses hosted bindings in the process or app environment files before any writes. The status file and infrastructure logs may contain generated keys; do not print, commit, upload or include them in an archive. No application/provider key belongs in source.

`db:migrate` applies pending migrations through the official local ledger without reset. Repeat execution is a no-op when current. Docker data volumes retain account, catalogue and project data; avoid destructive reset commands. Browser tests create isolated synthetic scene files and uniquely named account/tenant fixtures.

Install snapshots do not retain running processes. Restart local services and Next.js in a new cloud task. Use the existing checkout. Cloud preview publication is managed by the environment UI; private local addresses are not shareable preview links.

## Hosted server bindings

The runtime accepts these server environment bindings:

- `SUPABASE_URL`: the hosted project's HTTPS API URL.
- `SUPABASE_ANON_KEY`: its API key for request-scoped user clients.
- `SUPABASE_SERVICE_ROLE_KEY`: privileged server-only key for checked authoritative writes/private asset delivery.

Leave the local flag unset for hosted operation. All three hosted bindings must be supplied together; partial mixing fails closed. Configure bindings through secure deployment settings, apply the reviewed SQL migrations to the intended hosted target, and verify RLS/private Storage policies. `npm run db:migrate` remains a local-only convenience; it does not migrate a hosted target.

Configure the Auth site URL and allowed `/auth/callback` URLs for the deployment's real HTTPS origin. Enable email confirmation and configure delivery. Local configuration disables confirmations for test signup and captures local mail without external delivery. Hosted confirmation/delivery has not been validated by the local tests.

Run the app behind a trusted HTTPS reverse proxy which preserves the intended Host and sets `x-forwarded-proto: https`; Secure cookie selection depends on that header. Do not accept arbitrary client forwarding headers. Run `npm run build` then `npm run start` to serve a completed production-mode build.

## Data and rollout gates

Real project persistence uses PostgreSQL transactions and private Storage. The separate `/demo` local file adapter supports one process, with `ROOMSELL_DATA_DIR` resolving relative to `apps/web`. The demo page/API/history default to disabled; explicitly set `ROOMSELL_ENABLE_DEMO=1` only for synthetic demo use. The guard runs before filesystem access. Stop its server before backing up/restoring synthetic scene files.

Before staging/pilot rollout, run lint/typecheck/unit/integration/build/browser gates against the target, verify hosted Auth confirmation and cookie behaviour, validate retailer models/dimensions physically, configure production limits/monitoring, and test database plus asset backup/restore. Define retention, export/deletion and orphan-storage cleanup procedures. Issued quotations/PDFs now use append-only snapshots and exact configured commercial policy. Billing, reservations, durable jobs and production operational guarantees are later milestones. See [security](SECURITY.md), [test plan](TEST_PLAN.md), and [roadmap](ROADMAP.md).

## Inventory credential encryption

`ROOMSELL_CONNECTOR_ENCRYPTION_KEY` must be a canonical base64 encoding of 32 random bytes, stored server-side in secure deployment settings. Generate it once with Node crypto, retain it securely and include it in encrypted backup/restore procedures. Never prefix it with NEXT_PUBLIC_. Connector tokens use AES-256-GCM and tenant-associated data; authenticated API responses expose configuration status only. Only server-side service-role access can read encrypted token records; authenticated users have no token-table privileges.

An absent or invalid key disables credential writes and sync while leaving connection status readable. Losing/changing the key requires secure token re-enrolment; automatic multi-key rotation is not implemented. Manual sync accepts only public HTTPS endpoints, verifies and pins DNS addresses, rejects redirects and limits response time/bytes. Do not add live retailer endpoints to setup scripts. See [inventory contract](INVENTORY.md).
