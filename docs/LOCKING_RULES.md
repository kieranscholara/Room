# Locking rules

Position, rotation and product locks are separate booleans. Explicit lock edits are versioned operations and can be undone.

- Position locks preserve exact X/Y/Z and reject direct movement. Automatic search fixes a unit containing a position-locked member, including its orientation.
- Rotation locks preserve exact radians through direct and automatic operations while permitting translation when position is unlocked.
- Product locks preserve SKU/variant identity and prevent object removal. Replacement is not exposed. Transforms never change any object's product or physical dimensions, regardless of its product lock.
- Rigid groups preserve all member-relative transforms during manual and smart movement. A group lock fixes the whole group; member locks independently reject incompatible group operations.
- Soft followers express preferred anchor offsets and cannot override any lock. They do not establish a rigid group.

A requested member movement uses that member as the pivot for its rigid group. If any member's lock would be violated, the operation fails. Remove group membership/references before removing furniture; an anchor with remaining followers cannot be removed.

Pending previews disable competing mutation controls. Acceptance recomputes the original server-owned operation and validates locks again. PostgreSQL checks current edit permission and expected version inside its transaction. Changes in another tab produce a conflict before any write; the client reloads the current scene.

Undo/redo intentionally restore an entire earlier snapshot, including its saved lock states. They advance the current committed version and do not run automatic rearrangement. Invalid operations and discarded previews leave saved data unchanged.

Customer view-only projects preserve inspection/export/comparison controls while disabling mutation, canvas drag and edit shortcuts. Server permissions enforce that restriction independently of the UI.
