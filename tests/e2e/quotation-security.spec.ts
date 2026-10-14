import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import type { CatalogueProduct, ProductInput } from '@roomsell/catalogue';
import type { SceneObject } from '@roomsell/scene-core';
import type { IssuedQuotation } from '../../apps/web/lib/quotation-schemas';

const policy = {
  version: 1,
  currency: 'EUR',
  taxMode: 'exclusive',
  taxRateBps: 2000,
  rounding: 'invoice',
  discountBps: 1000,
  deliveryMinor: 500,
  installationMinor: 0,
  feesTaxable: true,
};
async function signup(client: APIRequestContext) {
  const result = await client.post('/api/auth/signup', {
    data: {
      email: `quotation-${randomUUID()}@example.test`,
      password: randomBytes(24).toString('base64url'),
      displayName: 'Quotation acceptance',
    },
  });
  expect(result.status()).toBe(201);
  return (await result.json()).user as { id: string; email: string };
}
async function org(client: APIRequestContext) {
  const result = await client.post('/api/organisations', {
    data: { name: 'Quotation acceptance retailer', currency: 'EUR' },
  });
  expect(result.status()).toBe(201);
  return (await result.json()).id as string;
}
async function invite(
  owner: APIRequestContext,
  client: APIRequestContext,
  orgId: string,
  email: string,
  role: string,
) {
  const invitation = await owner.post(`/api/organisations/${orgId}/invitations`, { data: { email, role } });
  expect(invitation.status()).toBe(201);
  const token = new URL((await invitation.json()).url).searchParams.get('token');
  expect((await client.post('/api/invitations/accept', { data: { token } })).status()).toBe(200);
}
function input(product?: CatalogueProduct, priceMinor = 10000): ProductInput {
  return {
    sku: product?.sku || `Q-${randomUUID().slice(0, 8)}`,
    name: 'Exact quoted bedside',
    category: 'bedside',
    currency: 'EUR',
    priceMinor,
    dimensions: { width: 0.5, depth: 0.5, height: 1 },
    color: '#112233',
    material: 'Oak',
    active: true,
    availability: 'in_stock',
    stockQuantity: 3,
    leadTimeDays: 7,
    variants: product
      ? product.variants.map((variant) => ({
          id: variant.id,
          sku: variant.sku,
          name: variant.name,
          color: variant.color,
          material: variant.material,
          dimensions: variant.dimensions,
          priceMinor,
          active: true,
          availability: 'in_stock',
          stockQuantity: 3,
          leadTimeDays: 7,
        }))
      : [],
  };
}
async function fixture(owner: APIRequestContext, orgId: string) {
  const productResponse = await owner.post(`/api/organisations/${orgId}/catalogue`, { data: input() });
  expect(productResponse.status()).toBe(201);
  const product = (await productResponse.json()) as CatalogueProduct;
  const projectResponse = await owner.post(`/api/organisations/${orgId}/projects`, {
    data: {
      name: 'Quoted measured project',
      budgetMinor: 50000,
      currency: 'EUR',
      style: '',
      roomType: 'bedroom',
      room: {
        name: 'Measured room',
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
  const projectId = (await projectResponse.json()).id as string;
  const variant = product.variants[0];
  const object: SceneObject = {
    id: randomUUID(),
    variantId: variant.id,
    sku: variant.sku,
    name: product.name,
    category: product.category,
    dimensions: variant.dimensions,
    color: variant.color,
    solid: true,
    transform: { x: 3, y: 0, z: 2.5, rotation: 0 },
    locks: { position: false, rotation: false, product: false },
  };
  const proposalResponse = await owner.post(`/api/projects/${projectId}/scene`, {
    data: { action: 'preview', expectedVersion: 0, operation: { type: 'add-object', object } },
  });
  expect(proposalResponse.status()).toBe(200);
  const proposal = (await proposalResponse.json()).proposal;
  expect(
    (
      await owner.post(`/api/projects/${projectId}/scene`, {
        data: { action: 'accept', expectedVersion: 0, proposalId: proposal.id },
      })
    ).status(),
  ).toBe(200);
  return { product, projectId };
}
async function review(client: APIRequestContext, projectId: string) {
  const result = await client.post(`/api/projects/${projectId}/quotations/preview`, {
    data: { expectedSceneVersion: 1, expectedPolicyRevision: 1 },
  });
  expect(result.status()).toBe(200);
  return (await result.json()) as { sourceFingerprint: string };
}

test('quotation issuance binds reviewed prices and returns the original immutable result on retry', async ({
  playwright,
  baseURL,
}) => {
  const owner = await playwright.request.newContext({ baseURL });
  try {
    await signup(owner);
    const orgId = await org(owner);
    const { product, projectId } = await fixture(owner, orgId);
    const policyPath = `/api/organisations/${orgId}/pricing`;
    expect(await (await owner.get(policyPath)).json()).toBeNull();
    expect((await owner.put(policyPath, { data: { expectedRevision: 0, policy } })).status()).toBe(200);
    const initialReview = await review(owner, projectId);
    const quotesPath = `/api/projects/${projectId}/quotations`;
    const request = {
      expectedSceneVersion: 1,
      expectedPolicyRevision: 1,
      idempotencyKey: randomUUID(),
      expectedSourceFingerprint: initialReview.sourceFingerprint,
    };
    expect((await owner.post(quotesPath, { data: { ...request, grandTotalMinor: 1 } })).status()).toBe(400);
    expect(
      (
        await owner.patch(`/api/organisations/${orgId}/catalogue/${product.id}`, {
          data: input(product, 20000),
        })
      ).status(),
    ).toBe(200);
    expect((await owner.post(quotesPath, { data: request })).status()).toBe(409);
    expect(await (await owner.get(quotesPath)).json()).toEqual([]);
    const currentReview = await review(owner, projectId);
    const issuance = { ...request, expectedSourceFingerprint: currentReview.sourceFingerprint };
    const [first, second] = await Promise.all([
      owner.post(quotesPath, { data: issuance }),
      owner.post(quotesPath, { data: issuance }),
    ]);
    expect(first.status()).toBe(201);
    expect(second.status()).toBe(201);
    const quote = (await first.json()) as IssuedQuotation;
    expect((await second.json()).id).toBe(quote.id);
    expect(quote.snapshot.calculation.totals.grandTotalMinor).toBe(22200);
    expect(
      (
        await owner.post(quotesPath, { data: { ...issuance, expectedSourceFingerprint: 'a'.repeat(64) } })
      ).status(),
    ).toBe(409);
    expect(
      (
        await owner.patch(`/api/organisations/${orgId}/catalogue/${product.id}`, {
          data: input(product, 30000),
        })
      ).status(),
    ).toBe(200);
    const retried = await owner.post(quotesPath, { data: issuance });
    expect(retried.status()).toBe(201);
    expect((await retried.json()).snapshot).toEqual(quote.snapshot);
    expect(
      (await owner.post(quotesPath, { data: { ...issuance, idempotencyKey: randomUUID() } })).status(),
    ).toBe(409);
    expect(await (await owner.get(`${quotesPath}/${quote.id}`)).json()).toEqual(quote);
    const pdf = await owner.get(`${quotesPath}/${quote.id}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect(pdf.headers()['cache-control']).toBe('private, no-store');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    expect(await (await owner.get(quotesPath)).json()).toHaveLength(1);
  } finally {
    await owner.dispose();
  }
});

test('issued quotations and PDF downloads respect customer assignment, retailer roles and tenant isolation', async ({
  playwright,
  baseURL,
}) => {
  const owner = await playwright.request.newContext({ baseURL });
  const foreign = await playwright.request.newContext({ baseURL });
  const salesperson = await playwright.request.newContext({ baseURL });
  const customer = await playwright.request.newContext({ baseURL });
  const anonymous = await playwright.request.newContext({ baseURL });
  try {
    await signup(owner);
    await signup(foreign);
    const salesUser = await signup(salesperson),
      customerUser = await signup(customer);
    const orgId = await org(owner);
    await org(foreign);
    await invite(owner, salesperson, orgId, salesUser.email, 'salesperson');
    await invite(owner, customer, orgId, customerUser.email, 'customer');
    const { projectId } = await fixture(owner, orgId);
    const { projectId: privateProject } = await fixture(owner, orgId);
    const policyPath = `/api/organisations/${orgId}/pricing`;
    expect((await owner.put(policyPath, { data: { expectedRevision: 0, policy } })).status()).toBe(200);
    const preview = await review(owner, projectId);
    const issuance = {
      expectedSceneVersion: 1,
      expectedPolicyRevision: 1,
      idempotencyKey: randomUUID(),
      expectedSourceFingerprint: preview.sourceFingerprint,
    };
    const quotesPath = `/api/projects/${projectId}/quotations`;
    const issued = await owner.post(quotesPath, { data: issuance });
    expect(issued.status()).toBe(201);
    const quote = (await issued.json()) as IssuedQuotation;
    expect(
      (
        await owner.post(`/api/projects/${projectId}/access`, {
          data: { userId: customerUser.id, canEdit: false },
        })
      ).status(),
    ).toBe(200);
    expect((await customer.get(`${quotesPath}/${quote.id}`)).status()).toBe(200);
    expect((await customer.get(`${quotesPath}/${quote.id}/pdf`)).status()).toBe(200);
    expect((await customer.get(`/api/projects/${privateProject}/quotations`)).status()).toBe(404);
    expect((await customer.get(policyPath)).status()).toBe(403);
    expect(
      (
        await customer.post(`${quotesPath}/preview`, {
          data: { expectedSceneVersion: 1, expectedPolicyRevision: 1 },
        })
      ).status(),
    ).toBe(403);
    expect((await customer.post(quotesPath, { data: issuance })).status()).toBe(403);
    expect((await salesperson.put(policyPath, { data: { expectedRevision: 1, policy } })).status()).toBe(403);
    expect((await salesperson.post(quotesPath, { data: issuance })).status()).toBe(409);
    expect((await foreign.get(`${quotesPath}/${quote.id}/pdf`)).status()).toBe(404);
    expect((await anonymous.get(`${quotesPath}/${quote.id}/pdf`)).status()).toBe(401);
    expect((await owner.delete(`/api/projects/${projectId}/access?userId=${customerUser.id}`)).status()).toBe(
      200,
    );
    expect((await customer.get(`${quotesPath}/${quote.id}/pdf`)).status()).toBe(404);
  } finally {
    await Promise.all([
      owner.dispose(),
      foreign.dispose(),
      salesperson.dispose(),
      customer.dispose(),
      anonymous.dispose(),
    ]);
  }
});
