# Catalogue import roadmap

Current furniture is deterministic synthetic engineering data in scene-core. There is no import UI or retailer catalogue, no stock/price claims, and no production catalogue endpoint.

Phase 3 acceptance: UTF-8 CSV with organisation-scoped SKU, name/category, currency, integer minor-unit price, positive width/depth/height in metres, availability and optional variant/stock/lead-time data. Validate entire imports with Zod; report row-level errors and reject ambiguous duplicate active SKUs, invalid dimensions, negative prices and malformed currencies. Require an explicit conflict resolution mode. Authorise the organisation server-side and use idempotent durable import jobs for large files.

Phase 4 acceptance: private product photographs and GLB/GLTF assets validated for file signature, size, geometry bounds, units/orientation, texture resources and render performance. Untrusted assets must never fetch arbitrary external resources. Approximate proxies must remain clearly identified. Catalogue import and security tests will run against real isolated database/storage fixtures.
