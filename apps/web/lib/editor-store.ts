'use client';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { EditorState, Operation, Proposal, Scene } from '@roomsell/scene-core';

async function api(endpoint: string, body?: unknown) {
  const response = await fetch(
    endpoint,
    body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-store' },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The room could not be updated.');
  return data;
}
interface Store {
  endpoint: string;
  scene: Scene | null;
  proposal: Proposal | null;
  selectedId: string;
  busy: boolean;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  mode: 'manual' | 'smart';
  load(endpoint?: string): Promise<void>;
  select(id: string): void;
  setMode(mode: 'manual' | 'smart'): void;
  preview(operation: Operation, immediate?: boolean): Promise<void>;
  accept(): Promise<void>;
  cancel(): void;
  history(action: 'undo' | 'redo'): Promise<void>;
}
export const useEditor = create<Store>()(
  immer((set, get) => {
    // Navigation supersedes requests even while another operation is busy.
    // Every response belongs to the endpoint and generation that sent it.
    let generation = 0;
    type Scope = { generation: number; endpoint: string };
    const current = (scope: Scope) => scope.generation === generation && scope.endpoint === get().endpoint;
    const state = (scope: Scope, data: EditorState) => {
      if (!current(scope)) return;
      set((s) => {
        s.scene = data.scene;
        s.canUndo = data.canUndo;
        s.canRedo = data.canRedo;
        s.proposal = null;
        s.error = null;
      });
    };
    async function scopedTask(scope: Scope, task: (scope: Scope) => Promise<void>) {
      try {
        await task(scope);
      } catch (error) {
        if (current(scope))
          set((s) => {
            s.error = error instanceof Error ? error.message : 'Unable to update the room.';
          });
      } finally {
        if (current(scope))
          set((s) => {
            s.busy = false;
          });
      }
    }
    async function run(task: (scope: Scope) => Promise<void>) {
      if (get().busy) return;
      const scope = { generation, endpoint: get().endpoint };
      set((s) => {
        s.busy = true;
        s.error = null;
      });
      await scopedTask(scope, task);
    }
    return {
      endpoint: '/api/scene',
      scene: null,
      proposal: null,
      selectedId: 'bed',
      busy: false,
      error: null,
      canUndo: false,
      canRedo: false,
      mode: 'smart',
      load: async (endpoint = get().endpoint) => {
        const scope = { generation: ++generation, endpoint };
        set((s) => {
          if (endpoint !== s.endpoint) {
            s.scene = null;
            s.proposal = null;
            s.selectedId = '';
            s.canUndo = false;
            s.canRedo = false;
          }
          s.endpoint = endpoint;
          s.busy = true;
          s.error = null;
        });
        await scopedTask(scope, async () => state(scope, await api(scope.endpoint)));
      },
      select: (id) =>
        set((s) => {
          s.selectedId = id;
        }),
      setMode: (mode) =>
        set((s) => {
          s.mode = mode;
        }),
      preview: (operation, immediate = false) =>
        run(async (scope) => {
          const scene = get().scene;
          if (!scene) return;
          const { proposal } = (await api(scope.endpoint, {
            action: 'preview',
            expectedVersion: scene.version,
            operation,
          })) as { proposal: Proposal };
          if (!current(scope)) return;
          if (immediate)
            state(
              scope,
              await api(scope.endpoint, {
                action: 'accept',
                expectedVersion: scene.version,
                proposalId: proposal.id,
              }),
            );
          else
            set((s) => {
              s.proposal = proposal;
            });
        }),
      accept: () =>
        run(async (scope) => {
          const { scene, proposal } = get();
          if (scene && proposal)
            state(
              scope,
              await api(scope.endpoint, {
                action: 'accept',
                expectedVersion: scene.version,
                proposalId: proposal.id,
              }),
            );
        }),
      cancel: () =>
        set((s) => {
          s.proposal = null;
          s.error = null;
        }),
      history: (action) =>
        run(async (scope) => {
          const scene = get().scene;
          if (scene) state(scope, await api(scope.endpoint, { action, expectedVersion: scene.version }));
        }),
    };
  }),
);
