import { expect, test } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { localTestPreflight } from '../../scripts/test-preflight.mjs';

test('retailer maps real inventory variants, clears credentials and rejects an unsafe sync without catalogue writes', async ({
  page,
}) => {
  const status = await localTestPreflight();
  const database = new Client({ connectionString: status.DB_URL });
  await database.connect();
  let orgId: string | null = null;
  let userId: string | null = null;
  let connectionId: string | null = null;
  const safeEndpoint = 'https://1.1.1.1/inventory';
  const unsafeEndpoint = 'https://127.0.0.1/inventory';
  const providerToken = randomBytes(24).toString('base64url');
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    const signup = await page.request.post('/api/auth/signup', {
      data: {
        email: `inventory-ui-${randomUUID()}@example.test`,
        password: randomBytes(24).toString('base64url'),
        displayName: 'Inventory acceptance retailer',
      },
    });
    expect(signup.status()).toBe(201);
    userId = (await signup.json()).user.id;
    const organisation = await page.request.post('/api/organisations', {
      data: {
        name: `Inventory acceptance ${randomUUID().slice(0, 8)}`,
        currency: 'EUR',
      },
    });
    expect(organisation.status()).toBe(201);
    orgId = (await organisation.json()).id;
    const productResponse = await page.request.post(`/api/organisations/${orgId}/catalogue`, {
      data: {
        sku: `INVENTORY-BED-${randomUUID().slice(0, 8)}`,
        name: 'Inventory acceptance bed',
        category: 'bed',
        currency: 'EUR',
        priceMinor: 79_995,
        dimensions: { width: 1.6, depth: 2, height: 1 },
        color: '#765432',
        material: 'Oak',
        active: true,
        availability: 'in_stock',
        stockQuantity: 4,
        leadTimeDays: 7,
        variants: [],
      },
    });
    expect(productResponse.status()).toBe(201);
    const product = await productResponse.json();
    const variant = product.variants[0];
    const inventoryPath = `/api/organisations/${orgId}/inventory`;
    const before = await page.request.get(`/api/organisations/${orgId}/catalogue/${product.id}`);
    expect(before.status()).toBe(200);
    const unchangedProduct = await before.json();

    await page.goto(`/workspace?organisation=${orgId}&panel=inventory`);
    await expect(page.getByRole('heading', { name: 'Inventory integrations', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New inventory connection', exact: true }).click();
    await page.getByLabel('Connection name', { exact: true }).fill('Acceptance inventory endpoint');
    await page.getByLabel('Inventory endpoint', { exact: true }).fill(unsafeEndpoint);
    const token = page.getByLabel('Inventory access token', { exact: true });
    await token.fill(providerToken);
    const rejectedCreate = page.waitForResponse(
      (response) => response.url().endsWith(inventoryPath) && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save inventory connection', exact: true }).click();
    expect((await rejectedCreate).status()).toBe(422);
    await expect(token).toHaveValue('');
    await expect(page.locator('.account-error[role="alert"]')).toContainText('public HTTPS');
    expect((await (await page.request.get(inventoryPath)).json()).connections).toEqual([]);

    // A literal public address is validated without DNS or an external HTTP request at configuration time.
    await page.getByLabel('Inventory endpoint', { exact: true }).fill(safeEndpoint);
    await token.fill(providerToken);
    await page.getByRole('button', { name: 'Save inventory connection', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Acceptance inventory endpoint', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('form', { name: 'Inventory connection form', exact: true })).toHaveCount(0);
    const savedResponse = await page.request.get(inventoryPath);
    expect(savedResponse.status()).toBe(200);
    const saved = await savedResponse.json();
    expect(saved.connections).toHaveLength(1);
    expect(saved.connections[0]).toMatchObject({
      endpoint: safeEndpoint,
      credentialConfigured: true,
      revision: 1,
    });
    expect(JSON.stringify(saved)).not.toContain(providerToken);
    expect(JSON.stringify(saved)).not.toContain('token_envelope');
    connectionId = saved.connections[0].id;

    await page.getByRole('button', { name: 'Edit connection', exact: true }).click();
    await expect(page.getByLabel('Replacement access token (optional)', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'Cancel connection edit', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Synchronise inventory now', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Edit inventory mappings', exact: true }).click();
    await page.getByRole('button', { name: 'Add inventory mapping', exact: true }).click();
    await page.getByLabel('Mapping 1 external product ID', { exact: true }).fill('source-bed');
    await page.getByLabel('Mapping 1 external variant ID', { exact: true }).fill('source-oak');
    await page.getByLabel('Mapping 1 catalogue product', { exact: true }).selectOption(product.id);
    await page.getByLabel('Mapping 1 catalogue variant', { exact: true }).selectOption(variant.id);
    await expect(
      page.getByRole('button', { name: 'Replace inventory mappings', exact: true }),
    ).toBeDisabled();
    await page
      .getByRole('checkbox', {
        name: 'I confirm replacement of all saved mappings for this connection.',
        exact: true,
      })
      .check();
    await page.getByRole('button', { name: 'Replace inventory mappings', exact: true }).click();
    await expect(
      page.getByText('Inventory mappings replaced. You can now synchronise a matching source snapshot.', {
        exact: true,
      }),
    ).toBeVisible();
    const mapped = await (await page.request.get(inventoryPath)).json();
    expect(mapped.connections[0].revision).toBe(2);
    expect(mapped.mappings).toEqual([
      {
        connectionId,
        externalProductId: 'source-bed',
        externalVariantId: 'source-oak',
        productId: product.id,
        variantId: variant.id,
      },
    ]);
    await page.reload();
    await expect(page.getByText('source-bed / source-oak', { exact: true })).toBeVisible();

    // Isolated local-only database fixture models an unsafe stored endpoint (for
    // example, legacy configuration). It is scoped to this newly created UUID.
    // No production backdoor or network injection is added: the actual sync API
    // revalidates the address and rejects it before opening any connection.
    const changed = await database.query(
      'update public.inventory_connections set endpoint = $1 where id = $2 and organisation_id = $3',
      [unsafeEndpoint, connectionId, orgId],
    );
    expect(changed.rowCount).toBe(1);
    const rejectedSync = page.waitForResponse(
      (response) =>
        response.url().endsWith(`${inventoryPath}/${connectionId}/sync`) &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Synchronise inventory now', exact: true }).click();
    expect((await rejectedSync).status()).toBe(422);
    await expect(page.locator('.account-error[role="alert"]')).toContainText('public HTTPS');
    await expect(
      page.getByRole('region', { name: 'Inventory synchronisation history', exact: true }),
    ).toContainText('Failed');
    const after = await (await page.request.get(inventoryPath)).json();
    expect(after.runs).toHaveLength(1);
    expect(after.runs[0]).toMatchObject({
      connectionId,
      status: 'failed',
      itemCount: 0,
      errorCode: 'endpoint_rejected',
    });
    expect(after.connections[0].lastSyncedAt).toBeNull();
    expect(JSON.stringify(after)).not.toContain(providerToken);
    expect(
      await (await page.request.get(`/api/organisations/${orgId}/catalogue/${product.id}`)).json(),
    ).toEqual(unchangedProduct);
    expect(pageErrors).toEqual([]);
  } finally {
    if (connectionId && orgId)
      await database.query(
        'update public.inventory_connections set endpoint = $1 where id = $2 and organisation_id = $3',
        [safeEndpoint, connectionId, orgId],
      );
    if (orgId) await database.query('delete from public.organisations where id = $1', [orgId]);
    if (userId) await database.query('delete from auth.users where id = $1', [userId]);
    await database.end();
  }
});
