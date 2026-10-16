# Environment setup and managed deployment

## Local workflow

Use Node.js 24/npm and a running Docker daemon. Docker runs the local Supabase services; the hosted product uses managed infrastructure.

```sh
npm ci
npm run setup:local
npm run db:migrate
npm run dev
```

Setup is idempotent and uses official slim Supabase PostgreSQL 17, Auth, Storage, API and captured mail services. Ports: app 3000, API 54321, database 54322, mail 54324. Keep at least 3 GiB available before service startup. Dev uses Next's Webpack option; production uses normal `next build`. Existing checkout files and persistent volumes are retained; migrations apply forward without reset.

Local runtime uses only verified loopback status with `ROOMSELL_LOCAL_SUPABASE=1`. Tests reject hosted bindings in the process and app environment files before writes. `.local/infra/status.json`, infrastructure logs, `.env.local`, fixture credentials and backups are private ignored files; never print, archive with source or commit them. Start the fictional customer after the app starts using [TEST_CUSTOMER.md](TEST_CUSTOMER.md). Live processes must restart in every new cloud instance.

## Vercel plus hosted Supabase

The user selected OpenAI and managed hosting and reports having Supabase/OpenAI keys. Those bindings and managed project access are not configured in this workspace. The files are prepared; no public deployment or external account was created here.

Public staging targets supplied on 16 October 2026:

- Supabase project: `ojdbysbwojoipuqurlln`, API origin `https://ojdbysbwojoipuqurlln.supabase.co`.
- Vercel team/project: `kieranscholaras-projects/dev`; supplied deployment origin `https://dev-5dqz4xorr-kieranscholaras-projects.vercel.app`.
- Dashboard deployment: `https://vercel.com/kieranscholaras-projects/dev/CQU6b3iYKFm5mTRDoQnmSk3TPywb`.

Public URLs supply no deployment/database authority. Requests from this cloud currently fail at its network proxy (CONNECT 403), before reaching either service. Both exact hostnames were added to the saved environment allowlist draft, pending review/save/publish. Their current health, deployed source revision, protections and schema are therefore unverified. Do not reset or seed this hosted project through the deliberately local-only fixture scripts. Use the actual final Vercel HTTPS origin for `ROOMSELL_PUBLIC_ORIGIN` and both Auth callback allowlist entries; update it if the deployment URL changes.

1. Create separate staging and production Supabase projects in the chosen data region. Apply the reviewed migrations 001–018 through the hosted SQL/migration workflow against the intended project. Root `db:migrate` is intentionally local-only. Verify RLS and both private buckets (`product-assets`, `room-references`). Keep production data out of local test jobs.
2. Create a Vercel project importing this repository/feature branch. Set Root Directory `apps/web`, enable inclusion of files outside the root directory for workspace packages, and use Node.js 24. `apps/web/vercel.json` supplies Next, root frozen install and app build commands. Configure the final HTTPS domain before signup acceptance.
3. Add server-only bindings in Vercel secret/environment settings: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ROOMSELL_PUBLIC_ORIGIN`, `ROOMSELL_CONNECTOR_ENCRYPTION_KEY`, `OPENAI_API_KEY` (or `ROOMSELL_AI_API_KEY`) and `CRON_SECRET`. The public origin must be a plain HTTPS origin without path/query/user credentials. Keep the local, demo and test-customer flags unset. Do not use NEXT_PUBLIC_ for these keys.
4. Generate and retain a stable 32-byte base64 connector encryption key through a secure operator process. Connector tokens use AES-256-GCM with tenant-associated data. Losing/changing the key requires token re-enrolment. Back it up securely outside the database/source. Generate a separate random worker secret of at least 32 characters. Vercel Cron sends it as Bearer `CRON_SECRET`; the worker verifies it in constant time.
5. The supplied cron runs `/api/internal/jobs/run` each minute and processes one bounded job per call, plus reservation expiry. Choose a Vercel plan supporting that schedule and a 60-second function duration, or replace the cron with a managed authenticated scheduler/worker calling the same endpoint. A Hobby plan's restricted cron schedule is insufficient for responsive assistance. Do not run two distinct secrets for cron and manual worker unless deliberately aligned; `ROOMSELL_WORKER_TOKEN` takes precedence when set.
6. Configure Supabase Auth site URL and allowlist the exact HTTPS domain with `/auth/callback` (confirmation) and `/auth/recovery` (password recovery). For the supplied staging deployment these are `https://dev-5dqz4xorr-kieranscholaras-projects.vercel.app/auth/callback` and `https://dev-5dqz4xorr-kieranscholaras-projects.vercel.app/auth/recovery`. Enable email confirmation and a verified SMTP sender. The sign-in page includes recovery; links exchange a single-use PKCE code in the requesting browser before showing `/auth/reset-password`. No arbitrary destination is accepted. Local Mailpit captures mail on port 54324 and does not deliver externally. Hosted cookies are always Secure. Callbacks use relative redirects; outgoing email uses the configured origin instead of an arbitrary request Host.
7. Add provider billing/usage caps; default model is `gpt-4.1-mini`, overridable with `ROOMSELL_AI_MODEL`. OpenAI Responses requests use structured output, `store:false`, timeout/byte bounds and explicit photo consent. Verify a live staging request with synthetic data before inviting customers. No successful live provider request is claimed here.
8. Configure the retailer's actual HTTPS snapshot feed, token and explicit variant mappings. Test stale/missing/duplicate/foreign feed rows. Snapshot-only feeds support stock reads and reservations. To enable fulfilment, configure a same-origin `orderEndpoint` implementing the documented idempotent custom REST acknowledgement contract. Boreal Living verifies the local protocol; a real supplier must independently satisfy its stock/deduplication semantics. Native vendor APIs with other contracts need an adapter. See INVENTORY.md.

