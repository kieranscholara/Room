# Acceptance tests

`npm test` runs Vitest unit, property and service tests. Fixed fast-check seeds make failures reproducible. It covers scene schema/JSON precision, coordinate rotation, oriented collision symmetry, boundary and architectural clearances, non-solid rug rules, deterministic flagship rearrangement, independent locks, immutable products/dimensions, impossible moves, manual mode, exact undo/redo, preview isolation, forged request rejection, competing stale commits, branching history and real file reload.

`npm run test:e2e` runs Playwright against the real Next.js app in its isolated local store. It selects the fully locked wardrobe, checks disabled controls, saves a product lock, moves/rotates the bed, confirms previews do not mutate saved data, accepts and inspects the backend, reloads, undoes/redoes and rejects an invalid wall-crossing move. Tablet coverage checks responsive overflow and discard. Actual canvas mouse and touch dragging exercise the event-to-operation path. HTTP tests reject malformed tenant fields, stale versions, locked edits and cross-origin browser requests. Screenshot/traces are generated under ignored test-results.

Run lint, strict typecheck, unit/service tests, Next.js build and browser acceptance before completing the milestone. CI records failure artifacts. Review changes and keep test outcomes separate from future acceptance criteria.

Later required suites (not yet implemented): authenticated cross-tenant database/storage access; catalogue import; real 2D/3D geometry equality; integer currency/VAT/discount/budget invariants; immutable issued quotations; durable job retries; signed billing events; customer link permissions. Unit rejection of unknown organisation fields is not a substitute for database security tests.
