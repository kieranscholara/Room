import { randomUUID } from 'node:crypto';
import {
  createDemoScene,
  requestSchema,
  sceneSchema,
  lockConflicts,
  type EditorState,
  type Proposal,
  type Request,
  type Scene,
} from '@roomsell/scene-core';
import { propose } from '@roomsell/layout-engine';
import { validateScene } from '@roomsell/geometry';

export interface RecordData {
  scene: Scene;
  history: Scene[];
  future: Scene[];
}
export interface Persistence {
  load(): Promise<RecordData | null>;
  save(data: RecordData, expectedVersion?: number): Promise<void>;
  saveProposal?(saved: SavedProposal): Promise<void>;
  loadProposal?(id: string): Promise<SavedProposal | null>;
  revisions?(): Promise<{ version: number; scene: Scene }[]>;
}
export interface SavedProposal {
  proposal: Proposal;
  operation: Request & { action: 'preview' };
}
const serviceErrorBrand = Symbol.for('roomsell.service-error');
export class ServiceError extends Error {
  readonly [serviceErrorBrand] = true;
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
/** A cached service can outlive its route module during development reloads. */
export function isServiceError(value: unknown): value is ServiceError {
  if (!(value instanceof Error)) return false;
  const error = value as Partial<ServiceError>;
  return (
    error[serviceErrorBrand] === true &&
    Number.isInteger(error.status) &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status <= 599 &&
    typeof error.message === 'string'
  );
}
export class EditorService {
  private queue: Promise<unknown> = Promise.resolve();
  private proposals = new Map<string, SavedProposal>();
  private initialScene: Scene;
  constructor(
    private persistence: Persistence,
    initialScene: Scene = createDemoScene(),
  ) {
    this.initialScene = sceneSchema.parse(initialScene);
    if (validateScene(this.initialScene).length)
      throw new ServiceError(422, 'Initial room geometry is invalid.');
  }
  private async record(): Promise<RecordData> {
    const stored = await this.persistence.load();
    if (!stored) return { scene: structuredClone(this.initialScene), history: [], future: [] };
    const scene = sceneSchema.parse(stored.scene);
    const history = stored.history.map((s) => sceneSchema.parse(s));
    const future = stored.future.map((s) => sceneSchema.parse(s));
    if (
      [scene, ...history, ...future].some(
        (s) =>
          validateScene(s).length ||
          s.id !== this.initialScene.id ||
          s.organisationId !== this.initialScene.organisationId,
      )
    )
      throw new ServiceError(500, 'Invalid local scene data. Restore a valid backup.');
    return { scene, history, future };
  }
  private state(data: RecordData): EditorState {
    return { scene: data.scene, canUndo: Boolean(data.history.length), canRedo: Boolean(data.future.length) };
  }
  async read(): Promise<EditorState> {
    await this.queue;
    return this.state(await this.record());
  }
  async revisions(): Promise<{ version: number; scene: Scene }[]> {
    await this.queue;
    const data = await this.record();
    const revisions = this.persistence.revisions
      ? await this.persistence.revisions()
      : [...data.history, data.scene].reverse().map((scene) => ({ version: scene.version, scene }));
    return revisions.map((revision) => {
      const scene = sceneSchema.parse(revision.scene);
      if (
        scene.id !== this.initialScene.id ||
        scene.organisationId !== this.initialScene.organisationId ||
        scene.version !== revision.version ||
        validateScene(scene).length
      )
        throw new ServiceError(500, 'Invalid scene revision data.');
      return { version: scene.version, scene };
    });
  }
  execute(input: unknown): Promise<EditorState | { proposal: Proposal }> {
    const task = this.queue.then(() => this.apply(input));
    this.queue = task.catch(() => undefined);
    return task;
  }
  private async apply(input: unknown): Promise<EditorState | { proposal: Proposal }> {
    const request = requestSchema.parse(input);
    const data = await this.record();
    if (request.expectedVersion !== data.scene.version)
      throw new ServiceError(409, 'This room has a newer revision. Reload before editing.');
    if (request.action === 'preview') {
      const result = propose(data.scene, request.operation);
      if (!result.ok) throw new ServiceError(422, result.conflicts.map((c) => c.message).join(' '), result);
      const proposal = {
        id: randomUUID(),
        baseVersion: data.scene.version,
        scene: result.scene,
        movedIds: result.movedIds,
        evaluated: result.evaluated,
      };
      if (this.proposals.size >= 100) this.proposals.delete(this.proposals.keys().next().value!);
      this.proposals.set(proposal.id, { proposal: structuredClone(proposal), operation: request });
      await this.persistence.saveProposal?.({ proposal: structuredClone(proposal), operation: request });
      return { proposal };
    }
    let next: Scene;
    if (request.action === 'accept') {
      const saved = this.persistence.loadProposal
        ? await this.persistence.loadProposal(request.proposalId)
        : this.proposals.get(request.proposalId);
      if (!saved || saved.proposal.baseVersion !== data.scene.version)
        throw new ServiceError(409, 'The preview expired. Preview the change again.');
      const result = propose(data.scene, saved.operation.operation);
      if (!result.ok) throw new ServiceError(422, 'The proposed arrangement is no longer valid.', result);
      next = result.scene;
      // Locks and physical dimensions are checked again at the commit boundary.
      if (saved.operation.operation.type !== 'locks') {
        const operation = saved.operation.operation;
        const conflicts = data.scene.objects.flatMap((o) => {
          const after = next.objects.find((n) => n.id === o.id);
          if (!after)
            return operation.type === 'remove-object' && operation.objectId === o.id && !o.locks.product
              ? []
              : [
                  {
                    code: 'invalid-removal',
                    message: 'A protected furniture object disappeared.',
                    objectIds: [o.id],
                  },
                ];
          if (
            o.sku !== after.sku ||
            o.variantId !== after.variantId ||
            JSON.stringify(o.dimensions) !== JSON.stringify(after.dimensions)
          )
            return [
              {
                code: 'catalogue-mutation',
                message: 'Furniture identity or physical dimensions changed.',
                objectIds: [o.id],
              },
            ];
          return lockConflicts(o, after);
        });
        if (conflicts.length) throw new ServiceError(422, 'A locked property changed.', conflicts);
      }
      data.history.push(structuredClone(data.scene));
      data.future = [];
    } else if (request.action === 'undo') {
      if (!data.history.length) throw new ServiceError(409, 'There is no earlier revision.');
      next = data.history.pop()!;
      data.future.push(structuredClone(data.scene));
    } else {
      if (!data.future.length) throw new ServiceError(409, 'There is no later revision.');
      next = data.future.pop()!;
      data.history.push(structuredClone(data.scene));
    }
    next.version = data.scene.version + 1;
    data.scene = sceneSchema.parse(next);
    if (validateScene(data.scene).length)
      throw new ServiceError(422, 'The saved revision is geometrically invalid.');
    // Bound local history; production will use append-only relational scene_versions.
    data.history = data.history.slice(-100);
    data.future = data.future.slice(-100);
    await this.persistence.save(data, request.expectedVersion);
    this.proposals.clear();
    return this.state(data);
  }
}
