# Smart Rearrange v2

`propose(scene, operation)` is pure and deterministic for fixed input/configuration. It parses the scene/operation, checks confirmed measurements and saved geometry, then applies the operation to a clone. Room edits can confirm measurements; other planning operations require prior confirmation.

Manual transform mode moves only the requested object or its entire rigid group and rejects invalid geometry. Smart mode fixes the requested unit at its desired transform. Other position-locked/group-locked units remain completely fixed. A unit is one rigid group or one ungrouped object; individual member locks remain checked for every candidate.

The solver retains exact current/preferred transforms and generates local quarter-metre grid rings, representative room-spanning candidates, wall candidates and cardinal/current/preferred rotations. Rotation-locked units retain their saved angle. Soft followers prefer anchor-relative offsets after anchor rotation. Stable ordering and coordinate tie-breaks make identical inputs reproducible.

Candidate geometry checks full rotated footprints using SAT, room/ceiling boundaries, explicit zones, conservative door/window clearances, fixed furniture and pairwise solid collisions. Non-solid rugs can overlap furniture but still obey architecture. Costs combine movement, preferred follower-offset error and rotation difference. Bounded depth-first search uses incremental collision checks and branch-and-bound scoring, followed by complete scene/lock validation.

Configuration: 0.25 m candidate grid, at most 1536 generated candidates and 96 retained candidates per movable unit, and 6000 evaluated search nodes. Failure means **no arrangement found within these limits**; it does not prove global infeasibility or optimality. Conflict messages and alternatives preserve the saved scene.

Measured fixture timings and machine-specific limits are recorded in [EDITOR_MILESTONE.md](EDITOR_MILESTONE.md). Those observations are not universal latency promises. Non-rectangular rooms, exact door arcs, automatic whole-room circulation analysis, multi-room optimisation and 3D remain future work. No random/LLM calls, catalogue invention or price/dimension mutations occur in search.
