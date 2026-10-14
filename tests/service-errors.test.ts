import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoScene } from '@roomsell/scene-core';

afterEach(() => vi.resetModules());

describe('safe service errors across route module reloads', () => {
  it('recognises a real geometry failure from a service created by an earlier module', async () => {
    const earlier = await import('../apps/web/lib/editor-service');
    const scene = createDemoScene();
    const service = new earlier.EditorService({
      load: async () => ({ scene, history: [], future: [] }),
      save: async () => undefined,
    });
    vi.resetModules();
    const later = await import('../apps/web/lib/editor-service');
    let failure: unknown;
    try {
      await service.execute({
        action: 'preview',
        expectedVersion: 0,
        operation: {
          type: 'transform',
          objectId: 'wardrobe',
          transform: { x: 2, y: 0, z: 2, rotation: 0 },
          mode: 'manual',
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(earlier.ServiceError);
    expect(failure).not.toBeInstanceOf(later.ServiceError);
    expect(later.isServiceError(failure)).toBe(true);
    expect(failure).toMatchObject({ status: 422 });
    const { api } = await import('../apps/web/lib/http-api');
    const response = await api(async () => {
      throw failure;
    });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toContain('locked');
    expect(body.details.ok).toBe(false);
  });

  it('preserves a stale-version conflict from an earlier service constructor', async () => {
    const earlier = await import('../apps/web/lib/editor-service');
    const error = new earlier.ServiceError(409, 'Reload the changed room.');
    vi.resetModules();
    const { isServiceError } = await import('../apps/web/lib/editor-service');
    expect(isServiceError(error)).toBe(true);
    const { api } = await import('../apps/web/lib/http-api');
    const response = await api(async () => {
      throw error;
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Reload the changed room.' });
  });

  it('does not expose messages from ordinary errors or unbranded lookalikes', async () => {
    const { isServiceError } = await import('../apps/web/lib/editor-service');
    const { api } = await import('../apps/web/lib/http-api');
    for (const error of [
      Object.assign(new Error('Private database detail'), { status: 403 }),
      { status: 422, message: 'An untrusted message', details: { secret: true } },
      { [Symbol.for('roomsell.service-error')]: true, status: 422, message: 'A plain object' },
    ]) {
      expect(isServiceError(error)).toBe(false);
      const response = await api(async () => {
        throw error;
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Unable to complete this request.' });
    }
  });

  it.each([200, 399, 600, 422.5, Number.NaN])('rejects an invalid branded HTTP status %s', async (status) => {
    const { ServiceError, isServiceError } = await import('../apps/web/lib/editor-service');
    expect(isServiceError(new ServiceError(status, 'Invalid error status'))).toBe(false);
  });
});
