# MASTER BUILD PROMPT — ROOMSELL AI

> Historical source prompt. On 16 October 2026 the owner replaced the visible 2D workflow with a salesperson-operated photograph consultation: upload, scan/review visible objects, enter measured room dimensions, perform short floor calibration, choose actual retailer inventory, position it in the image, confirm with the client and quote. Earlier 2D requirements below are retained as source history and are superseded for current UI scope. The current behaviour and limits are documented in [PHOTO_SELLING.md](PHOTO_SELLING.md), [CURRENT_STATE.md](CURRENT_STATE.md) and [MVP_STATUS.md](MVP_STATUS.md). Metric scene validation, locks and tenant authority remain required. This original prompt is not a claim that every listed feature is implemented.

You are acting as a senior software architect, full-stack engineer, 3D graphics engineer, AI engineer, UI/UX designer, QA engineer and technical lead.

Your task is to design and develop **RoomSell AI**, a production-oriented multi-tenant SaaS platform for furniture retailers, interior designers and furniture showrooms.

Build an actual working application, not a landing page, static mockup or disconnected demonstration.

Use high-quality architecture, maintainable code, proper testing, secure multi-tenant data isolation and excellent UI/UX.

Work in phases, deliver running and testable software at every milestone, and do not claim functionality is implemented unless it is working and verified.

---

# 1. PRODUCT VISION

RoomSell AI allows furniture businesses to upload their own product catalogues, including product images, real dimensions, variants, prices, availability and optional 3D models.

A salesperson creates a project for a customer, enters room measurements or builds a room layout, uploads optional reference photographs, chooses the customer's style and budget, and generates a design using furniture from that store's own catalogue.

The customer can then interact with the design:

- Select individual furniture objects.
- Drag furniture to different positions.
- Rotate furniture.
- Move furniture between suitable walls.
- Lock an object's position.
- Lock an object's rotation.
- Lock a specific product/SKU so it cannot be replaced.
- Group related furniture, such as a bed and bedside tables.
- Automatically rearrange unlocked objects when something moves.
- Preserve all locked objects exactly.
- Undo and redo changes.
- Compare alternative layouts.
- View the same scene in 2D and interactive 3D.
- Request AI layout recommendations.
- Save approved designs.
- Generate an accurate quotation using real catalogue prices.
- Share a visual proposal with the customer.

**The core differentiator is constraint-aware furniture rearrangement with object-level locking.**

For example:

A customer likes the wardrobe's location and locks it. They move the bed to the opposite wall. RoomSell AI intelligently rearranges bedside tables, the rug, desk and other movable furniture while keeping the wardrobe in exactly the same position and orientation.

The app must not randomly change product models, colours, room dimensions, pricing or locked objects.

# 2. CRITICAL ARCHITECTURAL PRINCIPLES

The room's source of truth must be structured geometric scene data, not an AI-generated image.

An image-generation model cannot be trusted to maintain precise positions, exact furniture identities or physical dimensions.

Use a hybrid system:

1. A precise 2D floor-plan editor.
2. A synchronised, interactive 3D room viewer.
3. A deterministic constraint-aware layout engine.
4. AI services for design suggestions, natural-language commands and catalogue recommendations.
5. A sales and quotation system.

All object positions must be stored in real-world metres, not display pixels.

Use a consistent coordinate system:
- X = horizontal room axis.
- Y = vertical height.
- Z = second horizontal room axis.
- Rotation around the Y-axis.

The 2D editor uses the X/Z plane.

The geometry engine must be independent of React and independent of any LLM.

AI cannot override locks, collisions, financial calculations, catalogue identities, approved dimensions or tenant permissions.

# 3. TECH STACK

Use the following stack unless a well-justified alternative is necessary:

Frontend:
- Next.js with App Router.
- TypeScript in strict mode.
- Tailwind CSS.
- shadcn/ui.
- React Konva for precise 2D editing.
- Three.js and React Three Fiber for interactive 3D rendering.
- Zustand and Immer for editor state.

