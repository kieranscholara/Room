# Milestone 1 validation — 13 October 2026

Executed in the cloud checkout with Node.js 24.19.0, npm 11.9.0, Next.js 16.4.0 and system Chromium.

| Check                                                                        | Outcome                                                                                   |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Frozen install (`npm ci --cache /workspace/.npm-cache --no-audit --no-fund`) | Passed                                                                                    |
| ESLint                                                                       | Passed                                                                                    |
| Strict TypeScript                                                            | Passed                                                                                    |
| Prettier check                                                               | Passed                                                                                    |
| Vitest                                                                       | 27 passed, 0 failed/skipped                                                               |
| Seeded geometry properties                                                   | 250 oriented collision cases + 60 smart-operation cases, within Vitest                    |
| Playwright                                                                   | 5 passed, 0 failed/skipped                                                                |
| Next.js production build                                                     | Passed                                                                                    |
| Production-mode browser/API smoke                                            | Hydrated canvas and valid smart preview; exact locked wardrobe; persisted scene unchanged |
| Visual review                                                                | Desktop floor plan/properties, rotated labels and visible demo boundaries checked         |

Browser acceptance exercises the fully locked wardrobe, independent product locking, smart bed movement/rotation, follower positions, preview/accept, refresh, exact undo/redo, invalid edits, tablet layout/discard, mouse drag, actual touch drag, and HTTP lock/origin/version/schema rejection. Real atomic file persistence is exercised separately by service integration tests.

The main local demonstration scene remains at its original layout; tests use a separate ignored data directory. Ignored screenshots are generated at `test-results/room-studio-initial.png` and `test-results/room-studio-desktop.png`. CI is configured but has not yet executed on GitHub. External production integrations, RLS and security audits remain unimplemented/unrun, as documented in KNOWN_LIMITATIONS.
