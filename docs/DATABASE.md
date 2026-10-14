# Database and persistence

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