Backend:
- Next.js API route handlers or a clearly separated backend service where appropriate.
- Supabase PostgreSQL.
- Supabase Auth.
- Supabase Storage.
- PostgreSQL Row Level Security.
- Zod for request validation.
- Background workers and a durable job queue for intensive tasks.

AI:
- A configurable LLM provider abstraction, initially using OpenAI.
- Structured JSON outputs and strict schema validation.
- Image generation only for optional conceptual visualisations.
- No LLM involvement in hard geometric constraints.

Payments:
- Stripe subscriptions.
- Usage-based rendering credits when necessary.

Testing:
- Vitest for unit and integration tests.
- Playwright for end-to-end tests.
- Property-based testing for geometry.
- Automated database security tests.

Operations:
- GitHub Actions for CI.
- Sentry for monitoring.
- Environment-based configuration.
- Database migrations.
- Staging and production environments.

Use a TypeScript monorepo with packages for scene-core, geometry, layout-engine, catalogue, pricing, AI and shared UI.

# 4. MULTI-TENANT BUSINESS ACCOUNTS

Implement organisations representing individual furniture businesses.

Each business must have:

- Its own organisation account.
- A private furniture catalogue.
- Its own product prices and inventory information.
- Its own staff members.
- Its own customer records.
- Its own room projects.
- Its own quotations.
- Its own branding.
- Its own subscription and usage limits.

Roles:
- Platform admin.
- Retailer owner.
- Retailer administrator.
- Salesperson.
- Designer.
- Customer with restricted project access.

A member of one retailer must never access data from another retailer.

Enforce tenant isolation in database policies and server-side authorisation. Include automated cross-tenant access tests.

# 5. FURNITURE CATALOGUE

Build a catalogue management dashboard.

Allow retailers to:
- Add products manually.
- Import products via CSV.
- Edit products and variants.
- Upload product photographs.
- Upload optional GLB/GLTF 3D models.
- Configure dimensions.
- Manage colour and material variants.
- Set prices.
- Track product availability.
- Mark products inactive.
- Search and filter products.

Product information must include:
- Unique SKU within its retailer.
- Name and category.
- Selling price and currency.
- Width, depth and height in metres.
- Product photographs.
- Availability status.
- Optional model assets.
- Optional stock quantity.
- Optional lead time.
- Optional delivery/installation rules.

Validate all imports.

Reject invalid or missing dimensions, duplicate active SKUs without an explicit resolution, negative prices and malformed asset files.

3D models must have a validation pipeline for format, geometry, dimensions, orientation, textures and performance.

When a precise 3D product model is unavailable, show a generic dimensionally accurate proxy clearly identified as approximate.

Never claim that a proxy is the exact furniture being sold.

# 6. CUSTOMER PROJECT WORKFLOW

A salesperson can:

1. Create a customer record.
2. Start a new room project.
3. Choose bedroom, living room or another supported room type.
4. Set customer budget.
5. Choose design style and colour preferences.
6. Enter room measurements.
7. Define doors, windows and immovable features.
8. Upload optional room reference photographs.
9. Select products from the retailer catalogue.
10. Ask for initial layout suggestions.
11. Modify the layout interactively.
12. Lock selected objects.
13. Save revisions.
14. Generate and issue a quotation.

Start with accurately measured rectangular rooms. Add non-rectangular geometry later.

Do not assume that a single room photograph provides reliable wall lengths, depth measurements or hidden geometry.

Measurements must be confirmed by a person before the layout is treated as physically accurate.

# 7. INTERACTIVE 2D ROOM EDITOR

Build a professional, responsive floor-plan editor.

Required capabilities:

- Display room walls, doors, windows and obstacles.
- Show furniture footprints at real scale.
- Select objects.
- Drag objects.
- Rotate objects.
- Snap to grid and walls.
- Zoom and pan.
- Display dimensions and distance guides.
- Detect furniture collisions.
- Check room boundaries.
- Validate door swings and clearance zones.
- Display selected-product information.
- Lock/unlock position.
- Lock/unlock rotation.
- Lock/unlock SKU selection.
- Create and manage furniture groups.
- Undo and redo operations.
- Save and reload scenes.
- Compare scene revisions.
- Preview changes before committing them.

