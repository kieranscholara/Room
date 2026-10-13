'use client';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { EditorState, Operation, Proposal, Scene } from '@roomsell/scene-core';

async function api(body?: unknown) {
  const response = await fetch(
    '/api/scene',
    body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-store' },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The room could not be updated.');
  return data;
}
interface Store {
  scene: Scene | null;
  proposal: Proposal | null;
  selectedId: string;
  busy: boolean;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  mode: 'manual' | 'smart';
  load(): Promise<void>;
  select(id: string): void;
  setMode(mode: 'manual' | 'smart'): void;
  preview(operation: Operation, immediate?: boolean): Promise<void>;
  accept(): Promise<void>;
  cancel(): void;
  history(action: 'undo' | 'redo'): Promise<void>;
}
export const useEditor = create<Store>()(
  immer((set, get) => {
    const state = (data: EditorState) =>
      set((s) => {
        s.scene = data.scene;
        s.canUndo = data.canUndo;
        s.canRedo = data.canRedo;
        s.proposal = null;
        s.error = null;
      });
    async function run(task: () => Promise<void>) {
      if (get().busy) return;
      set((s) => {
        s.busy = true;
        s.error = null;
      });
      try {
        await task();
      } catch (error) {
        set((s) => {
          s.error = error instanceof Error ? error.message : 'Unable to update the room.';
        });
      } finally {
        set((s) => {
          s.busy = false;
        });
      }
    }
    return {
      scene: null,
      proposal: null,
      selectedId: 'bed',
      busy: false,
      error: null,
      canUndo: false,
      canRedo: false,
      mode: 'smart',
      load: () => run(async () => state(await api())),
      select: (id) =>
        set((s) => {
          s.selectedId = id;
        }),
      setMode: (mode) =>
        set((s) => {
          s.mode = mode;
        }),
      preview: (operation, immediate = false) =>
        run(async () => {
          const scene = get().scene;
          if (!scene) return;
          const { proposal } = (await api({
            action: 'preview',
            expectedVersion: scene.version,
            operation,
          })) as { proposal: Proposal };
          if (immediate)
            state(await api({ action: 'accept', expectedVersion: scene.version, proposalId: proposal.id }));
          else
            set((s) => {
              s.proposal = proposal;
            });
        }),
      accept: () =>
        run(async () => {
          const { scene, proposal } = get();
          if (scene && proposal)
            state(await api({ action: 'accept', expectedVersion: scene.version, proposalId: proposal.id }));
        }),
      cancel: () =>
        set((s) => {
          s.proposal = null;
          s.error = null;
        }),
      history: (action) =>
        run(async () => {
          const scene = get().scene;
          if (scene) state(await api({ action, expectedVersion: scene.version }));
        }),
    };
  }),
);
