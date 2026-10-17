# Database and persistence

## Current photograph persistence — migrations 020–022

`photo_compositions` is read-scoped by project RLS and writable only through checked service RPCs. It stores one bounded layer set per source photograph, CAS revision, scene/photo versions, applied render reference/hash and persisted staff actor/time. Layer admission checks exactly one authorised selected-product image for every current scene object. The write RPC serialises with organisation authority and validates confirmed measurements, calibration and exact source versions.

`quotation_photo_evidence` adds composite tenant foreign keys that prevent deleting originals/final references retained by issued quotations. A before-insert trigger binds verified current photo proof to the existing immutable quotation snapshot; an after-insert trigger registers retention evidence. The wrapper preserves the existing `issue_quotation` price/stock/authority transaction. Migration021 decouples completed-job retention and retains historical staff IDs without an auth-user deletion dependency. Migration022 separates deterministic local export capacity (60/person/hour) from AI capacity (20/person/hour and100/organisation/hour).

All are forward migrations, with no scene schema change, reset or catalogue rewrite. Source and final bytes stay private in `room-references`. JSON API masks remain strictly bounded; SQL independently checks object/asset/tenant relationships and stored payload size. See [SCENE_CONTRACT.md](SCENE_CONTRACT.md).

Supabase PostgreSQL stores real organisation data. Apply the repository's pending local migrations with `npm run db:migrate` after `npm run setup:local`. The official CLI owns the migration ledger. The script never resets or reseeds existing data. Hosted migration application needs a separately configured, reviewed Supabase target; this local command always targets the local stack.

## Migrations

| Migration                                        | Purpose                                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `202610140001_foundation.sql`                    | Organisation/account relations, customers/projects/scenes, catalogue/assets/imports, tenant foreign keys, RLS, private storage and initial checked functions. |
| `202610140002_project_access.sql`                | Customer project grants and authoritative project/scene creation and commits.                                                                                 |
| `202610140003_authorisation_serialisation.sql`   | Organisation-lock ordering, current-role checks, invitation authority/revocation and member removal protections.                                              |
| `202610140004_catalogue_workflows.sql`           | Atomic product/variant writes and imports, validated asset lifecycle, private embedded-glTF support and revoked direct catalogue writes.                      |
| `202610140005_catalogue_scene_serialisation.sql` | Catalogue checks repeated inside scene commit to close the catalogue-change/acceptance race.                                                                  |
| `202610140006_catalogue_variant_bound.sql`       | Bounds active and archived variants together to keep every retained product representable by the API contract.                                                |
| `202610140007_catalogue_search.sql`              | Generated product-name/SKU search document and stable tenant-scoped catalogue ordering.                                                                       |

## Data model

`organisations`, `organisation_members` and `organisation_invitations` establish tenant identity and roles. Invitations store only a token hash and acceptance/revocation/expiry metadata. Membership and invitation changes use checked functions, including last-owner and owner-promotion protections.

`customers` stores retailer contact records. `projects` stores an optional same-organisation customer, budget, currency, style, room type and status. `project_access` grants an existing customer member view or edit access. Composite foreign keys prevent foreign-tenant customers, members, rooms, scenes, variants and assets from being attached to a tenant's records. Tenant identifiers are immutable.

Each project has one `rooms` row and one `scenes` row. Canonical schema-v2 JSON is the geometry authority; the scene transaction synchronises the room's scalar dimensions. `scene_versions` and `scene_operations` record committed snapshots and the actor/operation. `scene_proposals` holds actor-scoped pending previews. Undo/redo arrays are bounded to 100 snapshots each; proposals expire after 15 minutes and are removed when an accepted version makes them obsolete. The current revision API returns at most 100 entries; the committed version tables have no application retention policy yet.

`products` and `product_variants` hold dimensions in metres and nonnegative safe integer minor-unit prices. Product SKUs and variant SKUs are independently unique within an organisation. Products retain at most 100 variants, including inactive/archived variants. Archiving and omitted variants preserve row identities for saved scenes. `product_assets` links validated private storage content to products or particular variants. Changing catalogue dimensions invalidates affected model assets until a replacement is validated. `catalogue_imports` records completed/failed synchronous import summaries and row errors.

## Write and permission boundary

Authenticated database clients can perform only explicitly granted, RLS-scoped operations. They cannot directly write memberships, invitations, scenes/history/operations/proposals, products/variants, validated assets or Storage uploads. The trusted server validates strict inputs and geometry, then uses service-only functions with an independently verified actor.

Sensitive functions lock the organisation before rechecking current membership; scene commits then lock the scene and compare its expected version. Concurrent writes based on one revision result in one success and a conflict. Revocation serialises with these transactions. The catalogue-add check also runs inside the commit transaction, so an accepted preview cannot silently use changed catalogue dimensions or availability.

Storage bucket `product-assets` remains private. Generated paths begin with the organisation UUID. Direct staff reads require linked, validated asset metadata; staged, removed and invalidated assets are unreadable through the authenticated Storage policy. App routes add project-specific customer checks.

The service role bypasses RLS and is a trusted server boundary. SQL validates identity, tenancy and authority; framework-independent code validates complete geometry. A leaked service-role key would compromise that boundary and must be rotated.

## Synthetic file adapter

`/demo` uses `.local/scene.json` relative to `apps/web`, or `ROOMSELL_DATA_DIR`. Atomic replacement and an in-process queue protect its single-process writes. It is separate from account data and supports synthetic fixtures only. Stop that server before copying/restoring its file. Multi-replica file persistence is unsupported.

Run `npm run test:integration` for real Auth/SQL/REST/Storage isolation checks. See [security](SECURITY.md) and [test plan](TEST_PLAN.md).

## Architecture steps 1–4 forward migrations

008 adds explicit retailer pricing policies/revisions and tenant-scoped immutable quotations, source admission and checked idempotent issuance. 009 adds inventory connection metadata, isolated encrypted credentials, explicit external variant mappings, sanitized sync runs and atomic reconciliation. 010 adds independent exact SQL policy-math validation before quotation insertion. All use forward migrations; no existing scene contract/data is rewritten. Apply pending migrations with the local ledger command; hosted rollout must target the intended database explicitly.

New direct database suites use fail-closed local preflight before creating identities or writing fixtures. The integration script discovers all `tests/*database*.test.ts` files and executes them explicitly; normal unit runs skip these cases.

## Platform migrations 011–016

011 adds private room references/storage policy and service-only leased tenant jobs. 012 adds separate order permission, immutable quotation orders/items/events, aggregate available-stock functions, expiry and checked transitions. 013 adds explicit published offers, owner-only consumer projects/versions/previews and consented selected-retailer enquiries; retailer catalogue access remains private. 014 hardens buyer-versus-staff order visibility/authority, aggregate fulfilment stock and publication currency. 015 blocks unacknowledged real snapshot-provider fulfilment. 016 repeats aggregate stock admission for new consumer furniture and restricts the actor helper.

Apply forward in order, never edit an already applied migration or reset user data. Consumer/enquiry/order foreign keys deliberately retain commercial references: deletion/export requires a reviewed lifecycle rather than hard-deleting products/projects. Automated fixtures delete only their own rows in dependency order through a local-only database connection; ordinary runtime roles have no such bypass.

All commercial/scene-affecting operations retain organisation-first locking. Multi-retailer consumer commits acquire referenced retailer locks in UUID order before the owned consumer scene. Consumer enquiry locks the selected retailer before that owned scene. Lease completion checks its token, expiry and current actor authority. None of these functions grants an authenticated client the ability to directly commit arbitrary scene JSON.
