# Scene schema v1

Executable contract: `packages/scene-core/src/index.ts`. A scene includes `schemaVersion: 1`, scene and organisation IDs, a monotonic committed `version`, confirmed room measurements, fixed architectural zones and objects.

Objects contain immutable demo SKU/variant/dimensions, a ground-plane transform `{x, y: 0, z, rotation}`, independent locks, solid/non-solid classification and optional `follows` relationship. Width, depth and height are positive metres. IDs are unique. Missing anchors, self-following and nested follower chains are rejected. Architectural rectangular zones must be inside the room. Unknown request and operation fields are rejected. Schema v2 requires an explicit migration; v1 does not silently reinterpret old scenes.

`transform` operations include one object, the desired complete transform and manual/smart mode. `locks` operations explicitly set all three booleans. Every API mutation includes `expectedVersion`. Preview scenes keep the old committed version. Acceptance increments it once. Undo/redo increment it while restoring prior object states.

JSON exports are canonical scene snapshots. They are inspectable exports, not a trusted upload/import API. Reload comes from the backend's saved scene. Physical dimensions and products have no editing/replacement operation in this milestone.