The editor must support mouse and touch interaction.

Use accessible controls, helpful error messages, sensible keyboard shortcuts and a polished user experience.

# 8. SMART REARRANGE ENGINE — MOST IMPORTANT FEATURE

Implement a deterministic, constraint-aware layout engine.

This feature must be treated as the highest-priority technical component.

When a customer moves an object, the engine should attempt to rearrange related and nearby unlocked objects intelligently.

Example:

The customer moves a bed to another wall.

The system should attempt to:
- Relocate bedside tables so they remain appropriately positioned beside the bed.
- Reposition the rug where appropriate.
- Maintain usable walking space.
- Preserve other furniture arrangements when possible.
- Avoid collisions.
- Stay inside the room.
- Respect doors, windows and clearance rules.
- Preserve every locked position and rotation exactly.

Hard constraints:
- Locked object positions never change automatically.
- Locked rotations never change automatically.
- Furniture cannot intersect room walls or fixed obstacles.
- Solid furniture cannot physically overlap.
- Required clearance zones must remain valid.
- Physical product dimensions cannot be arbitrarily changed.
- Fixed architectural elements cannot move.
- Locked SKUs cannot be replaced.
- Tenant permissions cannot be bypassed.

Soft preferences:
- Bedside tables remain near the bed.
- Rugs align logically with furniture groups.
- Tables remain usable.
- Seating faces appropriate focal points.
- Desks and cabinets align sensibly with walls.
- Preserve original positions as much as possible.
- Minimise unnecessary movement.
- Maintain visual balance and sensible circulation.

Algorithm requirements:

1. Receive a validated scene and requested operation.
2. Check locks and permissions.
3. Create a trial scene.
4. Identify affected unlocked objects.
5. Generate candidate positions and orientations.
6. Reject geometrically invalid candidates.
7. Score valid arrangements based on layout preferences.
8. Select the best valid solution.
9. Return a proposed scene without silently committing it.
10. Let the user accept or reject the proposal.
11. Validate and commit the accepted scene atomically.
12. Record a new version for undo and history.

When no valid layout exists, preserve the previous scene and return an understandable conflict.

Offer alternatives such as:
- Choose a smaller bed.
- Rotate the bed.
- Unlock a conflicting object.
- Remove an optional item.
- Change the proposed location.

Never secretly unlock an object or break a hard constraint.

Support two editing modes:
- Manual: move only the selected item, with invalid movements rejected.
- Smart: move the selected item and optimise other eligible unlocked items.

Ensure deterministic results for the same inputs and solver configuration.

Write extensive unit, integration and property-based tests covering locked objects and geometry.

# 9. FURNITURE LOCKING SEMANTICS

Implement separate lock types.

Position lock:
- Prevents X/Y/Z movement.
- Persists through every automatic rearrangement.
- Prevents direct movement until unlocked.

Rotation lock:
- Prevents rotation.
- Persists through all automatic operations.

Product lock:
- Preserves the particular SKU/variant.
- Does not necessarily prevent movement.

Group lock:
- Preserves configured relationships or the group's relative transforms according to clearly documented semantics.

Lock and unlock changes must be saved, versioned and enforced by the backend, not merely disabled in the UI.

Concurrent editors must not overwrite newer locks. Use scene version checks and return conflicts for stale writes.

# 10. INTERACTIVE 3D VIEWER

Build a 3D room view synchronised with the 2D editor.

Both must use the same canonical scene data.

Requirements:
- Walls, floor and ceiling.
- Correct room proportions.
- Real furniture dimensions.
- Validated GLB/GLTF product models where available.
- Generic proxies otherwise.
- Orbit and zoom camera controls.
- Preset camera views.
- Selection highlighting.
- Responsive rendering.
- Appropriate lighting and materials.
- Correct transforms after movement and rotation.
- Screenshots or image exports.

