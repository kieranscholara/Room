import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EditorService, type Persistence, type RecordData } from '../apps/web/lib/editor-service';
import { FilePersistence } from '../apps/web/lib/local-persistence';
import type { EditorState, Operation, Proposal } from '@roomsell/scene-core';
import { createDemoScene } from '@roomsell/scene-core';

class Memory implements Persistence {
  data: RecordData | null = null;
  async load() {
    return structuredClone(this.data);
  }
  async save(data: RecordData) {
    this.data = structuredClone(data);
  }
}
const move: Operation = {
  type: 'transform',
  objectId: 'bed',
  mode: 'smart',
  transform: { x: 3, y: 0, z: 3.8, rotation: Math.PI },
};
async function preview(service: EditorService, operation = move, expectedVersion = 0) {
  return (
    (await service.execute({ action: 'preview', operation, expectedVersion })) as { proposal: Proposal }
  ).proposal;
}
async function accept(service: EditorService, proposal: Proposal) {
  return (await service.execute({
    action: 'accept',
    expectedVersion: proposal.baseVersion,
    proposalId: proposal.id,
  })) as EditorState;
}
describe('authoritative local scene service', () => {
  it('validates initial scenes before reading an empty store', () => {
    const scene = createDemoScene();
    scene.objects[1].transform.x = -1;
    expect(() => new EditorService(new Memory(), scene)).toThrow('Initial room geometry is invalid');
  });
  it('rejects foreign revisions returned by a persistence adapter', async () => {
    const memory = new Memory();
    const foreign = createDemoScene();
    foreign.organisationId = 'another-organisation';
    const persistence = {
      ...{ load: () => memory.load(), save: (data: RecordData) => memory.save(data) },
      revisions: async () => [{ version: foreign.version, scene: foreign }],
    };
    await expect(new EditorService(persistence).revisions()).rejects.toMatchObject({ status: 500 });
  });
  it('previews without committing; accept, undo and redo preserve exact transforms and locks', async () => {
    const service = new EditorService(new Memory());
    const original = (await service.read()).scene;
    const proposal = await preview(service);
    expect((await service.read()).scene).toEqual(original);
    const accepted = await accept(service, proposal);
    expect(accepted.scene.version).toBe(1);
    expect(accepted.canUndo).toBe(true);
    const undone = (await service.execute({ action: 'undo', expectedVersion: 1 })) as EditorState;
    expect(undone.scene.objects).toEqual(original.objects);
    expect(undone.scene.version).toBe(2);
    const redone = (await service.execute({ action: 'redo', expectedVersion: 2 })) as EditorState;
    expect(redone.scene.objects).toEqual(accepted.scene.objects);
    expect(redone.scene.version).toBe(3);
  });
  it('saves locks on the backend and refuses subsequent direct and automatic violations', async () => {
    const service = new EditorService(new Memory());
    const lock = await preview(service, {
      type: 'locks',
      objectId: 'bed',
      locks: { position: true, rotation: true, product: true },
    });
    await accept(service, lock);
    await expect(preview(service, move, 1)).rejects.toMatchObject({ status: 422 });
    expect((await service.read()).scene.objects.find((o) => o.id === 'bed')!.locks.position).toBe(true);
  });
  it('rejects stale concurrent commits and cannot overwrite newer locks', async () => {
    const service = new EditorService(new Memory());
    const a = await preview(service),
      b = await preview(service, {
        type: 'locks',
        objectId: 'bed',
        locks: { position: true, rotation: true, product: true },
      });
    const results = await Promise.allSettled([accept(service, b), accept(service, a)]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason.status).toBe(409);
    expect((await service.read()).scene.objects.find((o) => o.id === 'bed')!.locks.position).toBe(true);
  });
  it('rejects forged preview IDs, client scene replacement and foreign organisation fields', async () => {
    const service = new EditorService(new Memory());
    await expect(
      service.execute({ action: 'accept', expectedVersion: 0, proposalId: 'forged' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.execute({
        action: 'preview',
        expectedVersion: 0,
        operation: move,
        organisationId: 'another-retailer',
      }),
    ).rejects.toThrow();
    await expect(
      service.execute({ action: 'accept', expectedVersion: 0, proposalId: 'forged', scene: {} }),
    ).rejects.toThrow();
    // This is request-boundary coverage, not a claim of production multi-tenant auth/RLS.
  });
  it('keeps saved data unchanged on invalid edits and does not trust returned proposal mutations', async () => {
    const service = new EditorService(new Memory());
    const proposal = await preview(service);
    proposal.scene.objects.find((o) => o.id === 'wardrobe')!.transform.x = 0;
    const accepted = await accept(service, proposal);
    expect(accepted.scene.objects.find((o) => o.id === 'wardrobe')!.transform.x).toBe(5.55);
    const before = await service.read();
    await expect(
      preview(service, { ...move, transform: { x: 0, y: 0, z: 0, rotation: 0 } }, 1),
    ).rejects.toMatchObject({ status: 422 });
    expect(await service.read()).toEqual(before);
  });
  it('clears redo after branching from an earlier revision', async () => {
    const service = new EditorService(new Memory());
    await accept(service, await preview(service));
    await service.execute({ action: 'undo', expectedVersion: 1 });
    await accept(
      service,
      await preview(
        service,
        { type: 'locks', objectId: 'bed', locks: { position: true, rotation: false, product: false } },
        2,
      ),
    );
    expect((await service.read()).canRedo).toBe(false);
    await expect(service.execute({ action: 'redo', expectedVersion: 3 })).rejects.toMatchObject({
      status: 409,
    });
  });
  it('round-trips real atomic file persistence across a new service instance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'roomsell-'));
    try {
      const path = join(directory, 'scene.json');
      const first = new EditorService(new FilePersistence(path));
      const expected = await accept(first, await preview(first));
      const second = new EditorService(new FilePersistence(path));
      expect(await second.read()).toEqual(expected);
      expect(JSON.parse(await readFile(path, 'utf8')).scene.objects).toEqual(expected.scene.objects);
      await expect(accept(second, await preview(first, move, 1))).rejects.toMatchObject({ status: 409 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
