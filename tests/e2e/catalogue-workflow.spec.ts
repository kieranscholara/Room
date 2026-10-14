import { expect, test, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { CSV_HEADERS } from '@roomsell/catalogue';

test.setTimeout(180_000);
async function retailer(page: Page) {
  const signup = await page.request.post('/api/auth/signup', {
    data: {
      email: `catalogue-${randomUUID()}@example.test`,
      password: randomBytes(24).toString('base64url'),
      displayName: 'Catalogue acceptance',
    },
  });
  expect(signup.status()).toBe(201);
  const response = await page.request.post('/api/organisations', {
    data: { name: `Retailer ${randomUUID().slice(0, 8)}`, currency: 'EUR' },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}
const measuredRoom = {
  name: 'Measured customer bedroom',
  width: 6,
  depth: 5,
  height: 2.7,
  measurementsConfirmed: true,
  zones: [],
  openings: [],
};
async function scene(page: Page, projectId: string) {
  const response = await page.request.get(`/api/projects/${projectId}/scene`);
  expect(response.status()).toBe(200);
  return (await response.json()).scene;
}

test('retailer enters real records, uploads a photograph and accepts catalogue furniture with authoritative totals', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const org = await retailer(page);
  await page.goto(`/workspace?organisation=${org.id}&panel=customers`);
  await page.getByLabel('Customer name', { exact: true }).fill('Measured room customer');
  await page.getByLabel('Customer email', { exact: true }).fill('measured-customer@example.test');
  await page.getByLabel('Customer phone', { exact: true }).fill('+356 20000000');
  await page
    .getByLabel('Customer notes', { exact: true })
    .fill('Measurements taken in showroom consultation.');
  await page.getByRole('button', { name: 'Create customer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Measured room customer', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Measured room customer', exact: true }).click();
  await page.getByLabel('Customer notes', { exact: true }).fill('Customer approved the measured dimensions.');
  await page.getByRole('button', { name: 'Save customer', exact: true }).click();
  await expect(page.getByText('Customer approved the measured dimensions.', { exact: true })).toBeVisible();
  const customer = (await (await page.request.get(`/api/organisations/${org.id}/customers`)).json())[0];

  await page.getByRole('button', { name: 'Catalogue', exact: true }).click();
  await page.getByRole('button', { name: 'New product', exact: true }).click();
  const sku = `ACCEPT-BED-${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Product SKU', { exact: true }).fill(sku);
  await page.getByLabel('Product name', { exact: true }).fill('Measured showroom bed');
  await page.getByLabel('Product price', { exact: true }).fill('599.95');
  await page.getByLabel('Product width (m)', { exact: true }).fill('1.6');
  await page.getByLabel('Product depth (m)', { exact: true }).fill('2');
  await page.getByLabel('Product height (m)', { exact: true }).fill('1');
  await page.getByLabel('Product material', { exact: true }).fill('Oak');
  await page.getByLabel('Product availability', { exact: true }).selectOption('in_stock');
  await page.getByLabel('Product stock quantity', { exact: true }).fill('3');
  await page.getByLabel('Product lead time (days)', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Measured showroom bed', exact: true })).toBeVisible();
  const products = await (await page.request.get(`/api/organisations/${org.id}/catalogue`)).json();
  expect(products).toHaveLength(1);
  const product = products[0];
  expect(product.priceMinor).toBe(59995);
  expect(product.variants).toHaveLength(1);

  await page.getByRole('button', { name: 'Add assets', exact: true }).click();
  const photograph = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#aa8855' } })
    .png()
    .toBuffer();
  await page
    .getByLabel('Product asset file', { exact: true })
    .setInputFiles({ name: 'showroom.png', mimeType: 'image/png', buffer: photograph });
  await page.getByRole('button', { name: 'Validate and upload asset', exact: true }).click();
  await expect(page.getByText('Asset validated and uploaded.', { exact: true })).toBeVisible();
  const image = page.getByRole('img', { name: 'Measured showroom bed', exact: true });
  await expect(image).toBeVisible();
  await expect
    .poll(async () => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBe(8);

  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Accepted customer bedroom');
  await page.getByLabel('Project customer', { exact: true }).selectOption(customer.id);
  await page.getByLabel('Project budget', { exact: true }).fill('1000');
  await page.getByLabel('Project style', { exact: true }).fill('Natural');
  await page.getByLabel('Room name', { exact: true }).fill('Measured customer bedroom');
  await page.getByLabel('Measured room width (m)', { exact: true }).fill('6');
  await page.getByLabel('Measured room depth (m)', { exact: true }).fill('5');
  await page.getByLabel('Measured room height (m)', { exact: true }).fill('2.7');
  const confirmation = page.getByRole('checkbox', {
    name: 'I confirm these room dimensions were measured.',
    exact: true,
  });
  await expect(confirmation).not.toBeChecked();
  await confirmation.check();
  await page.getByRole('button', { name: 'Create measured project', exact: true }).click();
  await page.getByRole('link', { name: 'Open Accepted customer bedroom', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Products and budget', exact: true })).toBeVisible();
  const projectId = new URL(page.url()).pathname.split('/').at(-1)!;
  expect((await scene(page, projectId)).objects).toEqual([]);
  await page.getByLabel('Furniture variant', { exact: true }).selectOption(product.variants[0].id);
  await page.getByRole('button', { name: 'Preview catalogue placement', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview', exact: true })).toBeVisible();
  expect((await scene(page, projectId)).objects).toEqual([]);
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview', exact: true })).not.toBeVisible();
  await expect(page.getByLabel('Project budget totals', { exact: true })).toContainText('€599.95');
  await expect(page.getByLabel('Project budget totals', { exact: true })).toContainText('€400.05');
  await page.screenshot({ path: 'test-results/catalogue-project.png', fullPage: true });
  const accepted = await scene(page, projectId);
  expect(accepted.version).toBe(1);
  expect(accepted.objects).toHaveLength(1);
  expect(accepted.objects[0]).toMatchObject({
    sku,
    variantId: product.variants[0].id,
    dimensions: { width: 1.6, depth: 2, height: 1 },
  });
  await page.reload();
  await expect(page.getByLabel('Project budget totals', { exact: true })).toContainText('€599.95');
  await page.getByRole('button', { name: 'Select Measured showroom bed', exact: true }).click();
  await page.getByRole('button', { name: 'Lock product', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unlock product', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Preview removal of Measured showroom bed', exact: true }),
  ).toBeDisabled();
  expect((await scene(page, projectId)).objects[0].locks.product).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('CSV imports show row errors atomically and joined customers receive only their shared project', async ({
  page,
  browser,
  baseURL,
}) => {
  const org = await retailer(page);
  await page.goto(`/workspace?organisation=${org.id}&panel=catalogue`);
  await page.getByText('Import catalogue CSV', { exact: true }).click();
  const productSku = `CSV-${randomUUID().slice(0, 8)}`;
  const makeRow = (variantSku: string, price: string) =>
    [
      productSku,
      variantSku,
      'Imported measured bed',
      variantSku,
      'bed',
      price,
      'EUR',
      '1.6',
      '2',
      '1',
      '#aabbcc',
      'Oak',
      'in_stock',
      '4',
      '7',
      'true',
    ].join(',');
  const bad = [CSV_HEADERS.join(','), makeRow('CSV-INVALID', '-1')].join('\r\n');
  await page
    .getByLabel('Catalogue CSV file', { exact: true })
    .setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(bad) });
  await page.getByRole('button', { name: 'Validate and import CSV', exact: true }).click();
  await expect(page.locator('.business-import-result').first()).toContainText('Row 2');
  expect(await (await page.request.get(`/api/organisations/${org.id}/catalogue`)).json()).toEqual([]);
  const valid = [
    CSV_HEADERS.join(','),
    makeRow(`${productSku}-OAK`, '50000'),
    makeRow(`${productSku}-DARK`, '70000'),
  ].join('\r\n');
  await page
    .getByLabel('Catalogue CSV file', { exact: true })
    .setInputFiles({ name: 'valid.csv', mimeType: 'text/csv', buffer: Buffer.from(valid) });
  await page.getByRole('button', { name: 'Validate and import CSV', exact: true }).click();
  await expect(page.getByText('Catalogue import completed.', { exact: true })).toBeVisible();
  const catalogue = await (await page.request.get(`/api/organisations/${org.id}/catalogue`)).json();
  expect(catalogue).toHaveLength(1);
  expect(catalogue[0].variants).toHaveLength(2);
  const duplicate = await page.request.post(`/api/organisations/${org.id}/catalogue/import`, {
    multipart: { file: { name: 'duplicate.csv', mimeType: 'text/csv', buffer: Buffer.from(valid) } },
  });
  expect(duplicate.status()).toBe(422);
  expect(await (await page.request.get(`/api/organisations/${org.id}/catalogue`)).json()).toHaveLength(1);

  const createProject = await page.request.post(`/api/organisations/${org.id}/projects`, {
    data: {
      name: 'Shared measured project',
      customerId: null,
      budgetMinor: 100000,
      currency: 'EUR',
      roomType: 'bedroom',
      style: '',
      room: measuredRoom,
    },
  });
  expect(createProject.status()).toBe(201);
  const project = await createProject.json();
  const customerContext = await browser.newContext({ baseURL });
  try {
    const signup = await customerContext.request.post('/api/auth/signup', {
      data: {
        email: `shared-${randomUUID()}@example.test`,
        password: randomBytes(24).toString('base64url'),
        displayName: 'Shared customer',
      },
    });
    expect(signup.status()).toBe(201);
    const customer = (await signup.json()).user;
    const invite = await page.request.post(`/api/organisations/${org.id}/invitations`, {
      data: { email: customer.email, role: 'customer' },
    });
    expect(invite.status()).toBe(201);
    const token = new URL((await invite.json()).url).searchParams.get('token');
    expect(
      (await customerContext.request.post('/api/invitations/accept', { data: { token } })).status(),
    ).toBe(200);
    await page.goto(`/projects/${project.id}`);
    await page.getByLabel('Customer account', { exact: true }).selectOption(customer.id);
    await expect(
      page.getByRole('checkbox', { name: 'Allow this customer to edit their design', exact: true }),
    ).not.toBeChecked();
    await page.getByRole('button', { name: 'Save customer access', exact: true }).click();
    await expect(page.getByText(`${customer.email} · View only`, { exact: true })).toBeVisible();
    const customerPage = await customerContext.newPage();
    await customerPage.goto(`/workspace?organisation=${org.id}&panel=projects`);
    await expect(customerPage.getByRole('button', { name: 'Catalogue', exact: true })).toHaveCount(0);
    await expect(customerPage.getByRole('button', { name: 'Customers', exact: true })).toHaveCount(0);
    await customerPage.getByRole('link', { name: 'Open project', exact: true }).click();
    await expect(
      customerPage.getByText('View-only project. You can inspect the plan and its saved revisions.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(customerPage.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await expect(
      customerPage.getByRole('button', { name: 'Preview catalogue placement', exact: true }),
    ).toHaveCount(0);
    await expect(customerPage.getByLabel('Project budget totals', { exact: true })).toContainText(
      '€1,000.00',
    );
    await page.getByRole('button', { name: 'Remove customer access', exact: true }).click();
    await expect(page.getByText('Customer access removed.', { exact: true })).toBeVisible();
    await customerPage.reload();
    await expect(customerPage.locator('.account-loading [role="alert"]')).toContainText('Project not found.');
  } finally {
    await customerContext.close();
  }
});