Changing furniture in the 2D view must update the 3D view without altering its geometry.

Do not attempt to maintain two independent layouts.

Optimise models, textures and loading performance.

# 11. AI FEATURES

Implement AI as an assistant to the deterministic application.

Feature A: Furniture recommendations.

Given retailer catalogue candidates, budget, style and required furniture, rank valid product combinations.

The application must independently verify:
- SKU existence.
- Product availability.
- Prices and totals.
- Dimensions.
- Room placement feasibility.
- Customer budget.

Feature B: Natural-language editing.

Examples:
- Move the bed against the opposite wall.
- Keep the wardrobe exactly where it is.
- Make the room feel more spacious.
- Replace the desk with a smaller model.
- Rearrange everything except the locked furniture.

The AI translates user instructions into structured intents or permitted scene operations.

The geometry engine verifies all requests before changes can be committed.

Feature C: Layout alternatives.

Suggest alternative room arrangements that preserve all customer-approved locked objects and products.

Feature D: Optional conceptual rendering.

Generate attractive conceptual room imagery, but clearly distinguish this from accurate 3D product placement.

Do not use an unconstrained generative image as the authoritative layout.

# 12. BUDGET OPTIMISER

Build a price-aware furniture selection engine.

Inputs:
- Customer budget.
- Room type and dimensions.
- Required furniture categories.
- Preferred style and colours.
- Availability preferences.
- Retailer catalogue.
- Delivery and installation requirements.

Outputs:
- Valid furniture packages.
- Itemised pricing.
- Total cost.
- Remaining budget.
- Alternatives at different price levels.
- Reasons why a particular combination was recommended.

Use integer minor units for currency calculations.

Handle VAT, discounts, delivery and installation through configurable retailer rules.

A hard budget must not be exceeded without explicit approval.

AI must never invent a price or product.

# 13. QUOTATION AND SALES SYSTEM

Build a proposal generator.

Each proposal must contain:
- Retailer's logo and business details.
- Customer name and reference.
- Selected room design.
- Scene version.
- Itemised furniture.
- Real SKUs and product variants.
- Quantities.
- Prices.
- VAT and discounts.
- Delivery and installation.
- Total quotation.
- Validity date.
- Terms and conditions.
- Product availability/lead-time information.

Generate professional PDF quotations.

Salespeople must approve quotations before they are issued.

Issued quotations must save immutable product and price snapshots.

Track proposal status:
- Draft.
- Under review.
- Issued.
- Revision requested.
- Accepted.
- Declined.
- Expired.

Allow revised proposals without overwriting old issued documents.

# 14. CUSTOMER REVIEW EXPERIENCE

Create a secure customer review page.

Customers should be able to:
- View their proposed room.
- Inspect products and prices.
- View 2D and 3D layouts.
- Request permitted furniture changes.
- Move or lock furniture where enabled.
- Save proposed revisions.
- Compare alternatives.
- Request updated quotations.
- Approve a proposal or request a consultation.

A customer must never gain access to retailer administration, internal supplier costs or another customer's project.

Support revocable links and restricted edit permissions.

# 15. DATABASE DESIGN

Design proper PostgreSQL schemas and migrations for:

- organisations
- organisation_members
- customers
- products
- product_variants
- product_assets
- inventory
- projects
- rooms
- scenes
- scene_versions
- scene_operations
- proposals
- proposal_items
- proposal_events
- render_jobs
- subscriptions
- usage_events
- audit_logs

Store validated scene data using a versioned schema.

Store product relationships in relational tables.

Avoid mutable product pricing references for historical quotes.

Create appropriate indexes, constraints, foreign keys and Row Level Security policies.

Use migrations, never manual undocumented production database changes.

# 16. BACKGROUND JOBS

