import { expect, test } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { calibratePhotoInBrowser, clickPhotoFloor, confirmPhotoDesign } from './photo-helpers';

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
});
test.setTimeout(180_000);

test('retailer reviews exact pricing, issues an immutable quotation and downloads its PDF', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const signup = await page.request.post('/api/auth/signup', {
    data: {
      email: `quote-${randomUUID()}@example.test`,
      password: randomBytes(24).toString('base64url'),
      displayName: 'Quotation acceptance',
    },
  });
  expect(signup.status()).toBe(201);
  const orgResponse = await page.request.post('/api/organisations', {
    data: { name: 'Quotation retailer', currency: 'EUR' },
  });
  expect(orgResponse.status()).toBe(201);
  const org = await orgResponse.json();
  const productResponse = await page.request.post(`/api/organisations/${org.id}/catalogue`, {
    data: {
      sku: `Q-${randomUUID().slice(0, 8)}`,
      name: 'Quoted measured bed',
      category: 'bed',
      currency: 'EUR',
      priceMinor: 10000,
      dimensions: { width: 1.6, depth: 2, height: 1 },
      color: '#aabbcc',
      material: 'Oak',
      active: true,
      availability: 'in_stock',
      stockQuantity: 5,
      leadTimeDays: 7,
      variants: [],
    },
  });
  expect(productResponse.status()).toBe(201);
  const product = await productResponse.json();
  const projectResponse = await page.request.post(`/api/organisations/${org.id}/projects`, {
    data: {
      name: 'Quotation bedroom',
      customerId: null,
      budgetMinor: 100000,
      currency: 'EUR',
      style: '',
      roomType: 'bedroom',
      room: {
        name: 'Measured bedroom',
        width: 6,
        depth: 5,
        height: 2.7,
        measurementsConfirmed: true,
        zones: [],
        openings: [],
      },
    },
  });
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json();
  await page.goto(`/workspace?organisation=${org.id}&panel=pricing`);
  await page.getByLabel('Listed prices include tax', { exact: true }).selectOption('exclusive');
  await page.getByLabel('Tax rate (basis points)', { exact: true }).fill('2000');
  await page.getByLabel('Quotation rounding', { exact: true }).selectOption('per_line');
  await page.getByLabel('Furniture discount (basis points)', { exact: true }).fill('1000');
  await page.getByLabel('Delivery fee (minor currency units)', { exact: true }).fill('500');
  await page.getByLabel('Installation fee (minor currency units)', { exact: true }).fill('0');
  await page.getByLabel('Fees subject to tax', { exact: true }).selectOption('true');
  await page.getByRole('button', { name: 'Save pricing rules', exact: true }).click();
  await expect(page.getByText('Pricing rules saved · revision 1', { exact: true })).toBeVisible();
  await page.goto(`/projects/${project.id}`);
  const { calibration } = await calibratePhotoInBrowser(page, project.id);
  await page.getByRole('button', { name: 'Place Quoted measured bed', exact: true }).click();
  await clickPhotoFloor(page, { x: 3, y: 0, z: 2.5 }, calibration);
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview', exact: true })).not.toBeVisible();
  await confirmPhotoDesign(page);
  await page.getByRole('button', { name: 'Review quotation', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Quotation preview', exact: true });
  await expect(preview).toContainText('€114.00');
  await expect(preview).toContainText('€19.00');
  await page.getByRole('button', { name: 'Issue reviewed quotation', exact: true }).click();
  await expect(preview).not.toBeVisible();
  const details = page.getByRole('region', { name: 'Issued quotation details', exact: true });
  await expect(details).toContainText('€114.00');
  const quotes = await (await page.request.get(`/api/projects/${project.id}/quotations`)).json();
  expect(quotes).toHaveLength(1);
  expect(quotes[0].snapshot.calculation.totals.grandTotalMinor).toBe(11400);
  const pdf = await page.request.get(`/api/projects/${project.id}/quotations/${quotes[0].id}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  const updated = await page.request.patch(`/api/organisations/${org.id}/catalogue/${product.id}`, {
    data: {
      sku: product.sku,
      name: product.name,
      category: product.category,
      currency: product.currency,
      priceMinor: 20000,
      dimensions: product.dimensions,
      color: product.color,
      material: product.material,
      active: true,
      availability: 'in_stock',
      stockQuantity: 5,
      leadTimeDays: 7,
      variants: product.variants.map(
        (variant: {
          id: string;
          sku: string;
          name: string;
          dimensions: unknown;
          color: string;
          material: string;
        }) => ({
          id: variant.id,
          sku: variant.sku,
          name: variant.name,
          dimensions: variant.dimensions,
          color: variant.color,
          material: variant.material,
          priceMinor: 20000,
          availability: 'in_stock',
          stockQuantity: 5,
          leadTimeDays: 7,
          active: true,
        }),
      ),
    },
  });
  expect(updated.status()).toBe(200);
  await page.reload();
  await page.getByRole('button', { name: 'View quotation details', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Issued quotation details', exact: true })).toContainText(
    '€114.00',
  );
  expect(errors).toEqual([]);
});
