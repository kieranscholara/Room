# Locking rules

- Position locks preserve exact X/Y/Z and reject direct movement. Smart v1 also preserves these objects' orientation even if their rotation lock is off.
- Rotation locks preserve exact radians through direct and automatic operations, while allowing translation when position is unlocked.
- Product locks preserve exact SKU/variant. All products and physical dimensions are fixed in this milestone, so replacement cannot occur even when the product lock is off.
- Followers express soft relationships. They cannot override any lock. Hard group locks and group creation are not implemented yet.

Lock toggles are explicit backend operations, saved as new versions and undoable. A pending transform preview disables other editing controls. Every accepted preview is recomputed by the backend; clients cannot submit an arbitrary replacement scene. Stale versions return HTTP 409 before any write, including when a lock changed in another tab.

Undo/redo are explicit requests to restore a complete earlier scene, including its lock states; they do not run automatic rearrangement. They use the current version to avoid overwriting concurrent edits. A preview never changes the saved scene. Invalid operations preserve the previous data byte-for-byte through the service's write boundary.
