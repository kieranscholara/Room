# Local development API

`GET /api/scene` returns `{scene, canUndo, canRedo}`, with caching disabled. This is a single synthetic local organisation, with no authenticated users. Do not expose this API to retailers or customers.

`POST /api/scene` requires JSON and accepts one strict request:

```json
{
  "action": "preview",
  "expectedVersion": 0,
  "operation": {
    "type": "transform",
    "objectId": "bed",
    "mode": "smart",
    "transform": { "x": 3, "y": 0, "z": 3.8, "rotation": 3.141592653589793 }
  }
}
```

Preview returns `{proposal: {id, baseVersion, scene, movedIds, evaluated}}`. Accept with `{"action":"accept","expectedVersion":0,"proposalId":"<returned ID>"}`. Server-owned previews are bounded to 100 outstanding entries and expire on commit or process restart. Discarding requires no server write.

Lock example: `{"action":"preview","expectedVersion":0,"operation":{"type":"locks","objectId":"bed","locks":{"position":true,"rotation":true,"product":true}}}`; accept its preview to save. UI lock buttons perform these two steps automatically as one explicit user action.

Undo/redo: `{"action":"undo","expectedVersion":1}` or `{"action":"redo","expectedVersion":2}`. Acceptance/history return `{scene, canUndo, canRedo}`.

Errors: 400 malformed/schema-invalid requests, 403 cross-origin mutation, 409 stale versions/expired previews/missing history, 413 oversized local operation, 415 non-JSON, 422 lock or geometry conflicts, 500 storage errors. The service does not implement tenant authentication, production rate limiting or durable proposal sharing yet. Unknown organisation/client-scene fields are rejected but this does not establish multi-tenant security.