Use durable background jobs for:
- Catalogue imports.
- 3D model processing.
- Thumbnail generation.
- Heavy rendering.
- PDF generation where necessary.
- AI tasks that exceed normal request processing limits.

Track status:
- Queued.
- Processing.
- Completed.
- Failed.
- Cancelled.

Implement retries with limits, idempotency, error logs and usage accounting.

# 17. BILLING

Implement Stripe subscription billing for furniture businesses.

Support:
- Trial or pilot subscriptions.
- Monthly and annual plans.
- Seats if required.
- Usage allowances.
- Render credits.
- Subscription upgrades.
- Subscription cancellation.
- Invoice access.
- Webhook-based subscription state updates.

Do not hard-code commercial prices in business logic.

Store prices and plan limits in configuration.

# 18. FRONTEND SCREENS

Build:

1. Marketing landing page.
2. Retailer signup/login.
3. Retailer dashboard.
4. Product catalogue.
5. CSV import flow.
6. Product detail and 3D preview.
7. Team management.
8. Customer records.
9. Project list.
10. New room project wizard.
11. Room dimensions and architecture editor.
12. Main 2D room designer.
13. Interactive 3D room viewer.
14. Furniture properties and locking panel.
15. AI assistant panel.
16. Budget and selected products panel.
17. Layout alternatives and revision history.
18. Proposal builder.
19. Customer review page.
20. Sales pipeline dashboard.
21. Analytics.
22. Billing and account settings.

UI design direction:
- Premium, modern SaaS appearance.
- Easy enough for nontechnical showroom salespeople.
- Clean typography.
- Neutral visual palette.
- Furniture-first imagery.
- Clear 2D/3D switching.
- Prominent lock/unlock controls.
- Simple Smart Rearrange action.
- Visible budget and quotation total.
- Minimal clutter.

Prioritise desktop/tablet editing. Provide a usable mobile review interface.

# 19. SECURITY AND PRIVACY

Implement:
- Secure authentication.
- Role-based permissions.
- Multi-tenant isolation.
- Row Level Security.
- File upload validation.
- Private storage paths and signed access.
- Input validation.
- Rate limiting.
- Secure secrets handling.
- Audit logging.
- Safe Stripe webhook verification.
- Backup and recovery processes.
- Customer data deletion/export procedures.
- Reasonable GDPR-aligned privacy and retention controls.

Never expose service-role credentials in client code.

# 20. TESTING REQUIREMENTS

Create comprehensive tests, especially for the layout engine.

Required scenarios:

1. Moving a bed moves eligible bedside tables.
2. A locked wardrobe never moves.
3. A rotation-locked object never rotates.
4. A product-locked SKU is never replaced.
5. Door clearance is preserved.
6. Objects cannot cross room boundaries.
7. Furniture collision is detected after rotation.
8. A room with insufficient space returns a failure.
9. Undo restores the exact prior layout.
10. Redo restores the accepted change.
11. Save and reload preserve precise coordinates and lock states.
12. Two competing edits cannot silently overwrite each other.
13. Cross-tenant data access is rejected.
14. Budget calculations remain correct.
15. Quotations preserve issued prices.
16. Invalid catalogue imports are reported.
17. 2D and 3D views have identical scene geometry.

Use deterministic fixtures and generated geometry tests.

Ensure every critical path has meaningful integration coverage.

# 21. IMPLEMENTATION PHASES

Work through the project in this order.

PHASE 1 — Engineering foundation:
- Repository setup.
- Architecture documentation.
- TypeScript monorepo.
- Shared scene schema.
- Testing foundation.
- Continuous integration.

PHASE 2 — Working editor proof of concept:
- Measured rectangular room.
- Bed, wardrobe, bedside tables and rug.
- 2D drag and rotate.
- Position locks.
- Collision detection.
- Smart Rearrange v1.
- Undo and redo.
- Save/reload.
- Automated geometry tests.

PHASE 3 — Multi-tenant SaaS foundation:
- Authentication.
- Organisation accounts.
- Role-based permissions.
- Database.
- Catalogue management.
- CSV imports.
- Customer projects.

