# Scene schema v2

Executable contract: `packages/scene-core/src/index.ts`. The canonical scene includes `schemaVersion: 2`, scene/organisation IDs, a monotonic committed version, a measured room, objects and rigid groups. Strict schemas reject unknown fields and versions. `migrateScene` and `sceneSchema` recognise valid v1 scenes and add only empty openings/groups while preserving existing identities, measurements, versions, transforms and locks.

## Room and objects

The rectangular room has name, width/depth (2–30 m), height (2–6 m), measurementsConfirmed, up to 50 zones and up to 50 openings. Zones are room-contained rectangles with unique IDs and kind door, obstacle, clearance or circulation.

An opening has ID/name, kind door/window, wall north/east/south/west, offset, width, height, sillHeight and clearanceDepth. Offset runs from the west corner on north/south walls and from the north corner on east/west walls. Its wall span/clearance must fit the room and its top must fit below the ceiling. Doors reach the floor and reserve at least their full width as inward swing depth. Geometry uses conservative rectangular clearance envelopes, with window blocking dependent on furniture height above the sill.

Up to 30 objects carry ID, SKU, variantId, name, category, dimensions, transform, locks, solid and colour. Categories are bed, wardrobe, bedside, rug or desk. Width/depth/height are positive metres; transforms are ground-plane `{x,y:0,z,rotation}` with finite radians. Object IDs are unique. Rugs are non-solid and can overlap furniture; all objects obey room/architecture checks.

Optional `follows:{anchorId,x,z,rotation}` expresses a soft local-offset preference. Missing/self anchors and nested follower chains are rejected. New catalogue additions cannot inject a follower relationship. Authenticated project additions verify authoritative same-organisation variant identity and metadata on preview, acceptance and transaction commit.

## Rigid groups and operations

Groups have `{id,name,objectIds,locked}`, at least two members, and unique IDs. A furniture object can belong to only one rigid group. A scene has at most 15 groups. Group movement preserves member-relative transforms; a group lock and all independent member locks remain authoritative.

The strict operations are:

- `transform`: objectId, complete transform and manual/smart mode.
- `locks`: objectId and all three lock booleans.
- `room`: complete measured room, including zones/openings.
- `group`: complete group, for creation/update/locking.
- `group-remove`: groupId.
- `add-object`: complete object validated against the real project catalogue.
- `remove-object`: objectId; product locks and group/anchor references protect removal.

Every mutation request includes expectedVersion. Preview keeps the current committed version. Explicit acceptance increments it once after recomputing the server-owned operation. Undo/redo also increment it while restoring complete earlier validated snapshots, including lock states.

## Export and snapshots

JSON export is a canonical inspectable snapshot. Arbitrary file upload/import into a project is not exposed. Reload retrieves the authorised saved backend scene. Existing object dimensions and identity remain stable during transforms/history; catalogue edits report stale metadata rather than silently resizing saved designs. Product replacement is not currently an operation.

See [coordinates](COORDINATE_SYSTEM.md), [locks](LOCKING_RULES.md), [API](API.md) and [database](DATABASE.md).
