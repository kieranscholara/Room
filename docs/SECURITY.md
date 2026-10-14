# Security boundary

Real account, catalogue and project routes authenticate through Supabase and enforce organisation/project permissions. The unauthenticated `/demo` and `/api/scene` routes serve a separate synthetic fixture; they must be removed or restricted before a public production rollout.

## Roles

| Action                                           | Owner/admin | Salesperson/designer | Customer                                   |
| ------------------------------------------------ | ----------- | -------------------- | ------------------------------------------ |
| Read organisation catalogue                      | Yes         | Yes                  | No                                         |
| Write catalogue, imports or assets               | Yes         | No                   | No                                         |
| Create projects and create/edit customer records | Yes         | Yes                  | No                                         |
| Delete customer records                          | Yes         | No                   | No                                         |
| Edit a project scene                             | Yes         | Yes                  | Only an explicitly editable shared project |
| Read selected project products/assets            | Yes         | Yes                  | Only an explicitly shared project          |
| Manage members/invitations/project sharing       | Yes         | No                   | No                                         |

Owner promotion/demotion and protected owner removal require an owner. An organisation must retain an owner. Staff have access to their organisation's projects; customer access is per project. Creating a customer contact record grants no login or sharing rights.

## Accounts and requests

Request-scoped SSR clients verify sessions using `auth.getUser()`. Cookies are HttpOnly, SameSite=Lax and Secure when the trusted proxy reports HTTPS. Configure the proxy to set the correct host/protocol; arbitrary untrusted forwarding headers must not reach the app. Keys are read by server-only modules and never included in browser code or response DTOs.

Mutation routes reject a supplied cross-origin browser Origin. Strict Zod contracts reject unknown fields, forged scene metadata and invalid numeric values. JSON bodies are streamed with a 64 KiB bound; multipart routes enforce separate bounded limits before decoding files. Account APIs use provider authentication controls; comprehensive application-level production rate limits remain a rollout requirement.

Invitation tokens are cryptographically random, stored as SHA-256 hashes, bound to the recipient's verified Auth email, valid for seven days, single-use and revocable. Demoting/removing an inviter revokes pending invitations, and acceptance checks the inviter's current authority. The application generates copyable links; it does not send invitation email. Do not put live invitation URLs or tokens in logs or public documents.

## Database and assets

RLS, explicit grants, immutable tenant fields and composite foreign keys enforce tenant scope. Sensitive service-only RPCs repeat actor checks under an organisation lock. Authenticated clients cannot directly inject scenes, history, memberships, catalogue writes or validated asset rows. Scene acceptance recomputes the original server-owned operation; version checks and catalogue checks run again at commit. Customers cannot read the whole catalogue, customer directory or team management data.

Assets enter a private bucket only after byte/format/decode/model validation. External model resources, SVG and unsupported executable/text formats are rejected. App URLs authenticate each download; customer routes prove that an asset belongs to a variant selected in their permitted project. Responses use private/no-store caching and `nosniff`; models download as attachments. Dimension changes invalidate affected models. Failed registration attempts clean up staged content; unlinked content stays unreadable if storage cleanup fails.

The server service-role credential is privileged and bypasses RLS. Provision it through secure server environment bindings, rotate it if exposed, and exclude `.local`, environment files and diagnostic infrastructure logs from source/distribution. Local status and CLI logs can contain generated development keys even when terminal output does not.

## Verification and remaining production work

The integration suite uses actual Auth tokens, PostgreSQL roles/JWT claims, REST and private Storage across isolated tenants. Browser/API acceptance covers account roles, invitation misuse, project sharing/revocation, concurrent versions and catalogue/assets. Actual execution results belong in [VALIDATION.md](VALIDATION.md).

Local email confirmation is disabled for development. Hosted email delivery/confirmation, proxy/cookie configuration and hosted policies still need staging validation. Before public rollout, add production rate limiting, monitoring, backup/restore tests, retention/export/deletion rules and a security review. This implementation does not establish a GDPR or production-security certification. Billing webhooks, anonymous customer review links and durable jobs are later milestones with their own permission gates.

## Platform additions

Private room photographs use a separate private bucket and current project access for metadata and bytes; source decoding reuses full catalogue image validation. Measurements are never derived/trusted from a photograph. Sending references to OpenAI requires explicit selection; provider requests disable response storage and restrict structured output, time, bytes, redirects and candidate IDs. The backend repeats catalogue, commercial budget, stock, actor, version, geometry and lock checks. Workers save previews, never automatically accept scenes.

Job/worker secrets stay server-side. Jobs have bounded leases/results/retries and completion is cancelled after permission revocation. Another customer's ordering grant does not reveal or manage an existing buyer's orders. Financial snapshots remain immutable. Public catalogue access is a custom allowlist tied to explicit administrator publication/image consent, never a broad RLS relaxation. Consumer projects have owner-only persistence even when that consumer later becomes a retailer customer.

Fictional shortcut logins require verified local mode and test flags, exact registered Auth IDs/emails/test metadata and isolation from unrelated organisations. Generated passwords/tokens, local backup identity data and connector keys are ignored/restricted and must never enter source archives or deployment output. Output tracing excludes local fixtures. Production keeps both synthetic flags disabled, requires a configured HTTPS signup origin and always issues Secure cookies.

Hosted email, provider quality/privacy contracts, production monitoring, account deletion/export and retention remain operator rollout work. An external inventory snapshot is not an upstream order acknowledgement; real mapped-stock fulfilment fails closed pending that adapter. See DEPLOYMENT.md and ARCHITECTURE_RISKS.md.
