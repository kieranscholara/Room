import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoScene, type EditorState, type Proposal, type Scene } from '@roomsell/scene-core';
import { useEditor } from '../apps/web/lib/editor-store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function scene(name: string): Scene {
  return { ...createDemoScene(), id: name, organisationId: `organisation-${name}` };
}
function editorState(name: string): EditorState {
  return { scene: scene(name), canUndo: false, canRedo: false };
}
function response(data: unknown) {
  return Response.json(data);
}
function proposal(name: string): Proposal {
  return { id: `proposal-${name}`, baseVersion: 0, scene: scene(name), movedIds: [], evaluated: 1 };
}
const operation = {
  type: 'locks',
  objectId: 'bed',
  locks: { position: true, rotation: false, product: false },
} as const;

beforeEach(() => {
  useEditor.setState({
    endpoint: '/api/projects/old/scene',
    scene: scene('old'),
    proposal: null,
    selectedId: 'bed',
    busy: false,
    error: null,
    canUndo: true,
    canRedo: true,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('editor request ownership during project navigation', () => {
  it('starts a new load while busy, clears old project state immediately and ignores the old response', async () => {
    const oldRequest = deferred<Response>(),
      newRequest = deferred<Response>();
    const fetch = vi.fn().mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    vi.stubGlobal('fetch', fetch);
    const oldLoad = useEditor.getState().load('/api/projects/old/scene');
    const newLoad = useEditor.getState().load('/api/projects/new/scene');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(useEditor.getState()).toMatchObject({
      endpoint: '/api/projects/new/scene',
      scene: null,
      proposal: null,
      selectedId: '',
      canUndo: false,
      canRedo: false,
      busy: true,
    });
    newRequest.resolve(response(editorState('new')));
    await newLoad;
    oldRequest.resolve(response(editorState('old')));
    await oldLoad;
    expect(useEditor.getState()).toMatchObject({
      endpoint: '/api/projects/new/scene',
      scene: { id: 'new' },
      busy: false,
      error: null,
    });
    expect(fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      '/api/projects/old/scene',
      '/api/projects/new/scene',
    ]);
  });

  it('supersedes an in-flight reload of the same endpoint', async () => {
    const first = deferred<Response>(),
      second = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    const firstLoad = useEditor.getState().load();
    const secondLoad = useEditor.getState().load();
    second.resolve(response(editorState('latest')));
    await secondLoad;
    first.resolve(response(editorState('stale')));
    await firstLoad;
    expect(useEditor.getState().scene?.id).toBe('latest');
  });

  it('discards a preview that finishes after switching projects', async () => {
    const previewRequest = deferred<Response>(),
      loadRequest = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValueOnce(previewRequest.promise).mockReturnValueOnce(loadRequest.promise),
    );
    const preview = useEditor.getState().preview(operation);
    const load = useEditor.getState().load('/api/projects/new/scene');
    loadRequest.resolve(response(editorState('new')));
    await load;
    previewRequest.resolve(response({ proposal: proposal('old') }));
    await preview;
    expect(useEditor.getState()).toMatchObject({
      scene: { id: 'new' },
      proposal: null,
      busy: false,
      error: null,
    });
  });

  it('does not send automatic acceptance for an old preview after navigation', async () => {
    const previewRequest = deferred<Response>(),
      loadRequest = deferred<Response>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(previewRequest.promise)
      .mockReturnValueOnce(loadRequest.promise);
    vi.stubGlobal('fetch', fetch);
    const preview = useEditor.getState().preview(operation, true);
    const load = useEditor.getState().load('/api/projects/new/scene');
    previewRequest.resolve(response({ proposal: proposal('old') }));
    await preview;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(useEditor.getState()).toMatchObject({ scene: null, proposal: null, busy: true });
    loadRequest.resolve(response(editorState('new')));
    await load;
    expect(useEditor.getState().scene?.id).toBe('new');
  });

  it('keeps the latest request busy and error-free when an old request fails', async () => {
    const previewRequest = deferred<Response>(),
      loadRequest = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValueOnce(previewRequest.promise).mockReturnValueOnce(loadRequest.promise),
    );
    const preview = useEditor.getState().preview(operation);
    const load = useEditor.getState().load('/api/projects/new/scene');
    previewRequest.reject(new Error('Old project is forbidden'));
    await preview;
    expect(useEditor.getState()).toMatchObject({
      endpoint: '/api/projects/new/scene',
      busy: true,
      error: null,
    });
    loadRequest.resolve(response(editorState('new')));
    await load;
    expect(useEditor.getState()).toMatchObject({ scene: { id: 'new' }, busy: false, error: null });
  });

  it.each(['accept', 'undo', 'redo'] as const)(
    'ignores an already sent %s response after navigation',
    async (action) => {
      const operationRequest = deferred<Response>(),
        loadRequest = deferred<Response>();
      const fetch = vi
        .fn()
        .mockReturnValueOnce(operationRequest.promise)
        .mockReturnValueOnce(loadRequest.promise);
      vi.stubGlobal('fetch', fetch);
      useEditor.setState({ proposal: proposal('old') });
      const update =
        action === 'accept' ? useEditor.getState().accept() : useEditor.getState().history(action);
      const load = useEditor.getState().load('/api/projects/new/scene');
      loadRequest.resolve(response(editorState('new')));
      await load;
      operationRequest.resolve(response({ ...editorState('old'), canUndo: true, canRedo: true }));
      await update;
      expect(fetch.mock.calls[0][0]).toBe('/api/projects/old/scene');
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ action });
      expect(useEditor.getState()).toMatchObject({
        scene: { id: 'new' },
        proposal: null,
        canUndo: false,
        canRedo: false,
        busy: false,
      });
    },
  );
});
