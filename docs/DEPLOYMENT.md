# Local and future deployment

Use Node 24 and a writable persistent `ROOMSELL_DATA_DIR`. Install with `npm ci`, run quality gates, build with `npm run build`, then run `npm run start`. Root scripts run Next.js from apps/web, so relative data directories resolve there. Save/install snapshots retain files/dependencies, not server processes; restart Next.js for each new cloud task. Use the existing isolated checkout, without creating a worktree.

Browser validation uses port 3100 and separate data. The main editor uses port 3000 by default; `npm run dev -- --port 3001` chooses another port. Bindings are for development. No public deployment is authorised or production-ready in this milestone.

Back up the local scene while the server is stopped; restore its JSON only after schema and geometry validation. Do not run multiple replicas against one local file. There is no production backup/retention SLA.

Before staging/production: replace local adapter with transactional Supabase persistence; configure Auth and Storage; apply reviewed SQL migrations in staging; run cross-tenant tests; verify secrets stay server-side; add queue/monitoring; configure HTTPS, limits, retention, backup/restore and billing; execute acceptance/security tests against staging; obtain a pilot rollout review. There are currently no external credentials to configure and no production migration command to run.
