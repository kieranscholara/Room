'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Building2, Layers, LogOut, Users } from 'lucide-react';
import { Button, Field } from '@roomsell/ui';
import { OrganisationPanel } from './organisation-panel';
import { TeamPanel } from './team-panel';

export type OrganisationRole = 'owner' | 'admin' | 'salesperson' | 'designer' | 'customer';
export interface AccountUser {
  id: string;
  email: string;
}
export interface Organisation {
  id: string;
  name: string;
  currency: string;
  role: OrganisationRole;
}
export interface WorkspaceContext {
  user: AccountUser;
  organisation: Organisation;
  organisations: Organisation[];
  canManage: boolean;
  refreshOrganisations(): Promise<void>;
}
export interface WorkspacePanel {
  id: string;
  label: string;
  roles?: OrganisationRole[];
  render(context: WorkspaceContext): ReactNode;
}
export class AccountRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function accountRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method || 'GET',
    cache: 'no-store',
    signal: options.signal,
    ...(options.body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new AccountRequestError(data.error || 'The request could not be completed.', response.status);
  return data as T;
}

export function WorkspaceFrame({ panels = [] }: { panels?: WorkspacePanel[] }) {
  const router = useRouter();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [panel, setPanel] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false);
  const organisation = organisations.find((item) => item.id === selectedId) ?? null;
  const saveSelection = useCallback((id: string, nextPanel: string) => {
    setSelectedId(id);
    setPanel(nextPanel);
    try {
      localStorage.setItem('roomsell-organisation', id);
    } catch {
      /* Selection still survives in the URL when browser storage is unavailable. */
    }
    const query = new URLSearchParams({ ...(id ? { organisation: id } : {}), panel: nextPanel });
    window.history.replaceState(null, '', `/workspace?${query.toString()}`);
  }, []);
  const refreshOrganisations = useCallback(async () => {
    const result = await accountRequest<Organisation[]>('/api/organisations');
    setOrganisations(result);
    if (!result.some((item) => item.id === selectedId)) saveSelection(result[0]?.id || '', 'overview');
  }, [selectedId, saveSelection]);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const session = await accountRequest<{ user: AccountUser }>('/api/auth/session');
      const result = await accountRequest<Organisation[]>('/api/organisations');
      setUser(session.user);
      setOrganisations(result);
      const query = new URLSearchParams(window.location.search);
      let remembered = '';
      try {
        remembered = localStorage.getItem('roomsell-organisation') || '';
      } catch {
        /* URL/default organisation remain usable. */
      }
      const requestedId = query.get('organisation') || remembered;
      const chosen = result.find((item) => item.id === requestedId)?.id || result[0]?.id || '';
      const requestedPanel = query.get('panel') || 'overview';
      saveSelection(chosen, requestedPanel);
    } catch (reason) {
      if (reason instanceof AccountRequestError && reason.status === 401) router.replace('/auth/login');
      else setError(reason instanceof Error ? reason.message : 'Could not open your workspace.');
    } finally {
      setLoading(false);
    }
  }, [router, saveSelection]);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading || !user)
    return (
      <main className="account-loading" role="status">
        {error || 'Opening your workspace…'}
        {error && <Button onClick={() => void load()}>Retry</Button>}
      </main>
    );
  const context = organisation
    ? {
        user,
        organisation,
        organisations,
        canManage: ['owner', 'admin'].includes(organisation.role),
        refreshOrganisations,
      }
    : null;
  const visiblePanels = panels.filter(
    (item) => !item.roles || (organisation && item.roles.includes(organisation.role)),
  );
  const extraPanel = visiblePanels.find((item) => item.id === panel);
  return (
    <div className="business-shell">
      <header className="business-header">
        <Link href="/workspace" className="account-brand">
          <Layers size={25} /> roomsell<span>AI</span>
        </Link>
        <Link href="/marketplace" className="business-text-link">
          Consumer marketplace
        </Link>
        <span className="account-session">{user.email}</span>
        <Button
          disabled={logoutBusy}
          onClick={async () => {
            setLogoutBusy(true);
            setError('');
            try {
              await accountRequest('/api/auth/logout', { method: 'POST', body: {} });
              router.replace('/auth/login');
              router.refresh();
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Could not sign out.');
            } finally {
              setLogoutBusy(false);
            }
          }}
        >
          <LogOut size={15} />
          {logoutBusy ? 'Signing out…' : 'Sign out'}
        </Button>
      </header>
      <div className="business-body">
        <aside className="business-sidebar" aria-label="Workspace navigation">
          <Field label="Organisation">
            <select
              aria-label="Organisation"
              value={selectedId}
              disabled={!organisations.length}
              onChange={(event) => saveSelection(event.target.value, panel)}
            >
              {!organisations.length && <option value="">No organisations yet</option>}
              {organisations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          {organisation && <span className="account-role">{organisation.role}</span>}
          <nav>
            <button
              className={panel === 'overview' ? 'active' : ''}
              onClick={() => saveSelection(selectedId, 'overview')}
              aria-current={panel === 'overview' ? 'page' : undefined}
            >
              <Building2 size={16} />
              Workspace
            </button>
            <button
              disabled={!organisation}
              className={panel === 'team' ? 'active' : ''}
              onClick={() => saveSelection(selectedId, 'team')}
              aria-current={panel === 'team' ? 'page' : undefined}
            >
              <Users size={16} />
              Team
            </button>
            {visiblePanels.map((item) => (
              <button
                key={item.id}
                disabled={!organisation}
                className={panel === item.id ? 'active' : ''}
                aria-current={panel === item.id ? 'page' : undefined}
                onClick={() => saveSelection(selectedId, item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <Link href="/demo" className="business-demo-link">
            Open synthetic editor demo
          </Link>
        </aside>
        <main className="business-main">
          {error && (
            <p className="account-error" role="alert">
              {error}
            </p>
          )}
          {!organisation || panel === 'overview' || (!extraPanel && panel !== 'team') ? (
            <OrganisationPanel
              organisation={organisation}
              onCreated={async (created) => {
                await refreshOrganisations();
                saveSelection(created.id, 'overview');
              }}
            />
          ) : panel === 'team' && context ? (
            <TeamPanel key={organisation.id} context={context} />
          ) : (
            context && extraPanel && <div key={organisation.id}>{extraPanel.render(context)}</div>
          )}
        </main>
      </div>
    </div>
  );
}
