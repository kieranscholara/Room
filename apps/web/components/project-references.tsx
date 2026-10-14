'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Field } from '@roomsell/ui';
import { accountRequest } from './workspace-frame';
interface RoomReference {
  id: string;
  name: string;
  url: string;
  createdAt: string;
}
export function ProjectReferences({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [items, setItems] = useState<RoomReference[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [selected, setSelected] = useState<RoomReference | null>(null);
  const path = `/api/projects/${projectId}/references`;
  const load = useCallback(async () => {
    try {
      setItems(await accountRequest<RoomReference[]>(path));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load room photographs.');
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="account-panel" aria-label="Room photographs">
      <div>
        <h2>Room photographs</h2>
        <p className="account-muted">
          Private visual references for this project. Photographs do not determine or confirm room
          measurements.
        </p>
      </div>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {canEdit && (
        <form
          className="business-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!file) return;
            setBusy(true);
            setError('');
            try {
              const form = new FormData();
              form.set('file', file);
              const response = await fetch(path, { method: 'POST', body: form });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error ?? 'Could not upload photograph.');
              setFile(null);
              await load();
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Upload failed.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Room photograph">
            <input
              aria-label="Room photograph"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          <Button type="submit" disabled={!file || busy}>
            Upload room photograph
          </Button>
        </form>
      )}
      <div className="business-card-list">
        {items.map((item) => (
          <article className="business-record" key={item.id}>
            <img className="business-item-image" src={item.url} alt={item.name} />
            <div>
              <strong>{item.name}</strong>
              <p>{new Date(item.createdAt).toLocaleDateString()}</p>
            </div>
            <Button onClick={() => setSelected(item)}>View photograph</Button>
            {canEdit && (
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await accountRequest(`${path}/${item.id}`, { method: 'DELETE' });
                    if (selected?.id === item.id) setSelected(null);
                    await load();
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : 'Could not remove photograph.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Remove photograph
              </Button>
            )}
          </article>
        ))}
      </div>
      {items.length === 0 && <p className="account-muted">No room photographs uploaded yet.</p>}
      {selected && (
        <div role="region" aria-label="Selected room photograph">
          <Button onClick={() => setSelected(null)}>Close photograph</Button>
          <img
            src={selected.url}
            alt={selected.name}
            style={{ maxWidth: '100%', maxHeight: 600, objectFit: 'contain' }}
          />
        </div>
      )}
    </section>
  );
}
