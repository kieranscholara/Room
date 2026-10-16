# Canonical scene contract

## Calibrated photo presentation

`photo_workspaces` (migration 019) stores image dimensions, source-reference identity, version-1 floor calibration, approximate reviewed regions and an optional approved background. Its independent revision uses compare-and-swap; these fields are not scene v2 geometry. Calibration requires the current confirmed room width/depth and natural oriented image size. A changed room size invalidates presentation until recalibration.

Four clockwise metric floor correspondences determine the pinhole camera. X/Z/Y/yaw and original model bounds are unchanged. Dragging inverse-projects the pointer at the grabbed mesh point's fixed horizontal height and proposes an ordinary manual transform. Collision, SKU/currency, lock/group and scene revision admission stay authoritative on the server. Photo pixels do not establish obstacles, products or quotation lines. A manually measured existing object uses the existing room obstacle contract.

## Consumer ownership extension

Scene schema remains v2 with the same metres, axes, dimensions, operations and independent locks. Retailer scenes still use the organisation UUID. Separately stored consumer scenes use `organisationId = consumer:<owner UUID>`; this namespace is immutable in the checked consumer commit. Do not send a consumer scene to retailer commit RPCs.

`consumer_projects`, `consumer_scene_versions` and `consumer_proposals` have owner-only access; proposals retain engine/base/approved-result fingerprints and expire after 15 minutes. Accept checks the owned scene version and revalidates newly admitted published variant metadata. Historical accepted furniture remains a measured snapshot after unpublication; its presence does not authorise new placements or a new retailer enquiry. Prices, product photographs and AI text remain outside the canonical scene.

A consented enquiry makes a separate retailer scene with a new scene ID, retailer organisation UUID and version zero. It includes only that retailer's selected objects and the measured room. Cross-retailer groups/follower links are removed safely before geometry validation. Original consumer persistence is unchanged.

## Implementation update — 14 October 2026

The approved alignment keeps schema v2, saved object fields and metre/radian coordinates unchanged. Pricing, quotation records, inventory mappings and asset URLs remain outside canonical scene JSON. The baseline contract below remains applicable except for explicitly superseded future-only statements.

### Renderer contract now implemented

`packages/geometry/src/render-contract.ts` exports:

- `sceneObjectTransform`: floor-anchor position, positive right-handed Y yaw and unit scale.
- `konvaRotationDegrees`: negative yaw degrees for the existing screen convention.
- `worldToPlan` / `planToWorld`: transient viewport scale/origin round trips.
- `modelFloorCentreOffset`: for validated bounds `[min,max]`, offset `[-(minX+maxX)/2, -minY, -(minZ+maxZ)/2]`, applied beneath the object's yaw/translation group.

`room-viewer-3d.tsx` reads `proposal.scene ?? acceptedScene` from the existing store. Selection is shared, but orbit/zoom, model load state and WebGL resources are transient. It introduces no 3D transform operation. Actual Three/Konva matrix fixtures at 0, ±pi/2, pi and oblique yaw project to the canonical footprint.

### Model selection and dimensional tolerance

Authorised selected-product responses now include `productId`, `variantId`, `sizeBytes`, declared validation `dimensions`, `validation`, scoped `url`, `modelRenderable` and `proxyReason`. These are view data, not scene fields. Variant models are preferred deterministically; a product-level model is eligible only when current parent dimensions equal the selected variant dimensions. Saved dimensions must equal the model's declared validation dimensions exactly. Stale physical identity, foreign variants or missing bounds force a labelled proxy.

`validation.bounds` contains actual measured model bounds, including mesh/node transforms. Measured bounds must match expected dimensions within the larger of 2 cm or 2% per axis. This accounts for export precision such as float32 1.200000047 m versus declared 1.2 m. The renderer preserves the unaltered mesh size and reports the model/proxy distinction; canonical dimensions and rectangular collision checks never change to fit the mesh. Client decoding remeasures indexed geometry, checks validation bounds, rejects external resources and enforces resource limits.

### Durable preview contract

`SavedProposal` is an application persistence envelope, separate from scene v2 and the client-visible proposal. It includes `engineVersion`, `baseSceneFingerprint` and `approvedSceneFingerprint`. SHA-256 is computed from stable canonical scene content. Acceptance rejects legacy/malformed/incompatible envelopes, a changed base or an approved result differing from recomputation. Solver compatibility changes expire previews; they do not require rewriting accepted scenes.

### Remaining future extensions

Vertical placement, arbitrary room meshes, pitch/roll, consumer/multi-retailer ownership and genuinely incompatible geometry changes still require a scene-version decision and staged migration. AI/photo metadata belongs in authorised separate records; providers cannot mark guessed dimensions confirmed. Inventory reservations and issued quotation lifecycle are separate commercial domains, not renderer fields.

## Baseline scene contract — historical

### Actual contract, schema v2

Executable authority: `packages/scene-core/src/index.ts`. Interpret coordinates through `packages/geometry/src/index.ts`; render through `apps/web/components/floor-plan.tsx`. The scene schema is strict and rejects unknown fields/versions. `migrateScene` recognises strict v1 and adds empty openings/groups without changing existing transforms, locks, dimensions, IDs or revision numbers.

