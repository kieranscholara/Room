'use client';
import { useCallback, useEffect, useState } from 'react';
import { Copy, Plus, ShieldCheck, Users, X } from 'lucide-react';
import { Button, Field } from '@roomsell/ui';
import { accountRequest, type OrganisationRole, type WorkspaceContext } from './workspace-frame';

interface Member {
  userId: string;
  email: string;
  displayName: string | null;
  role: OrganisationRole;
}
interface Invitation {
  id: string;
  email: string;
  role: OrganisationRole;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}
const roles: OrganisationRole[] = ['owner', 'admin', 'salesperson', 'designer', 'customer'];
function readableDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Malta',
  }).format(new Date(value));
}

export function TeamPanel({ context }: { context: WorkspaceContext }) {
  const { organisation, user, canManage } = context;
  const base = `/api/organisations/${encodeURIComponent(organisation.id)}`;
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrganisationRole>('designer');
  const [newLink, setNewLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [message, setMessage] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [memberData, invitationData] = await Promise.all([
        canManage
          ? accountRequest<Member[]>(`${base}/members`)
          : Promise.resolve([
              { userId: user.id, email: user.email, displayName: null, role: organisation.role },
            ]),
        canManage ? accountRequest<Invitation[]>(`${base}/invitations`) : Promise.resolve([]),
      ]);
      setMembers(memberData);
      setInvitations(invitationData);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load your team.');
    } finally {
      setLoading(false);
    }
  }, [base, canManage, user.id, user.email, organisation.role]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (task: () => Promise<void>, reload = true) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
      if (reload) await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update the team.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="account-panel" aria-label="Team management">
      <div className="account-panel-heading">
        <Users size={23} />
        <div>
          <h1>Team</h1>
          <p className="account-muted">{organisation.name} · Members and access roles</p>
        </div>
      </div>
      <p className="account-muted">
        <ShieldCheck size={14} className="account-inline-icon" />
        Owners and admins manage access. Designers and salespeople work on designs; customers see their
        assigned projects.
      </p>
      {error && (
        <p className="account-error" role="alert">
          {error}
          <Button
            disabled={busy}
            onClick={() => {
              setError('');
              void load();
            }}
          >
            Reload team
          </Button>
        </p>
      )}
      {message && (
        <p className="account-notice" role="status">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status" className="account-muted">
          Loading team…
        </p>
      ) : (
        <div className="account-table-scroll">
          <table className="account-table">
            <caption>Organisation members</caption>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                {canManage && <th>Access</th>}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId}>
                  <td>
                    {member.displayName || 'Member'}
                    {member.userId === user.id && <span className="account-tag">You</span>}
                  </td>
                  <td>{member.email}</td>
                  <td>
                    {canManage ? (
                      <select
                        aria-label={`Role for ${member.email}`}
                        value={member.role}
                        disabled={busy || (member.role === 'owner' && organisation.role !== 'owner')}
                        onChange={(event) => {
                          const next = event.target.value as OrganisationRole;
                          void run(async () => {
                            await accountRequest(`${base}/members`, {
                              method: 'PATCH',
                              body: { userId: member.userId, role: next },
                            });
                            if (member.userId === user.id) {
                              setMembers((previous) =>
                                previous.map((item) =>
                                  item.userId === member.userId ? { ...item, role: next } : item,
                                ),
                              );
                              await context.refreshOrganisations();
                            }
                            setMessage(`Role updated for ${member.email}.`);
                          }, member.userId !== user.id);
                        }}
                      >
                        {roles.map((value) => (
                          <option
                            key={value}
                            value={value}
                            disabled={value === 'owner' && organisation.role !== 'owner'}
                          >
                            {value}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="account-role">{member.role}</span>
                    )}
                  </td>
                  {canManage && (
                    <td>
                      {confirmRemove === member.userId ? (
                        <div className="account-remove-confirm">
                          <p>Remove {member.email}'s organisation access?</p>
                          <Button
                            variant="danger"
                            disabled={busy}
                            aria-label={`Confirm remove ${member.email}`}
                            onClick={() =>
                              void run(async () => {
                                await accountRequest(
                                  `${base}/members?userId=${encodeURIComponent(member.userId)}`,
                                  { method: 'DELETE' },
                                );
                                setConfirmRemove(null);
                                if (member.userId === user.id) await context.refreshOrganisations();
                                setMessage(`Organisation access removed for ${member.email}.`);
                              }, member.userId !== user.id)
                            }
                          >
                            Confirm removal
                          </Button>
                          <Button
                            disabled={busy}
                            aria-label={`Cancel removal for ${member.email}`}
                            onClick={() => setConfirmRemove(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          disabled={busy || (member.role === 'owner' && organisation.role !== 'owner')}
                          aria-label={`Remove member ${member.email}`}
                          onClick={() => setConfirmRemove(member.userId)}
                        >
                          Remove
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && (
        <>
          <section className="account-invitation-form" aria-label="Invite a colleague">
            <h2>Invite a colleague or customer</h2>
            <p className="account-muted">
              Create a private invitation link and share it with the intended person. No email is sent by this
              workspace.
            </p>
            <form
              className="account-form account-form-inline"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const created = await accountRequest<{ id: string; url: string; expiresAt: string }>(
                    `${base}/invitations`,
                    { method: 'POST', body: { email: email.trim(), role } },
                  );
                  setNewLink(created);
                  setCopyStatus('');
                  setEmail('');
                });
              }}
            >
              <Field label="Invitation email">
                <input
                  aria-label="Invitation email"
                  type="email"
                  value={email}
                  required
                  maxLength={254}
                  disabled={busy}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              <Field label="Invitation role">
                <select
                  aria-label="Invitation role"
                  value={role}
                  disabled={busy}
                  onChange={(event) => setRole(event.target.value as OrganisationRole)}
                >
                  {roles
                    .filter((value) => value !== 'owner')
                    .map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                </select>
              </Field>
              <Button variant="primary" type="submit" disabled={busy}>
                <Plus size={15} />
                Create invitation
              </Button>
            </form>
          </section>
          {newLink && (
            <div className="account-notice invitation-link-box" role="status">
              <h3>Invitation link ready</h3>
              <p>
                This one-time link can be accepted by the invited email address. It expires{' '}
                {readableDate(newLink.expiresAt)} (Malta time). Copy it now; existing invitation tokens cannot
                be retrieved later.
              </p>
              <Field label="Invitation link">
                <input aria-label="Invitation link" value={newLink.url} readOnly />
              </Field>
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(newLink.url);
                    setCopyStatus('Invitation link copied.');
                  } catch {
                    setCopyStatus('Select and copy the invitation link above.');
                  }
                }}
              >
                <Copy size={15} />
                Copy invitation link
              </Button>
              {copyStatus && <p>{copyStatus}</p>}
            </div>
          )}
          <h2>Invitations</h2>
          {!invitations.length ? (
            <p className="account-muted">No invitations have been created.</p>
          ) : (
            <div className="account-table-scroll">
              <table className="account-table">
                <caption>Organisation invitations</caption>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((invitation) => {
                    const status = invitation.acceptedAt
                      ? 'Accepted'
                      : invitation.revokedAt
                        ? 'Revoked'
                        : Date.parse(invitation.expiresAt) < Date.now()
                          ? 'Expired'
                          : 'Pending';
                    return (
                      <tr key={invitation.id}>
                        <td>{invitation.email}</td>
                        <td>{invitation.role}</td>
                        <td>{status}</td>
                        <td>
                          {status === 'Pending' && (
                            <Button
                              disabled={busy}
                              aria-label={`Revoke invitation for ${invitation.email}`}
                              onClick={() =>
                                void run(async () => {
                                  await accountRequest(
                                    `${base}/invitations?id=${encodeURIComponent(invitation.id)}`,
                                    { method: 'DELETE' },
                                  );
                                  setNewLink(null);
                                  setMessage('Invitation revoked.');
                                })
                              }
                            >
                              <X size={14} />
                              Revoke
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
