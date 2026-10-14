'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Layers, UserPlus } from 'lucide-react';
import { Button } from '@roomsell/ui';
import { accountRequest, AccountRequestError, type AccountUser } from '../../components/workspace-frame';

export default function JoinPage() {
  const router = useRouter();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') || '');
    void accountRequest<{ user: AccountUser }>('/api/auth/session')
      .then((session) => setUser(session.user))
      .catch((reason) => {
        if (!(reason instanceof AccountRequestError && reason.status === 401))
          setError(reason instanceof Error ? reason.message : 'Could not check your account.');
      })
      .finally(() => setLoading(false));
  }, []);
  const returnTo = `/join?token=${encodeURIComponent(token)}`;
  return (
    <div className="account-page">
      <Link href="/" className="account-brand">
        <Layers size={25} />
        roomsell<span>AI</span>
      </Link>
      <main className="auth-card">
        <p className="account-eyebrow">ORGANISATION INVITATION</p>
        <h1>Join your team</h1>
        {loading ? (
          <p role="status">Checking your account…</p>
        ) : !token ? (
          <p className="account-error" role="alert">
            The invitation link is missing its token. Ask your colleague for the complete link.
          </p>
        ) : (
          <>
            <p className="account-muted">
              Sign in using the email address this invitation was created for. Invitation links can be
              accepted once and may expire or be revoked.
            </p>
            {user ? (
              <>
                <p className="account-notice">Signed in as {user.email}</p>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      const result = await accountRequest<{ organisationId?: string }>(
                        '/api/invitations/accept',
                        { method: 'POST', body: { token } },
                      );
                      router.replace(
                        result.organisationId
                          ? `/workspace?organisation=${encodeURIComponent(result.organisationId)}&panel=team`
                          : '/workspace',
                      );
                      router.refresh();
                    } catch (reason) {
                      setError(reason instanceof Error ? reason.message : 'Could not accept the invitation.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <UserPlus size={16} />
                  {busy ? 'Joining…' : 'Accept invitation'}
                </Button>
                <Link href={`/auth/login?next=${encodeURIComponent(returnTo)}`} className="account-small">
                  Use another account
                </Link>
              </>
            ) : (
              <div className="account-link-actions">
                <Link
                  className="button button-primary"
                  href={`/auth/login?next=${encodeURIComponent(returnTo)}`}
                >
                  Sign in to accept
                </Link>
                <Link
                  className="button button-secondary"
                  href={`/auth/signup?next=${encodeURIComponent(returnTo)}`}
                >
                  Create an account
                </Link>
              </div>
            )}
          </>
        )}
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
      </main>
    </div>
  );
}
