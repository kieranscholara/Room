# Catalogue, imports and assets

Owners/admins enter the retailer's real products and variants; staff can browse them and add available variants to project designs. No retailer inventory, SKU or price is generated automatically. Archiving retains identities used by saved designs. Omitted variants become inactive; replacement and inventory reservation are outside this milestone.

## CSV contract

Import multipart field `file` must contain valid UTF-8 CSV, at most **1 MiB and 500 data rows**. A UTF-8 BOM, CRLF/LF line endings and RFC 4180 quoted fields are supported. Headers may be reordered but must contain exactly these names once:

```text
product_sku,variant_sku,product_name,variant_name,category,price_minor,currency,width_m,depth_m,height_m,color,material,availability,stock_quantity,lead_time_days,active
```

| Fields                         | Meaning and validation                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| product_sku, variant_sku       | Nonempty, at most 100 characters; variant SKU occurs only once in a file.                      |
| product_name, variant_name     | Nonempty, at most 100 characters.                                                              |
| category                       | bed, wardrobe, bedside, rug or desk.                                                           |
| price_minor                    | Nonnegative safe integer in the currency's minor unit; no decimal amount or exponent notation. |
| currency                       | Three uppercase letters; all variants of a product use its currency.                           |
| width_m, depth_m, height_m     | Positive decimal metres; width/depth at most 20 m and height at most 10 m.                     |
| color                          | Six-digit hexadecimal colour, including `#`.                                                   |
| material                       | Optional empty text, at most 100 characters.                                                   |
| availability                   | in_stock, made_to_order or out_of_stock.                                                       |
| stock_quantity, lead_time_days | Nonnegative integers, at most 2,147,483,647.                                                   |
| active                         | Exactly true or false.                                                                         |

One row defines one variant. Repeat product_sku to group variants; product_name, category and currency must agree across those rows. The first row supplies the parent's base price, dimensions, colour/material and inventory fields; each variant retains its own row values. A product supports at most 100 retained variants. Catalogue addition uses variant dimensions/prices; an in_stock variant needs positive stock, while made_to_order uses its availability flag.

The policy is **insert-only**. Existing product or variant SKUs, duplicate variant SKUs, conflicting product metadata, malformed CSV or any invalid row reject the whole import. No partial catalogue write occurs. Correct an existing product through its edit form/API; the importer does not upsert or silently overwrite it. Retrying a successful file reports existing SKUs and inserts nothing.

Errors identify CSV rows/fields when validation knows them. A database conflict detected at transaction time may be an import-level error with row 0. Both completed and failed runs persist a summary, and the UI shows the latest 50. Processing is synchronous and bounded; large uploads, queued retries and durable jobs remain future work. The downloadable UI template contains only headers.

## Authoritative product metadata and prices

Manually entered products without separate variants receive one equivalent default variant. Full product/variant edits are transactional and repeat current administrator authority under the organisation lock. Scene adds and acceptance require exact authoritative identity, colour, category and dimensions. Inactive/out-of-stock variants, zero-stock in_stock variants, foreign tenants and currency mismatches are rejected.

Saved scene geometry does not silently resize when a catalogue changes. The selected-product panel reports stale metadata and current prices. Totals use safe integer minor-unit arithmetic with currency checks and overflow rejection. Decimal form entry uses the currency's decimal precision. Prices are live design estimates: taxes, discounts, stock reservation and immutable issued quotations have separate future rules.

## Private assets

The upload route accepts at most **20 MiB per file**. The validator has these additional limits:

- Photographs: PNG, JPEG or WebP identified by bytes, at most 10 MiB, 8192 pixels per side and 40 million pixels. Full Sharp decoding rejects corrupt/truncated, animated or multipage content.
- Models: GLB v2 or self-contained glTF 2.0. The domain validator caps models/decoded buffers at 50 MiB, while this app route's 20 MiB cap remains effective. Buffers/textures must be embedded; no external URI is fetched.
- Meshes: triangle primitives only; at most 200,000 rendered triangles, 500,000 vertices and 1000 nodes. Animated/skinned/morph-target models, sparse/normalised position accessors and unsupported compression/extensions are rejected.
- Textures: at most 32, 4096 pixels per side and 32 million combined pixels; image decoding checks still apply. Supported optional extensions are KHR_materials_unlit and KHR_texture_transform.

Khronos validation checks glTF structure. The application decodes actual position/index data, applies node world transforms and measures rendered bounds in metres: X width, Z depth, Y height. Each axis must match authoritative product/variant dimensions within the larger of **2 cm or 2%**. Validation records actual bounds/counts/warnings; it does not establish visual realism, a furniture certification or a rendered 3D preview.

Validated files enter private `product-assets` storage using generated organisation-prefixed paths. Registration rechecks current authority and dimensions. Dimension edits invalidate affected model assets. Metadata removal makes content unreadable before storage cleanup; a failed cleanup is reported and may leave private unlinked bytes for later maintenance.

The browser uses authenticated app asset URLs, with permissions rechecked on every request. Customer routes expose only assets for products/variants selected in their shared project. The editor remains a measured 2D rectangle/proxy view; uploaded models can be downloaded but are not yet rendered.
