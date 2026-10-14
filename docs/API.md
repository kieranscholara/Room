# HTTP API

Account, organisation and project routes use server-verified sessions. Responses are private and uncached. JSON mutations require `application/json`, reject unknown fields and stream at most 64 KiB. Browser mutations reject a supplied Origin whose host differs from the HTTP Host. UUID path/query identifiers are validated; roles come from current database membership.

## Accounts and organisations

| Route                                   | Methods and contract                                                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth/signup`                      | POST `{email,password,displayName}`; signup requires a password of at least 12 characters. Returns account/confirmation status without credentials. |
| `/api/auth/login`                       | POST `{email,password}`; sets server session cookies.                                                                                               |
| `/api/auth/logout`                      | POST; invalidates the provider session and clears cookies.                                                                                          |
| `/api/auth/session`                     | GET; returns the verified user ID/email.                                                                                                            |
| `/auth/callback`                        | GET; exchanges a provider confirmation code and redirects to the workspace or confirmation error.                                                   |
| `/api/organisations`                    | GET memberships as `{id,name,currency,role}`; POST `{name,currency}` creates an organisation with the caller as owner.                              |
| `/api/organisations/:orgId/members`     | Owner/admin GET member IDs/emails/roles; PATCH `{userId,role}`; DELETE `?userId=...`. SQL protects ownership and the last owner.                    |
| `/api/organisations/:orgId/invitations` | Owner/admin GET metadata; POST `{email,role}` returns a one-time copyable invitation URL; DELETE `?id=...` revokes it.                              |
| `/api/invitations/accept`               | POST `{token}` from the authenticated intended recipient.                                                                                           |

Invitation roles are admin, salesperson, designer or customer. Owner promotion uses the checked member-role operation. The application generates links and does not send invitation email.

## Customers and projects

`/api/organisations/:orgId/customers`: staff GET up to 500 records; POST/PATCH `{name,email?,phone?,notes?}`, with PATCH `?id=...`; owner/admin DELETE `?id=...`. These contact records do not grant account access.

`/api/organisations/:orgId/projects`: GET up to 500 accessible projects, filtered by RLS; staff POST:

```json
{
  "name": "Measured bedroom",
  "customerId": null,
  "budgetMinor": 250000,
  "currency": "EUR",
  "style": "",
  "roomType": "bedroom",
  "room": {
    "name": "Bedroom",
    "width": 6,
    "depth": 5,
    "height": 2.7,
    "measurementsConfirmed": true,
    "zones": [],
    "openings": []
  }
}
```

This example describes a request, not seeded retailer/customer data. Room types are bedroom, living_room, office or other. Project/room/empty-scene creation is atomic. A supplied customer must belong to the same organisation. Project metadata update/deletion is not exposed by the current app.

`GET /api/projects/:projectId` returns authorised project metadata plus current role/edit capability. `/api/projects/:projectId/access` is owner/admin only: GET grants; POST `{userId,canEdit}`; DELETE `?userId=...`. Grants apply to customer members of the same organisation. Hidden/foreign projects return 404.

## Catalogue and assets

Staff `GET /api/organisations/:orgId/catalogue` supports `q` (product name/SKU), `category`, `active=true|false`, and `offset`, with at most 100 products per response. Each product contains its variants and validated asset DTOs. Availability filtering in the workspace currently applies to the loaded page.

Owner/admin POST to that collection or PATCH `/:productId` accepts the strict `productInputSchema` from `packages/catalogue/src/index.ts`: product SKU/name/category/currency, dimensions, safe integer priceMinor, colour/material, active/availability, stockQuantity, leadTimeDays and up to 100 variants. A product without explicit variants receives one matching default variant. Existing variant IDs preserve identity; omitted variants become inactive. DELETE `/:productId` archives the product and variants without deleting scene identities. Staff can GET one product.

`/catalogue/import`: owner/admin POST multipart with exactly one `file` field (UTF-8 CSV, at most 1 MiB/500 data rows). It returns `{id,status,summary:{rowCount,productCount,variantCount,errors}}`. Validation/conflict failure returns 422, saves no products and records a failed import summary. GET returns the latest 50 import records. Imports are insert-only and synchronous. See [CSV specification](CATALOGUE_IMPORT.md).

`/catalogue/:productId/assets`: owner/admin POST multipart `file` and optional `variantId`. The route caps files at 20 MiB; images have a stricter 10 MiB validator limit. Success returns a validated asset DTO whose URL is an authenticated app route. Staff GET `/assets/:assetId` streams private content; owner/admin DELETE removes metadata and then storage. Failed storage deletion returns `storageCleanupPending: true`; the unlinked content becomes unreadable.

`GET /api/projects/:projectId/products` returns selected scene items with current variant prices, assets, availability/stale flags, totalMinor, budgetMinor, currency and overBudget. Missing/mismatched prices make the total unavailable. It provides no tax/discount/quotation calculation. Customer responses expose only already-selected project products.

`GET /api/projects/:projectId/assets/:assetId` rechecks project access and that the asset belongs to a selected variant/product. Asset responses are private/no-store with `nosniff`; models download as attachments. There is no public or expiring signed storage URL.

## Scene operations

`GET /api/projects/:projectId/scene` returns `{scene,canUndo,canRedo}`. POST uses the strict shared request contract:

```json
{
  "action": "preview",
  "expectedVersion": 0,
  "operation": {
    "type": "transform",
    "objectId": "<object ID>",
    "mode": "smart",
    "transform": { "x": 3, "y": 0, "z": 3.8, "rotation": 3.141592653589793 }
  }
}
```

Preview returns `{proposal:{id,baseVersion,scene,movedIds,evaluated}}`. Accept with `{action:"accept",expectedVersion:0,proposalId:"<returned ID>"}`. Undo/redo use `{action:"undo",expectedVersion:1}` or `{action:"redo",expectedVersion:2}`. Committed responses return editor state.

Operations are transform, locks, room, group, group-remove, add-object and remove-object. See [scene schema](SCENE_SCHEMA.md). Adds resolve a real available same-organisation variant and check exact scene metadata; acceptance repeats checks, including inside the commit transaction. Removal requires an unlocked product and no remaining group/anchor references. Read-only customer grants cannot mutate a scene.

Saved project previews are actor-scoped, expire after 15 minutes and have a per-actor pending limit of 100 checked by the application. Competing requests can reach the limit concurrently, so this is not a database resource quota. Committing removes stale previews. GET `/scene/history` returns the latest 100 `{version,scene}` entries.

The unauthenticated `/api/scene` and `/api/scene/history` expose the same editor contract only for the isolated synthetic demo. Local proposals are process-owned and do not survive restart. The page and both demo routes require ROOMSELL_ENABLE_DEMO=1; disabled access returns 404 before storage access. Demo POST streams a 16 KiB byte bound. Durable project previews bind the engine version, base scene and approved-result fingerprints; legacy/incompatible previews return 409 and must be reviewed again.

## Errors

Common statuses: 400 malformed/schema-invalid input; 401 missing/invalid session; 403 missing role/edit rights or cross-origin mutation; 404 hidden/missing records; 409 stale scene/catalogue/preview conflicts; 413 oversized bodies/files; 415 wrong content type; 422 geometry/lock/asset/import errors; 429 too many pending previews; 503 missing database configuration. Unexpected errors return a generic 500 without provider credentials or raw internal diagnostics.

## Retailer pricing and quotations

`GET /api/organisations/:orgId/pricing` returns `{revision,policy,updatedAt}` or null to staff. Owner/admin PUT `{expectedRevision,policy}` uses compare-and-swap (0 creates the first revision). All policy fields are explicit: `{version:1,currency,taxMode:"exclusive"|"inclusive",taxRateBps,rounding:"per_line"|"invoice",discountBps,deliveryMinor,installationMinor,feesTaxable}`. Basis points and integer minor currency units avoid floating point money; no jurisdiction is guessed.

Staff `POST /api/projects/:projectId/quotations/preview` accepts `{expectedSceneVersion,expectedPolicyRevision}` and returns `{source,calculation,sourceFingerprint}`. Source is derived from the accepted, confirmed room and real current catalogue; quantities aggregate by variant. Missing/stale/unavailable variants, currency mismatches and insufficient stock reject quotation creation.

Staff POST `/quotations` issues with `{expectedSceneVersion,expectedPolicyRevision,expectedSourceFingerprint,idempotencyKey}`. A changed source requires fresh review. The server computes pricing, and SQL independently checks policy math and source freshness under the organisation lock before append-only insertion. Retries with the same actor/key/request return the same quote; key reuse for a different request returns 409. Stock is checked, not reserved or decremented.

GET `/quotations` returns the latest 50 issued records; GET `/quotations/:quoteId` returns an immutable snapshot. GET `/quotations/:quoteId/pdf` renders that snapshot as an authenticated PDF download. Staff and explicitly assigned customer accounts can read quotations only in an accessible project. Catalogue and policy updates never change an issued quote.

## Inventory connectors

Owner/admin `GET /api/organisations/:orgId/inventory` returns safe connection metadata, mappings, last 50 sync runs and `encryptionConfigured`. POST creates `{name,endpoint,token,enabled}`. PATCH `/:connectionId` uses `{expectedRevision,name,endpoint,enabled,token?}`; changing endpoint origin requires a fresh token. A public HTTPS address is verified before configuration and each fetch. No credential/ciphertext/provider-body appears in responses.

PUT `/:connectionId/mappings` replaces the complete mapping set with `{expectedRevision,mappings:[{externalProductId,externalVariantId,productId,variantId}]}`. IDs must belong to actual same-organisation product variants; a variant can have one connector owner. POST `/:connectionId/sync` takes `{expectedRevision}` and fetches one bounded, fresh complete snapshot. Validation/mapping failure leaves all catalogue values unchanged and records a sanitised failed run. Successful sync updates price/stock/availability, connection revision and freshness atomically; saved scene transforms/dimensions and issued quotes stay unchanged. See [inventory contract](INVENTORY.md).
