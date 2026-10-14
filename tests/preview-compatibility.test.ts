import { describe, expect, it } from 'vitest';
import { createDemoScene, type EditorState, type Proposal, type Scene } from '@roomsell/scene-core';
import { propose, SOLVER } from '@roomsell/layout-engine';
import {
  EditorService,
  sceneFingerprint,
  type Persistence,
  type RecordData,
  type SavedProposal,
} from '../apps/web/lib/editor-service';

class DurableMemory implements Persistence {
  data: RecordData = { scene: createDemoScene(), history: [], future: [] };
  proposals = new Map<string, SavedProposal>();
  saves = 0;
  async load() {
    return structuredClone(this.data);
  }
  async save(data: RecordData) {
    this.saves++;
    this.data = structuredClone(data);
  }
  async saveProposal(saved: SavedProposal) {
    this.proposals.set(saved.proposal.id, structuredClone(saved));
  }
  async loadProposal(id: string) {
    return structuredClone(this.proposals.get(id) || null);
  }
}
async function preview(memory: DurableMemory) {
  return (
    (await new EditorService(memory).execute({
      action: 'preview',
      expectedVersion: 0,
      operation: {
        type: 'locks',
        objectId: 'bed',
        locks: { position: true, rotation: false, product: false },
      },
    })) as { proposal: Proposal }
  ).proposal;
}
function acceptance(proposal: Proposal) {
  return { action: 'accept', expectedVersion: proposal.baseVersion, proposalId: proposal.id };
}
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reversedKeys(item)]),
    );
  return value;
}

describe('durable preview compatibility at the authoritative commit boundary', () => {
  it('accepts the exact approved result after a new service instance and preserves undo/redo', async () => {
    const memory = new DurableMemory();
    const proposal = await preview(memory);
    expect(Object.keys(proposal).sort()).toEqual(['baseVersion', 'evaluated', 'id', 'movedIds', 'scene']);
    expect(memory.saves).toBe(0);
    const accepted = (await new EditorService(memory).execute(acceptance(proposal))) as EditorState;
    expect(accepted.scene).toEqual({ ...proposal.scene, version: 1 });
    expect(memory.saves).toBe(1);
    const service = new EditorService(memory);
    await service.execute({ action: 'undo', expectedVersion: 1 });
    expect((await service.read()).scene.objects).toEqual(createDemoScene().objects);
    await service.execute({ action: 'redo', expectedVersion: 2 });
    expect((await service.read()).scene.objects).toEqual(proposal.scene.objects);
  });
  it('does not confuse JSON object key order with a changed approved scene', async () => {
    const memory = new DurableMemory();
    const proposal = await preview(memory);
    expect(sceneFingerprint(reversedKeys(proposal.scene) as Scene)).toBe(sceneFingerprint(proposal.scene));
    memory.proposals.set(proposal.id, reversedKeys(memory.proposals.get(proposal.id)) as SavedProposal);
    await expect(new EditorService(memory).execute(acceptance(proposal))).resolves.toMatchObject({
      scene: { version: 1 },
    });
  });
  it('fingerprints optional fields using their persisted JSON semantics', () => {
    const scene = createDemoScene();
    scene.objects.find((object) => object.id === 'bed')!.follows = undefined;
    expect(sceneFingerprint(scene)).toBe(sceneFingerprint(JSON.parse(JSON.stringify(scene))));
  });
  it('rejects an engine deployment change without scene/history/future writes', async () => {
    const memory = new DurableMemory();
    const proposal = await preview(memory);
    const before = structuredClone(memory.data);
    await expect(
      new EditorService(memory, createDemoScene(), { engineVersion: SOLVER.version + 1 }).execute(
        acceptance(proposal),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(memory.data).toEqual(before);
    expect(memory.saves).toBe(0);
  });
  it('rejects changed valid recomputation even when an engine version was not bumped', async () => {
    const memory = new DurableMemory();
    const proposal = await preview(memory);
    const before = structuredClone(memory.data);
    const changedPlanner: typeof propose = (scene, operation) => {
      const result = propose(scene, operation);
      if (result.ok) result.scene.room.name = 'A different valid result';
      return result;
    };
    await expect(
      new EditorService(memory, createDemoScene(), { planner: changedPlanner }).execute(acceptance(proposal)),
    ).rejects.toMatchObject({ status: 409 });
    expect(memory.data).toEqual(before);
    expect(memory.saves).toBe(0);
  });
  it.each([
    'legacy',
    'engine',
    'approved',
    'base',
    'operation',
    'foreign',
    'proposal-id',
    'same-version-base-change',
  ])('rejects %s persisted preview without writes', async (tamper) => {
    const memory = new DurableMemory();
    const proposal = await preview(memory);
    const saved = memory.proposals.get(proposal.id)!;
    if (tamper === 'legacy') delete (saved as Partial<SavedProposal>).engineVersion;
    if (tamper === 'engine') saved.engineVersion++;
    if (tamper === 'approved') saved.proposal.scene.objects[0].transform.x += 0.1;
    if (tamper === 'base') saved.baseSceneFingerprint = 'a'.repeat(64);
    if (tamper === 'operation') saved.operation.expectedVersion++;
    if (tamper === 'foreign') {
      saved.proposal.scene.organisationId = 'another-retailer';
      saved.approvedSceneFingerprint = sceneFingerprint(saved.proposal.scene);
    }
    if (tamper === 'proposal-id') saved.proposal.id = 'foreign-preview';
    if (tamper === 'same-version-base-change') memory.data.scene.room.name = 'Changed without a version bump';
    const before = structuredClone(memory.data);
    await expect(new EditorService(memory).execute(acceptance(proposal))).rejects.toMatchObject({
      status: 409,
    });
    expect(memory.data).toEqual(before);
    expect(memory.saves).toBe(0);
  });
});
