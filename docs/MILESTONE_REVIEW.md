# First three milestones: implementation review

This records implementation boundaries and reviewed issues. It is a development self-review with separate agent review and automated tests, not an independent production-security audit. Actual check results belong in [VALIDATION.md](VALIDATION.md).

## Geometry and edits

Strict scene v2 contracts and lossless v1 migration preserve identities, dimensions and transforms. Rotated SAT footprints enforce boundaries, ceiling, conservative openings and explicit exclusions. Rugs may overlap solid furniture but must fit architecture. Independent locks and rigid groups stay authoritative during manual and automatic edits.

Previews remain separate from saved state. Acceptance recomputes the original server-owned operation, then validates scene/locks before commit. Undo/redo restore complete snapshots under the current version and create another version. Candidate/search caps bound work and are documented without claiming global infeasibility or optimality.

## Account and data boundary

Server routes verify provider sessions and current membership. RLS/explicit grants and composite tenant foreign keys constrain reads and relations. Checked functions serialise sensitive writes on the organisation before rechecking authority. Last-owner protections, invitation recipient/expiry/replay checks, inviter demotion/removal revocation, project grants and current actor checks close the reviewed escalation paths.

Transactional commits compare the current scene version and append immutable version/operation rows. Direct authenticated scene, catalogue, membership and validated-asset writes are revoked. Service-role clients remain a trusted server boundary; SQL identity/authority checks supplement the application's complete domain/geometry validation.

## Catalogue and assets

Product/variant writes and insert-only imports are atomic. Validation/conflict failures keep the catalogue unchanged and persist an import summary. Real IDs, dimensions and availability are checked at scene preview, acceptance and inside the commit transaction under the catalogue write lock.

Assets use content identification, full image decode, Khronos structural checks and actual rendered model bounds. External resources are rejected without fetching. Registration repeats current authority/dimensions, and later dimension edits invalidate model assets. Private delivery checks staff membership or authorised selected-project relationships on every request. Metadata-first removal protects access when storage cleanup fails.

## Issues resolved during implementation

- Browser Origin checks use the HTTP Host instead of Next.js's internal bind address.
- Account forms wait for hydration before allowing submission; alert assertions avoid Next's route announcer.
- A Next.js development reload loop uses the supported Webpack dev option; normal production builds remain separate.
- Local service health probes use a dedicated Docker client profile for loopback rather than bypassing health checks/TLS.
- Local Supabase status is captured by atomic rename, avoiding partial reads during migration/readiness commands.
- Role revocation and catalogue changes share organisation-lock ordering with scene commits.
- Archived variant identities count towards the product's 100-variant bound, preserving representable API DTOs.
- Decimal money entry/display uses the currency exponent rather than assuming two fractional digits.

## Remaining release gates

Hosted email confirmation and HTTPS proxy/cookies, production limits/monitoring, backup/restore, retention/export/deletion and representative retailer/device validation remain open. Uploaded models do not yet render in 3D. Live selected prices are not immutable quotations. Inventory is checked without reservation. Large jobs, sales approvals, billing and AI have no implementation claim in this milestone.
