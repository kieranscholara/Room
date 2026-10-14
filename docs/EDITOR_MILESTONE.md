# Editor rules milestone

The strengthened editor uses scene schema v2 with explicit, lossless migration of saved v1 scenes. Confirmed rectangular room dimensions, door/window openings and conservative swing/window clearances, fixed obstacles and circulation exclusions can be edited through preview/accept. Invalid room shrinks or architecture changes leave the saved scene intact.

Rigid groups preserve member-relative transforms. Group locks preserve the group's transform; every member's independent position, rotation and product locks remain authoritative. The editor supports group creation/removal, wall and 0.1 m grid snapping, drawn/accessible wall-distance guides and comparison with saved revisions.

The deterministic solver bounds candidate generation (1536 generated/96 retained per unit) and search (6000 nodes). Five measured runs on this cloud machine ranged 42–346 ms for the flagship fixture and 131–308 ms for a 30-object, 30×30 m fixture with a forced collision. These are fixture observations, not universal latency guarantees or a proof of optimality/infeasibility.

The editor gate passed 10 browser acceptance workflows, 45 unit/property/service tests, lint, strict TypeScript and a Next.js production build. Patched Vitest 4.1.11 replaces the vulnerable test dependency chain; npm audit reports zero vulnerabilities at this checkpoint.

Door swings and window clearances are conservative rectangular envelopes; circulation is explicitly marked by a person. Non-rectangular rooms, automatic whole-room circulation analysis and 3D remain future work. Signed-in projects use the same domain/editor with organisation-scoped PostgreSQL persistence; `/demo` retains clearly labelled synthetic data. This file preserves the editor checkpoint's measured results; the complete later validation record is in [VALIDATION.md](VALIDATION.md).