No container host needs to be managed by the retailer for this deployment. Supabase manages database/Auth/Storage, Vercel runs the app/functions, and a managed scheduler runs bounded workers. Pricing, limits, region and recovery guarantees depend on the selected plans.

## Health, monitoring and resources

`GET /api/health` returns 200 only after a database availability check, otherwise 503; no credentials or tenant details are returned. Monitor it externally and configure alerts for non-200 responses, function failures, queue age, failed jobs, storage use, database connections and provider rate/cost limits. Project/organisation job APIs expose only currently authorised jobs. Forward sanitized error codes, never request/photo/provider bodies or bearer tokens. Vercel/Supabase dashboards and alert destinations still need operator configuration.

`GET /api/internal/operations` requires the same worker Bearer secret and returns only aggregate queue counts, failed jobs over 24 hours, oldest queued age, expired leases and supplier acknowledgements pending over five minutes. It returns 503 for degraded/unavailable checks. Never put the secret in an alert URL. A scheduler/monitor can run `npm run monitor -- --url https://YOUR-STAGING-ORIGIN` with the secret supplied through its environment. The endpoint does not expose tenant IDs or provider/customer content.

Before deployment, run `npm run check:deployment` in the deployment environment with its bindings present. It prints PASS/FAIL names, never values, and exits nonzero for missing/misconfigured bindings, enabled local shortcuts, invalid encryption or mismatched worker/cron secrets. This static check does not contact providers. After deployment, `npm run check:staging -- --url https://YOUR-STAGING-ORIGIN` checks database health, anonymous auth, recovery pages and disabled demo/test routes without creating users or sending mail. Both commands are dependency-free. Provider billing, SMTP delivery, HTTPS cookies and hosted restore still need explicit live acceptance.

Jobs use two-minute leases and at most three attempts with bounded backoff. A job cannot finish on an old lease or after permission revocation. At most 100 active jobs per tenant and AI quotas of 20/hour per actor and 100/hour per tenant are enforced. Cleanup sweeps are bounded (20 folders × 50 objects per bucket per call) and remove only unlinked objects older than 24 hours; this is not a complete data-retention policy.

The app accepts validated image sources up to 10 MiB locally; Vercel function request limits are lower (4.5 MB). Resize/compress source images below the hosting limit for this deployment; larger hosted assets require a separate direct staged-upload design. Model decoding, scene size, feed size and history are bounded. Consumer offers are paginated at 50; current filtering is per page, not a global search index. No throughput SLA is claimed.

Local filesystem demo/fixtures are excluded from server output tracing and fail closed unless explicit verified local flags are enabled. A hosted deployment must never enable these shortcuts. Review generated deployment traces/artifacts for local paths before release.

## Backup and verified restore

```sh
npm run backup:local
npm run restore:check -- .local/backups/<generated-directory>
```

The local backup exports a repeatable-read database snapshot of public/Auth/Storage/migration schemas and captures private asset bytes with SHA-256. Backups contain sensitive identities/data: mode 0600, ignored local directory, never source distribution. An asset changed/deleted during export makes the backup fail for retry.

Restore verifies checksums, restores to a newly named temporary database and private bucket, checks every public table's row count and every asset's downloaded bytes, then drops only its own temporary targets. It never replaces the running database. This local drill passed; it does not verify hosted Auth login recovery or the provider's PITR promises.

For production, enable the chosen Supabase backup/PITR plan and separately back up Storage object bytes (database backups alone do not restore files). Define retention, encrypted offsite storage, ownership, RPO/RTO and regular isolated hosted restore drills. Test login, private assets, scenes/history, immutable quotations, orders, connector decryption and worker recovery on the restored staging target. These hosted operational gates remain outstanding until projects and credentials exist.

## Release checks

Run lint, format, types, unit, real local database tests and production browser acceptance, plus dependency audit. Review hosted migration target, test flags disabled, HTTPS Auth/email, live OpenAI on synthetic data, tenant denial, public image revocation, job recovery, physical furniture dimensions and a hosted database/asset restore before public rollout. See [VALIDATION.md](VALIDATION.md) for completed local evidence.
