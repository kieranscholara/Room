# Inventory connector contract

Implemented provider: `custom_rest`, manual full-snapshot GET with a Bearer token over public HTTPS. Shopify/WooCommerce-native adapters, webhooks, schedules, product creation and stock reservation are future work. A live retailer system and its credentials must be configured; source code contains no live endpoint or fabricated retailer inventory.

The endpoint returns `application/json` with the strict contract:

```ts
{
  schemaVersion: 1,
  generatedAt: string, // ISO UTC timestamp; newer than the last accepted snapshot
  items: Array<{
    externalProductId: string;
    externalVariantId: string;
    sku: string;
    currency: string;
    priceMinor: number; // safe non-negative integer
    stockQuantity: number; // non-negative integer <= 2147483647
    availability: 'in_stock' | 'made_to_order' | 'out_of_stock';
  }>;
}
```

The payload is at most 1 MiB/1,000 items. Timestamps must be within 15 minutes, at most one minute into the future, and strictly advance. In-stock requires positive quantity; out-of-stock requires zero. Every item must exactly match one explicit external-ID mapping; every configured mapping must appear, with no duplicates. SKU and currency must match the current actual variant/product. The connector cannot guess mappings from a SKU, create products, or change geometry/locks. Unmapped provider catalogues should expose a filtered endpoint matching the configured mapping scope.

Owners/admins configure up to twenty connections per organisation and explicitly replace mappings to stable product/variant UUIDs. One internal variant belongs to at most one connector. Config/mapping/sync use revision compare-and-swap; mapping edits during a fetch reject application. Sync applies the entire batch under the organisation lock shared with catalogue, quote and membership writes. Any invalid item rolls back all catalogue changes and produces a sanitised failure audit. Parent price becomes minimum active variant price; parent stock is the active-variant sum and availability is derived from active variants. Integer overflow fails atomically.

The HTTPS transport validates all DNS answers, pins the chosen public address while preserving hostname TLS verification, rejects private/loopback/transition addresses and redirects, bounds lookup/request time and streamed bytes, and logs no provider token/body. Credentials are AES-256-GCM envelopes tied to the tenant. The required server-only encryption key and recovery limitations are in [DEPLOYMENT.md](DEPLOYMENT.md).

Successful synchronization records source generation time and local completion time. Quotation creation checks current aggregate variant stock but neither reserves stock nor guarantees later checkout availability. A failed sync does not update freshness. Issued quotations retain their original availability observation; accepted scenes retain physical snapshots.

Configuration uses the server-only `ROOMSELL_CONNECTOR_ENCRYPTION_KEY`, a canonical base64 encoding of 32 random bytes supplied through deployment secrets. It must never use a `NEXT_PUBLIC_` variable. Missing configuration disables connector writes and synchronization while leaving redacted metadata readable. Changing or losing this key requires securely re-enrolling provider tokens; automatic multi-key rotation is not implemented. Encrypted credentials cannot be recovered without their original key. Changing the endpoint host requires re-entering a provider token, so a previously stored token cannot silently move to a new host.

Endpoints must return HTTP 200 without redirection. URL credentials, query strings, fragments and alternate ports are rejected. DNS lookup is bounded to five seconds and the entire HTTPS request to fifteen seconds. Name, endpoint and token lengths are bounded to 100, 2,048 and 4,096 characters respectively. Credential line breaks and null bytes are rejected. Provider response bodies and detailed network errors are never exposed in failed-run audits.

The authenticated owner/admin APIs are:

- `GET /api/organisations/{orgId}/inventory`: redacted connections, mappings, fifty recent runs and encryption configuration status.
- `POST /api/organisations/{orgId}/inventory`: create `{name, endpoint, token, enabled}`.
- `PATCH /api/organisations/{orgId}/inventory/{connectionId}`: update `{expectedRevision, name, endpoint, enabled, token?}`.
- `PUT /api/organisations/{orgId}/inventory/{connectionId}/mappings`: replace `{expectedRevision, mappings}` with explicit existing product/variant UUIDs and external product/variant IDs.
- `POST /api/organisations/{orgId}/inventory/{connectionId}/sync`: manually fetch and apply `{expectedRevision}`.

Configuration conflicts return HTTP 409. Provider or catalogue snapshot failures return sanitized errors with a failed audit run and no catalogue data changes. There is no configured live provider after installation; retailers must supply their actual endpoint, token and mappings.
