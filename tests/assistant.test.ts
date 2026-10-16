import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDemoScene } from '@roomsell/scene-core';
import type { PricingPolicy } from '@roomsell/pricing';
import {
  assistantRequestSchema,
  assistantIntentSchema,
  assertAssistantPhotoSources,
  validateAssistantIntent,
  testAssistantIntent,
  type AssistantCandidate,
  type AssistantPhotoContext,
} from '../apps/web/lib/assistant-contract';
vi.mock('server-only', () => ({}));
import { openAiDesign } from '../apps/web/lib/ai-provider';
const policy: PricingPolicy = {
  version: 1,
  currency: 'EUR',
  taxMode: 'exclusive',
  taxRateBps: 2000,
  rounding: 'invoice',
  discountBps: 0,
  deliveryMinor: 500,
  installationMinor: 0,
  feesTaxable: true,
};
function fixture() {
  const scene = createDemoScene();
  scene.objects = scene.objects.slice(0, 1);
  const object = scene.objects[0];
  object.variantId = randomUUID();
  object.locks = { position: false, rotation: false, product: true };
  const candidate: AssistantCandidate = {
    variantId: object.variantId,
    productId: randomUUID(),
    sku: object.sku,
    name: object.name,
    variantName: 'Standard',
    category: object.category,
    currency: 'EUR',
    priceMinor: 10000,
    dimensions: object.dimensions,
    color: object.color,
    availability: 'in_stock',
    stockQuantity: 5,
  };
  return { scene, object, candidate, candidates: [candidate] };
}
const intent = () => ({ summary: 'Checked catalogue advice', recommendations: [], layout: null });
function photoFixture(): AssistantPhotoContext {
  return {
    referenceId: randomUUID(),
    revision: 4,
    backgroundReferenceId: null,
    regions: [
      {
        id: randomUUID(),
        label: 'Client chest',
        bounds: { x: 0.2, y: 0.3, width: 0.2, height: 0.4 },
        disposition: 'keep',
        foreground: false,
      },
    ],
  };
}
afterEach(() => vi.unstubAllEnvs());
describe('bounded catalogue-grounded assistant intentions', () => {
  it('rejects injected products, dimensions and lock changes', () => {
    expect(assistantIntentSchema.safeParse({ ...intent(), objects: [] }).success).toBe(false);
    expect(
      assistantIntentSchema.safeParse({
        ...intent(),
        layout: { objectId: 'a', x: 1, z: 1, rotation: 0, locks: { position: false } },
      }).success,
    ).toBe(false);
  });
  it('rejects duplicate recommendations and unbounded photo requests', () => {
    const id = randomUUID();
    expect(
      assistantIntentSchema.safeParse({
        ...intent(),
        recommendations: [
          { variantId: id, quantity: 1 },
          { variantId: id, quantity: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      assistantRequestSchema.safeParse({
        brief: 'Test room',
        expectedSceneVersion: 0,
        provider: 'test',
        referenceIds: [id, randomUUID(), randomUUID()],
        idempotencyKey: randomUUID(),
      }).success,
    ).toBe(false);
  });
  it('rejects unknown catalogue variants', () => {
    const f = fixture();
    expect(() =>
      validateAssistantIntent(
        { ...intent(), recommendations: [{ variantId: randomUUID(), quantity: 1 }] },
        f.scene,
        f.candidates,
        policy,
        100000,
      ),
    ).toThrow(/unavailable catalogue/);
  });
  it('counts saved and recommended quantities against stock', () => {
    const f = fixture();
    f.candidate.stockQuantity = 1;
    expect(() =>
      validateAssistantIntent(
        { ...intent(), recommendations: [{ variantId: f.candidate.variantId, quantity: 1 }] },
        f.scene,
        f.candidates,
        policy,
        100000,
      ),
    ).toThrow(/inventory/);
  });
  it('includes exact tax and fees in budget enforcement', () => {
    const f = fixture();
    const input = { ...intent(), recommendations: [{ variantId: f.candidate.variantId, quantity: 1 }] };
    expect(() => validateAssistantIntent(input, f.scene, f.candidates, policy, 24599)).toThrow(/budget/);
    expect(
      validateAssistantIntent(input, f.scene, f.candidates, policy, 24600).calculation.totals.grandTotalMinor,
    ).toBe(24600);
  });
  it('preserves position locks exactly without epsilon', () => {
    const f = fixture();
    f.object.locks.position = true;
    expect(() =>
      validateAssistantIntent(
        {
          ...intent(),
          layout: {
            objectId: f.object.id,
            x: f.object.transform.x + 1e-10,
            z: f.object.transform.z,
            rotation: f.object.transform.rotation,
          },
        },
        f.scene,
        f.candidates,
        policy,
        100000,
      ),
    ).toThrow(/locked/);
  });
  it('preserves rotation locks exactly', () => {
    const f = fixture();
    f.object.locks.rotation = true;
    expect(() =>
      validateAssistantIntent(
        {
          ...intent(),
          layout: {
            objectId: f.object.id,
            x: f.object.transform.x,
            z: f.object.transform.z,
            rotation: f.object.transform.rotation + 1e-10,
          },
        },
        f.scene,
        f.candidates,
        policy,
        100000,
      ),
    ).toThrow(/locked/);
  });
  it('produces a normal smart transform and never mutates the input', () => {
    const f = fixture(),
      before = structuredClone(f.scene);
    const result = validateAssistantIntent(
      { ...intent(), layout: { objectId: f.object.id, x: 2, z: 2, rotation: 0 } },
      f.scene,
      f.candidates,
      policy,
      100000,
    );
    expect(result.operation).toEqual({
      type: 'transform',
      objectId: f.object.id,
      mode: 'smart',
      transform: { x: 2, y: 0, z: 2, rotation: 0 },
    });
    expect(f.scene).toEqual(before);
  });
  it('labels deterministic local advice and respects budget', () => {
    const f = fixture();
    const a = testAssistantIntent(f.scene, f.candidates, policy, 0);
    expect(a).toEqual(testAssistantIntent(f.scene, f.candidates, policy, 0));
    expect(a.summary).toContain('not generated by OpenAI');
    expect(a.recommendations).toEqual([]);
  });
  it('completes a bedside pair by recommending only the missing quantity', () => {
    const f = fixture();
    f.object.category = 'bedside';
    f.candidate.category = 'bedside';
    f.candidate.stockQuantity = 2;
    expect(testAssistantIntent(f.scene, f.candidates, policy, 100000).recommendations).toEqual([
      { variantId: f.candidate.variantId, quantity: 1 },
    ]);
    f.scene.objects.push({ ...structuredClone(f.object), id: randomUUID() });
    expect(testAssistantIntent(f.scene, f.candidates, policy, 100000).recommendations).toEqual([]);
  });
  it('reports an existing over-budget scene without inventing replacements', () => {
    const f = fixture();
    const checked = validateAssistantIntent(intent(), f.scene, f.candidates, policy, 0);
    expect(checked.overBudget).toBe(true);
    expect(checked.recommendations).toEqual([]);
  });
  it('preserves older additions-only intentions and request payloads', () => {
    expect(assistantIntentSchema.parse(intent())).toEqual({
      ...intent(),
      sceneRemovals: [],
      existingFurniture: [],
    });
    expect(
      assistantRequestSchema.parse({
        brief: 'Test room',
        provider: 'test',
        expectedSceneVersion: 0,
        idempotencyKey: randomUUID(),
      }).photoWorkspaces,
    ).toEqual([]);
  });
  it('rejects unknown, duplicate and injected removal advice', () => {
    const f = fixture();
    expect(() =>
      validateAssistantIntent(
        { ...intent(), sceneRemovals: [{ objectId: 'forged', rationale: 'Make space' }] },
        f.scene,
        f.candidates,
        policy,
        100000,
      ),
    ).toThrow(/unknown furniture removal/);
    const removal = { objectId: f.object.id, rationale: 'Make space' };
    expect(assistantIntentSchema.safeParse({ ...intent(), sceneRemovals: [removal, removal] }).success).toBe(
      false,
    );
    expect(
      assistantIntentSchema.safeParse({
        ...intent(),
        sceneRemovals: [{ ...removal, locks: { product: false } }],
      }).success,
    ).toBe(false);
  });
  it('never removes product-locked, grouped or relationship-anchor furniture', () => {
    const f = fixture(),
      input = { ...intent(), sceneRemovals: [{ objectId: f.object.id, rationale: 'Make space' }] };
    const validate = () => validateAssistantIntent(input, f.scene, f.candidates, policy, 100000);
    expect(validate).toThrow(/product-locked/);
    f.object.locks.product = false;
    f.scene.objects.push({ ...structuredClone(f.object), id: 'follower' });
    f.scene.groups = [
      { id: 'rigid-group', name: 'Keep together', objectIds: [f.object.id, 'follower'], locked: false },
    ];
    expect(validate).toThrow(/grouped or referenced/);
    f.scene.groups = [];
    f.scene.objects[1].follows = { anchorId: f.object.id, x: 1, z: 0, rotation: 0 };
    expect(validate).toThrow(/grouped or referenced/);
  });
  it('returns reviewed normal removal operations without mutating scene or photographs', () => {
    const f = fixture(),
      photo = photoFixture();
    f.object.locks.product = false;
    const before = structuredClone({ scene: f.scene, photo });
    const result = validateAssistantIntent(
      {
        ...intent(),
        sceneRemovals: [{ objectId: f.object.id, rationale: 'Replace this item' }],
        existingFurniture: [
          {
            referenceId: photo.referenceId,
            regionId: photo.regions[0].id,
            action: 'remove',
            rationale: 'Client wants a replacement',
          },
        ],
      },
      f.scene,
      f.candidates,
      policy,
      100000,
      [photo],
    );
    expect(result.sceneRemovals[0]).toMatchObject({
      objectId: f.object.id,
      name: f.object.name,
      sku: f.object.sku,
      operation: { type: 'remove-object', objectId: f.object.id },
    });
    expect(result.existingFurniture[0]).toMatchObject({
      workspaceRevision: 4,
      label: 'Client chest',
      action: 'remove',
    });
    expect(result.calculationBasis).toBe('projected_completion');
    expect(result.calculation.lines).toEqual([]);
    expect({ scene: f.scene, photo }).toEqual(before);
  });
  it('prices replacements after proposed removal and still checks stock, tax and budget', () => {
    const f = fixture();
    f.object.locks.product = false;
    f.candidate.stockQuantity = 1;
    const input = {
      ...intent(),
      sceneRemovals: [{ objectId: f.object.id, rationale: 'Replace existing item' }],
      recommendations: [{ variantId: f.candidate.variantId, quantity: 1 }],
    };
    expect(
      validateAssistantIntent(input, f.scene, f.candidates, policy, 12600).calculation.totals.grandTotalMinor,
    ).toBe(12600);
    expect(() => validateAssistantIntent(input, f.scene, f.candidates, policy, 12599)).toThrow(/budget/);
    expect(() =>
      validateAssistantIntent(
        { ...input, recommendations: [{ variantId: f.candidate.variantId, quantity: 2 }] },
        f.scene,
        f.candidates,
        policy,
        100000,
      ),
    ).toThrow(/inventory/);
  });
  it('rejects contradictory move/remove suggestions', () => {
    const f = fixture();
    f.object.locks.product = false;
    expect(() =>
      validateAssistantIntent(
        {
          ...intent(),
          layout: { objectId: f.object.id, x: 2, z: 2, rotation: 0 },
          sceneRemovals: [{ objectId: f.object.id, rationale: 'Remove it' }],
        },
        f.scene,
        f.candidates,
        policy,
        100000,
      ),
    ).toThrow(/move and remove/);
  });
  it('requires known photograph-region pairs and prevents forged or duplicate source snapshots', () => {
    const f = fixture(),
      photo = photoFixture(),
      second = photoFixture();
    const advice = {
      referenceId: photo.referenceId,
      regionId: photo.regions[0].id,
      action: 'remove',
      rationale: 'Make space',
    };
    expect(() =>
      validateAssistantIntent(
        { ...intent(), existingFurniture: [advice] },
        f.scene,
        f.candidates,
        policy,
        100000,
      ),
    ).toThrow(/unknown photograph/);
    expect(() =>
      validateAssistantIntent(
        { ...intent(), existingFurniture: [{ ...advice, regionId: second.regions[0].id }] },
        f.scene,
        f.candidates,
        policy,
        100000,
        [photo, second],
      ),
    ).toThrow(/unknown photograph/);
    expect(
      assistantIntentSchema.safeParse({ ...intent(), existingFurniture: [advice, advice] }).success,
    ).toBe(false);
    const request = {
      brief: 'Complete room',
      provider: 'openai',
      expectedSceneVersion: 0,
      idempotencyKey: randomUUID(),
      referenceIds: [photo.referenceId],
    };
    expect(
      assistantRequestSchema.safeParse({
        ...request,
        photoWorkspaces: [{ referenceId: second.referenceId, expectedRevision: 4 }],
      }).success,
    ).toBe(false);
    expect(
      assistantRequestSchema.safeParse({
        ...request,
        photoWorkspaces: [
          { referenceId: photo.referenceId, expectedRevision: 4 },
          { referenceId: photo.referenceId, expectedRevision: 4 },
        ],
      }).success,
    ).toBe(false);
  });
  it('rejects changed, deleted or substituted photograph workspaces', () => {
    const photo = photoFixture(),
      expected = [{ referenceId: photo.referenceId, expectedRevision: 4 }];
    expect(() => assertAssistantPhotoSources(expected, [photo])).not.toThrow();
    expect(() => assertAssistantPhotoSources(expected, [{ ...photo, revision: 5 }])).toThrow(/changed/);
    expect(() => assertAssistantPhotoSources(expected, [])).toThrow(/changed/);
    expect(() => assertAssistantPhotoSources(expected, [photoFixture()])).toThrow(/changed/);
  });
  it('grounds deterministic completion advice in reviewed regions and explicit removable objects', () => {
    const f = fixture(),
      photo = photoFixture();
    photo.regions[0].disposition = 'remove';
    f.object.locks.product = false;
    const first = testAssistantIntent(
      f.scene,
      f.candidates,
      policy,
      100000,
      [photo],
      `Replace the ${f.object.category}`,
    );
    expect(first).toEqual(
      testAssistantIntent(f.scene, f.candidates, policy, 100000, [photo], `Replace the ${f.object.category}`),
    );
    expect(first.sceneRemovals[0].objectId).toBe(f.object.id);
    expect(first.existingFurniture[0]).toMatchObject({
      referenceId: photo.referenceId,
      regionId: photo.regions[0].id,
      action: 'remove',
    });
    expect(() =>
      validateAssistantIntent(first, f.scene, f.candidates, policy, 100000, [photo]),
    ).not.toThrow();
    f.object.locks.product = true;
    expect(
      testAssistantIntent(f.scene, f.candidates, policy, 100000, [photo], `Replace the ${f.object.category}`)
        .sceneRemovals,
    ).toEqual([]);
  });
  it('suggests known original-photo removals only after an explicit test brief and leaves pixels and selections unchanged', () => {
    const f = fixture(),
      photo = photoFixture(),
      before = structuredClone(photo);
    const result = testAssistantIntent(
      f.scene,
      f.candidates,
      policy,
      100000,
      [photo],
      'Remove original furniture and complete the room',
    );
    expect(result.existingFurniture).toEqual([
      {
        referenceId: photo.referenceId,
        regionId: photo.regions[0].id,
        action: 'remove',
        rationale: expect.stringContaining('explicit request'),
      },
    ]);
    expect(photo).toEqual(before);
    expect(
      testAssistantIntent(f.scene, f.candidates, policy, 100000, [photo], 'Do not remove original furniture')
        .existingFurniture[0].action,
    ).toBe('keep');
    expect(
      testAssistantIntent(
        f.scene,
        f.candidates,
        policy,
        100000,
        [],
        'Remove original furniture and complete the room',
      ).existingFurniture,
    ).toEqual([]);
  });
});
describe('OpenAI transport boundary', () => {
  function setup() {
    vi.stubEnv('ROOMSELL_AI_API_KEY', 'fictional-unit-test-key');
    const f = fixture();
    return {
      brief: 'Prefer oak',
      scene: f.scene,
      candidates: f.candidates,
      policy,
      budgetMinor: 100000,
      photos: [],
    };
  }
  const response = (value: unknown) =>
    new Response(
      JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }),
    );
  it('fails before a network request without a configured key', async () => {
    vi.stubEnv('ROOMSELL_AI_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    const transport = vi.fn();
    await expect(openAiDesign(setupWithoutKey(), transport)).rejects.toMatchObject({ status: 503 });
    expect(transport).not.toHaveBeenCalled();
    function setupWithoutKey() {
      const f = fixture();
      return {
        brief: 'Test',
        scene: f.scene,
        candidates: f.candidates,
        policy,
        budgetMinor: 100000,
        photos: [],
      };
    }
  });
  it('disables provider storage and redirects and restricts schema to actual IDs', async () => {
    const input = setup(),
      transport = vi.fn().mockResolvedValue(response(intent()));
    await expect(openAiDesign(input, transport)).resolves.toEqual({
      ...intent(),
      sceneRemovals: [],
      existingFurniture: [],
    });
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options.redirect).toBe('error');
    const body = JSON.parse(options.body);
    expect(body.store).toBe(false);
    expect(body.text.format.schema.properties.recommendations.items.properties.variantId.enum).toEqual([
      input.candidates[0].variantId,
    ]);
    expect(body.input[0].content).toHaveLength(1);
    expect(body.text.format.schema.properties.sceneRemovals.maxItems).toBe(0);
    expect(body.text.format.schema.properties.existingFurniture.maxItems).toBe(0);
  });
  it('restricts completion advice to eligible object IDs and reviewed source regions', async () => {
    const input = setup(),
      photo = photoFixture();
    input.scene.objects[0].locks.product = false;
    const transport = vi.fn().mockResolvedValue(response(intent()));
    await openAiDesign({ ...input, photoWorkspaces: [photo] }, transport);
    const body = JSON.parse(transport.mock.calls[0][1].body),
      schema = body.text.format.schema.properties;
    expect(schema.sceneRemovals.items.properties.objectId.enum).toEqual([input.scene.objects[0].id]);
    expect(schema.existingFurniture.items.properties.referenceId.enum).toEqual([photo.referenceId]);
    expect(schema.existingFurniture.items.properties.regionId.enum).toEqual([photo.regions[0].id]);
    expect(JSON.parse(body.input[0].content[0].text).photoWorkspaces[0].revision).toBe(4);
    expect(body.instructions).toContain('requires human review');
  });
  it('labels each photograph identity explicitly so multiple photo sources cannot be confused', async () => {
    const input = setup(),
      first = photoFixture(),
      second = photoFixture();
    const transport = vi.fn().mockResolvedValue(response(intent()));
    await openAiDesign(
      {
        ...input,
        photoWorkspaces: [first, second],
        photos: [
          { referenceId: second.referenceId, mimeType: 'image/jpeg', base64: 'test-second' },
          { referenceId: first.referenceId, mimeType: 'image/jpeg', base64: 'test-first' },
        ],
      },
      transport,
    );
    const content = JSON.parse(transport.mock.calls[0][1].body).input[0].content;
    expect(content[1].text).toContain(second.referenceId);
    expect(content[2].image_url).toBe('data:image/jpeg;base64,test-second');
    expect(content[3].text).toContain(first.referenceId);
    expect(content[4].image_url).toBe('data:image/jpeg;base64,test-first');
  });
  it('rejects malformed and oversized model output', async () => {
    const input = setup();
    await expect(
      openAiDesign(input, vi.fn().mockResolvedValue(response({ ...intent(), sku: 'invented' }))),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      openAiDesign(input, vi.fn().mockResolvedValue(new Response('x'.repeat(131073)))),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('does not retry a permanently invalid provider configuration', async () => {
    await expect(
      openAiDesign(setup(), vi.fn().mockResolvedValue(new Response('{}', { status: 401 }))),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('classifies rate limits and network failures as retryable', async () => {
    const input = setup();
    await expect(
      openAiDesign(input, vi.fn().mockResolvedValue(new Response('{}', { status: 429 }))),
    ).rejects.toMatchObject({ status: 503 });
    await expect(openAiDesign(input, vi.fn().mockRejectedValue(new Error('offline')))).rejects.toMatchObject({
      status: 503,
    });
  });
});
