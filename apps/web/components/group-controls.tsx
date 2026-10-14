'use client';
import { useState } from 'react';
import { Layers, LockKeyhole, Trash2, Unlock } from 'lucide-react';
import { Button, Field } from '@roomsell/ui';
import { useEditor } from '../lib/editor-store';

export function GroupControls({ readOnly = false }: { readOnly?: boolean }) {
  const { scene, busy, proposal, preview } = useEditor();
  const [name, setName] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  if (!scene) return null;
  const disabled = readOnly || busy || Boolean(proposal);
  const assigned = new Set(scene.groups.flatMap((group) => group.objectIds));
  return (
    <details className="editor-details group-controls">
      <summary>
        <Layers size={14} /> Rigid furniture groups <span>{scene.groups.length}</span>
      </summary>
      <p className="editor-help">
        Members move and rotate together in both editing modes. Individual locks still apply. A locked group
        keeps every member in place.
      </p>
      <ul className="editor-feature-list">
        {scene.groups.map((group) => (
          <li key={group.id}>
            <div>
              <strong>{group.name}</strong>
              <small>
                {group.objectIds.length} members · {group.locked ? 'locked' : 'unlocked'}
              </small>
            </div>
            <Button
              disabled={disabled}
              aria-label={`${group.locked ? 'Unlock' : 'Lock'} group ${group.name}`}
              aria-pressed={group.locked}
              onClick={() =>
                void preview({ type: 'group', group: { ...group, locked: !group.locked } }, true)
              }
            >
              {group.locked ? <LockKeyhole size={14} /> : <Unlock size={14} />}
            </Button>
            <Button
              disabled={disabled}
              aria-label={`Remove group ${group.name}`}
              onClick={() => void preview({ type: 'group-remove', groupId: group.id }, true)}
            >
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="editor-control-form"
        onSubmit={(event) => {
          event.preventDefault();
          void preview(
            {
              type: 'group',
              group: {
                id: `group-${crypto.randomUUID()}`,
                name: name.trim(),
                objectIds: ids.filter((id) => !assigned.has(id)),
                locked: false,
              },
            },
            true,
          );
          setName('');
          setIds([]);
        }}
      >
        <Field label="Group name">
          <input
            aria-label="Group name"
            value={name}
            maxLength={100}
            required
            disabled={disabled}
            placeholder="Bed and bedside tables"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <fieldset disabled={disabled} className="editor-group-members">
          <legend>Choose at least two pieces</legend>
          {scene.objects.map((object) => (
            <label key={object.id} className="editor-check-label">
              <input
                type="checkbox"
                checked={ids.includes(object.id) && !assigned.has(object.id)}
                disabled={assigned.has(object.id)}
                onChange={(event) =>
                  setIds((previous) =>
                    event.target.checked
                      ? [...previous, object.id]
                      : previous.filter((id) => id !== object.id),
                  )
                }
              />
              {object.name}
              {assigned.has(object.id) && <small>already grouped</small>}
            </label>
          ))}
        </fieldset>
        <Button
          type="submit"
          className="full-width"
          disabled={disabled || ids.filter((id) => !assigned.has(id)).length < 2}
        >
          <Layers size={14} /> Create rigid group
        </Button>
      </form>
    </details>
  );
}