| Field               | Semantics                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| schemaVersion       | Data-format version, currently 2; distinct from scene version and solver version.                                                              |
| id / organisationId | Scene and tenant identity. General schema uses bounded strings for demo compatibility; live persistence assigns UUIDs and verifies the tenant. |
| version             | Monotonic accepted edit revision. PostgreSQL uses an integer column; clients must submit expectedVersion.                                      |
| room                | Name, width/depth/height in metres, explicit measurementsConfirmed, zones and openings. Rectangular room only.                                 |
| objects             | At most 30 unique furniture instances. Repeated variant IDs represent multiple instances; object IDs remain distinct.                          |
| groups              | At most 15 rigid groups, each with 2–30 member IDs and explicit locked flag. Membership cannot overlap or reference missing objects.           |

Object fields: id, sku, variantId, name, category, dimensions `{width,depth,height}`, transform `{x,y,z,rotation}`, locks `{position,rotation,product}`, solid, color and optional follows `{anchorId,x,z,rotation}`. Categories are bed, wardrobe, bedside, rug and desk. Follows is an anchor-local offset/preference, not a rigid constraint; nested/self/missing anchors are rejected.

### Units, axes, pivot and rotation

The plan's north-west origin is `(0,0,0)`. +X points right/east, +Z down/south in the plan, and +Y is vertical/up. Objects are centred on their ground footprint. Their floor anchor has `y=0`; width is local X, depth local Z and height local Y. All dimensions/positions are metres, never pixels.

Yaw is radians about +Y using the right-handed Three.js-compatible convention:

```text
worldX = localX * cos(theta) + localZ * sin(theta) + transform.x
worldZ = -localX * sin(theta) + localZ * cos(theta) + transform.z
```

Positive pi/2 maps local +X toward world -Z. Konva uses `-theta * 180/pi`. A future Three.js renderer uses +theta about Y, not the negated Konva angle. A centred box mesh needs centre Y at height/2 when its floor anchor is y=0. Renderer/model pivot conversion must not change saved transforms.

Current transform schema permits finite X/Z in [-100,100], literal Y=0 and yaw in [-2pi,2pi]. Geometry subsequently requires the whole footprint inside the measured room. Equivalent angles are not equal for rotation-lock purposes: locks compare exact stored values. Preserve locked representations; do not normalise them opportunistically. Display zoom/pan and pixel scale are transient presentation data. Drag snap is optionally 0.1 m; solver candidate grid is 0.25 m, with exact current/preferred candidates retained.

### Architecture and geometry

Room dimensions: width/depth 2–30 m, height 2–6 m. Object dimensions: positive width/depth up to 20 m, height up to 10 m, with the actual room ceiling checked separately. Zones use a corner `(x,z)` plus width/depth and must fit inside the room. Openings use a named wall and offset: from west on north/south, from north on east/west. Door sills are zero and clearance depth reserves at least their width. Windows use sill height to determine blocked tall furniture.

Geometry uses oriented rectangles, SAT and 1e-8 m tolerance. Edge contact is permitted. Nonsolid rugs may overlap furniture but obey architecture. These checks are outer dimension proxies, not actual mesh collisions or proof of usable circulation paths.

### Operations and persistence

Operations: transform (manual/smart), locks, room, group, group-remove, add-object and remove-object. Requests: preview/accept/undo/redo with expectedVersion. No product replacement, arbitrary scene import, vertical placement or free pitch/roll operation exists.

Preview is separate from the accepted scene. Acceptance recomputes the server-owned operation and validates again. Position/rotation/product locks apply to direct and automatic transforms; removal respects product locks and relationship references. Explicit undo/redo restores whole snapshots including historical locks, then advances version. A lock is not permission to bypass the ordinary history policy.

Live object SKU, dimensions, category, colour and solid status are checked against the selected organisation's variant/product before addition and again under the commit lock. Scene metadata is a saved physical snapshot. Later catalogue edits flag stale selections rather than silently resizing/replacing furniture. Prices are deliberately resolved outside scene JSON.

Supabase stores the scene and immutable version/audit rows. Scalar room dimensions are projected in the same commit. The demo's file store is separate and single-process. SQL currently requires schemaVersion 2, so any future version upgrade needs a forward migration and staged compatibility; do not rewrite old migrations or mutate every scene blindly.

### Proposed extensions — approval required

- Initial 3D reads existing v2 and the same accepted/preview store. Resolve validated asset information by variant ID outside the scene. Persist no renderer-specific state as geometry authority.
- Define deterministic model selection, ground-centre origin conversion and tolerance policy before rendering. Product-level models cannot automatically be assumed correct for differently sized variants. Retain an explicitly labelled dimension proxy when no matching model is usable.
- Pin durable preview compatibility to the engine contract and trusted approved result; current previews omit that pin (R3).
- Quotation snapshots, inventory external IDs and room references belong in separate domain records. They are not new ad hoc object fields.
- Consumer/multi-retailer ownership and genuinely incompatible geometry extensions require a decision and a versioned migration. Do not make organisationId optional to enable a marketplace.