PHASE 4 — Real catalogue design:
- Product variants and dimensions.
- Scene integration with real SKUs.
- Accurate product footprints.
- Basic 3D viewer.
- Asset validation.

PHASE 5 — AI and budget:
- AI catalogue recommendations.
- Budget optimiser.
- Layout alternatives.
- Natural-language editing.
- Strict validation of all proposed changes.

PHASE 6 — Sales workflows:
- Proposal generation.
- PDFs.
- Revisions.
- Customer review.
- Sales tracking.

PHASE 7 — Commercial production:
- Stripe billing.
- Background rendering jobs.
- Monitoring.
- Performance optimisation.
- Security hardening.
- Pilot retailer onboarding.
- Production deployment.

Complete each phase to a demonstrably working standard before starting major work on the next phase.

# 22. DEVELOPMENT STANDARDS

Use:
- Strict TypeScript.
- Modular architecture.
- Domain-driven boundaries where appropriate.
- Strong schemas and explicit contracts.
- Descriptive naming.
- No duplicated business rules.
- No secrets in source code.
- Proper loading/error states.
- Useful accessibility labels.
- Consistent code formatting.
- Automated tests.
- Documentation.
- Meaningful Git commits.

Do not create placeholder buttons that do nothing.

Do not create fake analytics or claim that mocked data is live.

Do not leave core functionalities as visual-only demonstrations.

Where external credentials or infrastructure are unavailable, provide working local adapters or clearly identified development mocks, along with configuration instructions.

Do not silently replace required functionality with a mock.

# 23. REQUIRED DOCUMENTATION

Create and maintain:

- README.md
- AGENTS.md
- docs/PRODUCT_REQUIREMENTS.md
- docs/ARCHITECTURE.md
- docs/SCENE_SCHEMA.md
- docs/COORDINATE_SYSTEM.md
- docs/LAYOUT_ENGINE.md
- docs/LOCKING_RULES.md
- docs/CATALOGUE_IMPORT.md
- docs/API.md
- docs/DATABASE.md
- docs/SECURITY.md
- docs/TEST_PLAN.md
- docs/DEPLOYMENT.md
- docs/ROADMAP.md
- docs/KNOWN_LIMITATIONS.md

Include setup commands, environment variable examples, migration instructions, test commands and a deployment procedure.

# 24. HOW TO START

Start immediately by inspecting the repository and identifying any existing code or conventions.

If the repository is empty, initialise the monorepo and begin implementation.

First deliver:
1. A concise architecture and milestone plan.
2. A versioned room scene schema.
3. The geometry module.
4. A working 2D bedroom editor.
5. Furniture movement and rotation.
6. Hard object locking.
7. Smart Rearrange v1.
8. Collision checking.
9. Undo/redo.
10. Tests proving that locked objects cannot be altered.

Use demo furniture data initially.

Do not spend the first milestone implementing payments, extensive marketing pages, AI-generated images or unrelated integrations.

Run the application and verify the acceptance tests.

After completing the first milestone, report:
- What was actually implemented.
- Files created or modified.
- Tests run and results.
- Any failures or remaining limitations.
- Instructions to run the demo.
- The next highest-priority tickets.

Then continue through the roadmap in manageable increments, using code review and test gates.

# 25. NON-NEGOTIABLE PRODUCT REQUIREMENT

**THE CUSTOMER MUST BE ABLE TO LOCK ANY FURNITURE OBJECT, MOVE ANOTHER OBJECT, AND LET THE SYSTEM INTELLIGENTLY REARRANGE OTHER UNLOCKED FURNITURE WITHOUT EVER ALTERING THE LOCKED OBJECT'S SAVED POSITION OR ORIENTATION.**

This is the flagship feature of RoomSell AI.

It must work reliably, consistently and measurably.

When constraints are impossible to satisfy, return a clear failure and do not corrupt the layout.

Build RoomSell AI around that promise.
