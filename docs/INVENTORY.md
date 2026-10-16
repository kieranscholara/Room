# Inventory connector contract

Implemented provider: `custom_rest`, full-snapshot GET and an optional idempotent supplier fulfilment POST with a Bearer token over public HTTPS. Synchronization can run manually or through the durable queue. Local order reservations are implemented. Shopify/WooCommerce-native adapters, provider reservation APIs, webhooks, automatic schedules and product creation remain outside this contract. Boreal Living is explicitly fictional; no live supplier is configured.

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

## Optional supplier acknowledgement

Owners/admins can set `orderEndpoint` when creating/editing a connection. It must share the snapshot endpoint's HTTPS origin and uses the same encrypted credential. Blank means snapshot-only: externally mapped stock cannot be fulfilled. Migrating does not opt existing real connections into outbound writes.

POST JSON contract (integer quantities; no customer identity or photograph is transmitted):

```json
{
  "schemaVersion": 1,
  "orderId": "00000000-0000-4000-8000-000000000001",
  "requestHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "currency": "EUR",
  "items": [
    { "externalProductId": "BL-ASTER", "externalVariantId": "BL-ASTER", "sku": "BL-ASTER", "quantity": 1 }
  ]
}
```

These are illustrative identifiers. The actual payload is frozen from checked database order items and explicit mappings before any request. The hash is SHA-256 of the database's canonical JSONB request without `requestHash`; providers treat it as an opaque payload identity. Validate schema/items independently rather than recomputing with a different JSON serializer.

The supplier must return HTTP 200 JSON, bounded to 16 KiB, with exactly `schemaVersion: 1`, the same `orderId` and `requestHash`, `status: "accepted" | "rejected"`, and a non-empty `supplierReference` of at most 200 characters. It must durably deduplicate by `orderId`, reject changed payloads for that ID, and return the same terminal receipt on every retry. **Accepted** means the mapped quantities were applied to upstream stock once and subsequent snapshots reflect that change. **Rejected** guarantees no upstream stock/order mutation. An HTTP error, invalid receipt or timeout is an unknown outcome, not a rejection.

The database serializes admission, verifies retailer permission and aggregate stock, and persists the request before sending. While its outcome is unknown, cancellation and conflicting stock/mapping/credential/configuration changes are fenced. A second order sharing the supplier or affected stock waits. Retrying uses the same frozen request. Acceptance receipt, local stock decrement, order status and audit event commit atomically; duplicate completion returns the original result. Rejection preserves local stock and allows cancellation; fulfilment cannot bypass a rejected or missing receipt. Current staff permission is rechecked at completion. Receipt/request rows are read-only through project access; ordinary users and the service client cannot write them directly.

An order can contain manual stock plus at most one supplier connection. Multiple supplier connections fail before any external request and require separate projects/quotations. Arbitrary HTTP status/body formats require a provider-specific adapter. The local Boreal simulator implements this contract in retained private state and reconciles sold stock. It is not evidence that a real vendor honors idempotency or stock semantics.

Operational monitoring flags acknowledgements pending over five minutes. Recover them by retrying the original order; do not delete the request, clear its fence or create a new upstream key to work around a timeout. A supplier that stays unavailable requires operator reconciliation against its durable order reference.
