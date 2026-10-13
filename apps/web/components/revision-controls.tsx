'use client';
import { useEffect, useState } from 'react';
import { History, X } from 'lucide-react';
import { Button, Field } from '@roomsell/ui';
import type { Scene } from '@roomsell/scene-core';

export function RevisionControls({
  scene,
  endpoint,
  onCompare,
  comparing,
}: {
  scene: Scene;
  endpoint: string;
  onCompare(scene: Scene | null): void;
  comparing: Scene | null;
}) {
  const [revisions, setRevisions] = useState<{ version: number; scene: Scene }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${endpoint}/history`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load revisions.');
        setRevisions(Array.isArray(data) ? data : data.revisions);
        setError('');
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Could not load revisions.');
      });
    return () => controller.abort();
  }, [endpoint, scene.version]);
  const older = revisions.filter((revision) => revision.version !== scene.version);
  const changed = comparing
    ? scene.objects.filter((object) => {
        const previous = comparing.objects.find((candidate) => candidate.id === object.id);
        return !previous || JSON.stringify(previous) !== JSON.stringify(object);
      })
    : [];
  const removed =
    comparing?.objects.filter((object) => !scene.objects.some((candidate) => candidate.id === object.id)) ??
    [];
  const roomChanged = comparing && JSON.stringify(comparing.room) !== JSON.stringify(scene.room);
  const groupsChanged = comparing && JSON.stringify(comparing.groups) !== JSON.stringify(scene.groups);
  return (
    <details className="editor-details revision-controls">
      <summary>
        <History size={14} /> Compare saved layouts
      </summary>
      {error ? (
        <p role="status" className="editor-help">
          {error}
        </p>
      ) : (
        <>
          <Field label="Compare with revision">
            <select
              aria-label="Compare with revision"
              value={comparing?.version ?? ''}
              disabled={!older.length}
              onChange={(event) =>
                onCompare(
                  older.find((revision) => String(revision.version) === event.target.value)?.scene ?? null,
                )
              }
            >
              <option value="">Choose a saved revision</option>
              {older.map((revision) => (
                <option key={revision.version} value={revision.version}>
                  Revision {revision.version}
                </option>
              ))}
            </select>
          </Field>
          {!older.length && (
            <p className="editor-help">Accept a change to compare it with a previous saved layout.</p>
          )}
          {comparing && (
            <div className="revision-comparison" role="status">
              <p>
                <strong>Revision {comparing.version}</strong> appears in purple. Current saved revision is{' '}
                {scene.version}.
              </p>
              <p>
                {changed.length + removed.length} furniture changes
                {roomChanged ? ' · room measurements or architecture changed' : ''}
                {groupsChanged ? ' · furniture groups changed' : ''}.
              </p>
              {(changed.length > 0 || removed.length > 0) && (
                <ul>
                  {changed.map((object) => (
                    <li key={object.id}>{object.name}</li>
                  ))}
                  {removed.map((object) => (
                    <li key={object.id}>{object.name} (removed)</li>
                  ))}
                </ul>
              )}
              <p className="editor-help">
                Comparison is for review. Use Undo to restore the preceding saved layout.
              </p>
              <Button onClick={() => onCompare(null)}>
                <X size={14} /> Clear comparison
              </Button>
            </div>
          )}
        </>
      )}
    </details>
  );
}
