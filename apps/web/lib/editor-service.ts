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
  save(data: RecordData): Promise<void>;
}
export class ServiceError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
// One local demonstration organisation. This adapter must never serve real tenant/customer data.
export class EditorService {
  private queue: Promise<unknown> = Promise.resolve();
  private proposals = new Map<string, { proposal: Proposal; operation: Request & { action: 'preview' } }>();
  constructor(private persistence: Persistence) {}
  private async record(): Promise<RecordData> {
    const stored = await this.persistence.load();
    if (!stored) return { scene: createDemoScene(), history: [], future: [] };
    const scene = sceneSchema.parse(stored.scene);
    const history = stored.history.map((s) => sceneSchema.parse(s));
    const future = stored.future.map((s) => sceneSchema.parse(s));
    if (
      [scene, ...history, ...future].some(
        (s) => validateScene(s).length || s.id !== 'demo-bedroom' || s.organisationId !== 'local-demo',
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
      return { proposal };
    }
    let next: Scene;
    if (request.action === 'accept') {
      const saved = this.proposals.get(request.proposalId);
      if (!saved || saved.proposal.baseVersion !== data.scene.version)
        throw new ServiceError(409, 'The preview expired. Preview the change again.');
      const result = propose(data.scene, saved.operation.operation);
      if (!result.ok) throw new ServiceError(422, 'The proposed arrangement is no longer valid.', result);
      next = result.scene;
      // Locks and physical dimensions are checked again at the commit boundary.
      if (saved.operation.operation.type !== 'locks') {
        const conflicts = data.scene.objects.flatMap((o) =>
          lockConflicts(
            o,
            next.objects.find((n) => n.id === o.id)!,
          ),
        );
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
    await this.persistence.save(data);
    this.proposals.clear();
    return this.state(data);
  }
}
