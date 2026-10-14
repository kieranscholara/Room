import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDemoScene } from '@roomsell/scene-core';
import type { PricingPolicy } from '@roomsell/pricing';
import {
  assistantRequestSchema,
  assistantIntentSchema,
  validateAssistantIntent,
  testAssistantIntent,
  type AssistantCandidate,
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
  it('reports an existing over-budget scene without inventing replacements', () => {
    const f = fixture();
    const checked = validateAssistantIntent(intent(), f.scene, f.candidates, policy, 0);
    expect(checked.overBudget).toBe(true);
    expect(checked.recommendations).toEqual([]);
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
    await expect(openAiDesign(input, transport)).resolves.toEqual(intent());
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options.redirect).toBe('error');
    const body = JSON.parse(options.body);
    expect(body.store).toBe(false);
    expect(body.text.format.schema.properties.recommendations.items.properties.variantId.enum).toEqual([
      input.candidates[0].variantId,
    ]);
    expect(body.input[0].content).toHaveLength(1);
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
