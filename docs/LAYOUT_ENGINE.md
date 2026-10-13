# Smart Rearrange v1

`propose(scene, operation)` is pure and deterministic for fixed input/configuration. It schema-validates a clone, checks saved geometry, rejects locked direct edits, then makes a trial scene. Manual mode changes only the selected object and rejects invalid geometry.

Smart mode fixes the selected item at its requested transform and preserves all position-locked objects completely. Other items get exact current/preferred candidates plus quarter-metre grid positions and cardinal rotations. Rotation-locked objects retain their exact angle. Explicit bed followers prefer local offsets transformed by the requested bed rotation. Relationships are soft, so locked followers can stay behind. Rugs may overlap furniture but cannot cross walls or architectural clearances.

Candidate geometry rejects boundaries, ceiling conflicts, fixed items and architectural zones. Candidates are ranked by weighted squared movement, follower offset error and rotation difference, with stable coordinate tie-breaks. A deterministic bounded depth-first search uses incremental solid collisions and branch-and-bound scoring; the best feasible arrangement found within the bound is returned. A final scene and lock validation guards the output. No prices, dimensions, variants or SKUs are altered.

Configuration v1: 0.25 m grid, at most 96 candidates per movable object and 6000 evaluated candidate nodes. A failed bounded search means **no arrangement found within the search limit**, not a mathematical proof that none exists. It returns alternatives and keeps the saved scene intact. No random or LLM calls are used.

Current groups only express followers of a directly moved bed/anchor. Arbitrary rigid groups, nested groups, circulation optimisation, wall snapping, windows, precise door swing arcs and multi-room layouts are later tickets. Door swing safety is conservatively represented as an explicit rectangular exclusion zone.
