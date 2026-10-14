import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
const room = {
  name: 'Measured bedroom',
  width: 6,
  depth: 5,
  height: 2.7,
  measurementsConfirmed: true,
  zones: [],
  openings: [],
};
async function register(client: APIRequestContext) {
  const email = `project-${randomUUID()}@example.test`;
  const response = await client.post('/api/auth/signup', {
    data: { email, password: randomBytes(24).toString('base64url'), displayName: 'Project tester' },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).user as { id: string; email: string };
}
async function organisation(client: APIRequestContext) {
  const response = await client.post('/api/organisations', {
    data: { name: `Retailer ${randomUUID().slice(0, 8)}`, currency: 'EUR' },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}
async function project(client: APIRequestContext, orgId: string, name = 'Customer bedroom') {
  const response = await client.post(`/api/organisations/${orgId}/projects`, {
    data: {
      name,
      customerId: null,
      budgetMinor: 500000,
      currency: 'EUR',
      style: 'Natural',
      roomType: 'bedroom',
      room,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}

test('authenticated project API isolates retailers, validates scenes and commits versions atomically', async ({
  playwright,
  baseURL,
}) => {
  const a = await playwright.request.newContext({ baseURL }),
    b = await playwright.request.newContext({ baseURL }),
    anonymous = await playwright.request.newContext({ baseURL });
  try {
    await register(a);
    await register(b);
    const orgA = await organisation(a),
      orgB = await organisation(b);
    const p = await project(a, orgA.id);
    const customer = await a.post(`/api/organisations/${orgA.id}/customers`, {
      data: { name: 'Private customer', email: 'customer@example.test', notes: 'Private showroom notes' },
    });
    expect(customer.status()).toBe(201);
    expect((await b.get(`/api/organisations/${orgA.id}/customers`)).status()).toBe(403);
    expect((await b.get(`/api/projects/${p.id}`)).status()).toBe(404);
    expect((await anonymous.get(`/api/projects/${p.id}/scene`)).status()).toBe(401);
    const cross = await b.post(`/api/organisations/${orgB.id}/projects`, {
      data: {
        name: 'Invalid cross tenant',
        customerId: (await customer.json()).id,
        budgetMinor: 0,
        currency: 'EUR',
        roomType: 'bedroom',
        style: '',
        room,
      },
    });
    expect(cross.status()).toBe(404);
    const before = (await (await a.get(`/api/projects/${p.id}/scene`)).json()).scene;
    expect(before.organisationId).toBe(orgA.id);
    expect(before.objects).toEqual([]);
    expect(
      (
        await a.post(`/api/projects/${p.id}/scene`, {
          data: {
            action: 'preview',
            expectedVersion: 0,
            organisationId: orgB.id,
            operation: { type: 'room', room },
          },
        })
      ).status(),
    ).toBe(400);
    const previews = [];
    for (let i = 0; i < 2; i++) {
      const response = await a.post(`/api/projects/${p.id}/scene`, {
        data: {
          action: 'preview',
          expectedVersion: 0,
          operation: { type: 'room', room: { ...room, width: 6.2 } },
        },
      });
      expect(response.status()).toBe(200);
      previews.push((await response.json()).proposal);
    }
    expect((await (await a.get(`/api/projects/${p.id}/scene`)).json()).scene).toEqual(before);
    const accepts = await Promise.all(
      previews.map((proposal) =>
        a.post(`/api/projects/${p.id}/scene`, {
          data: { action: 'accept', expectedVersion: 0, proposalId: proposal.id },
        }),
      ),
    );
    expect(accepts.map((r) => r.status()).sort()).toEqual([200, 409]);
    const after = (await (await a.get(`/api/projects/${p.id}/scene`)).json()).scene;
    expect(after.version).toBe(1);
    expect(after.room.width).toBe(6.2);
    const history = await (await a.get(`/api/projects/${p.id}/scene/history`)).json();
    expect(history.map((r: { version: number }) => r.version)).toEqual([1, 0]);
    const undo = await a.post(`/api/projects/${p.id}/scene`, {
      data: { action: 'undo', expectedVersion: 1 },
    });
    expect(undo.status()).toBe(200);
    expect((await undo.json()).scene.room.width).toBe(6);
  } finally {
    await a.dispose();
    await b.dispose();
    await anonymous.dispose();
  }
});

test('customer membership grants only explicit project access and cannot escalate its permissions', async ({
  playwright,
  baseURL,
}) => {
  const owner = await playwright.request.newContext({ baseURL }),
    customer = await playwright.request.newContext({ baseURL });
  try {
    await register(owner);
    const user = await register(customer);
    const org = await organisation(owner),
      one = await project(owner, org.id, 'Shared bedroom'),
      two = await project(owner, org.id, 'Private bedroom');
    const invitation = await owner.post(`/api/organisations/${org.id}/invitations`, {
      data: { email: user.email, role: 'customer' },
    });
    expect(invitation.status()).toBe(201);
    const token = new URL((await invitation.json()).url).searchParams.get('token');
    expect((await customer.post('/api/invitations/accept', { data: { token } })).status()).toBe(200);
    expect((await customer.get(`/api/projects/${one.id}`)).status()).toBe(404);
    expect(
      (
        await owner.post(`/api/projects/${one.id}/access`, { data: { userId: user.id, canEdit: false } })
      ).status(),
    ).toBe(200);
    expect((await customer.get(`/api/projects/${one.id}`)).status()).toBe(200);
    expect((await customer.get(`/api/projects/${two.id}`)).status()).toBe(404);
    expect((await customer.get(`/api/organisations/${org.id}/customers`)).status()).toBe(403);
    expect((await customer.get(`/api/organisations/${org.id}/members`)).status()).toBe(403);
    expect(
      (
        await customer.post(`/api/projects/${one.id}/access`, { data: { userId: user.id, canEdit: true } })
      ).status(),
    ).toBe(403);
    expect(
      (
        await customer.post(`/api/projects/${one.id}/scene`, {
          data: {
            action: 'preview',
            expectedVersion: 0,
            operation: { type: 'room', room: { ...room, width: 6.2 } },
          },
        })
      ).status(),
    ).toBe(403);
    const list = await (await customer.get(`/api/organisations/${org.id}/projects`)).json();
    expect(list.map((p: { id: string }) => p.id)).toEqual([one.id]);
    expect(
      (
        await owner.post(`/api/projects/${one.id}/access`, { data: { userId: user.id, canEdit: true } })
      ).status(),
    ).toBe(200);
    const editable = await customer.post(`/api/projects/${one.id}/scene`, {
      data: {
        action: 'preview',
        expectedVersion: 0,
        operation: { type: 'room', room: { ...room, width: 6.2 } },
      },
    });
    expect(editable.status()).toBe(200);
    expect((await owner.delete(`/api/projects/${one.id}/access?userId=${user.id}`)).status()).toBe(200);
    expect((await customer.get(`/api/projects/${one.id}/scene`)).status()).toBe(404);
  } finally {
    await owner.dispose();
    await customer.dispose();
  }
});
