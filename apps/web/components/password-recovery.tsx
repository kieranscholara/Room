'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Field } from '@roomsell/ui';

export function PasswordRecovery({ mode }: { mode: 'request' | 'reset' }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  return (
    <div className="account-page">
      <main className="auth-card">
        <h1>{mode === 'request' ? 'Recover your account' : 'Choose a new password'}</h1>
        <p className="account-muted">
          {mode === 'request'
            ? 'Open the recovery email in this browser to choose a new password.'
            : 'Use at least 12 characters. A valid recovery session is required.'}
        </p>
        {message ? (
          <p role="status">{message}</p>
        ) : (
          <form
            className="account-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || !ready) return;
              setError('');
              if (mode === 'reset' && password !== confirmation) {
                setError('The passwords must match.');
                return;
              }
              setBusy(true);
              try {
                const response = await fetch(
                  mode === 'request' ? '/api/auth/recover' : '/api/auth/password',
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(mode === 'request' ? { email: email.trim() } : { password }),
                  },
                );
                const result = await response.json();
                if (!response.ok)
                  throw new Error(
                    response.status === 401
                      ? 'This recovery session has expired. Request a new link.'
                      : result.error || 'Unable to continue.',
                  );
                setMessage(
                  mode === 'request' ? result.message : 'Password updated. Sign in with your new password.',
                );
                setPassword('');
                setConfirmation('');
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : 'Unable to continue.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {mode === 'request' ? (
              <Field label="Email address">
                <input
                  aria-label="Email address"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  disabled={busy || !ready}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
            ) : (
              <>
                <Field label="New password">
                  <input
                    aria-label="New password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    disabled={busy || !ready}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
                <Field label="Confirm new password">
                  <input
                    aria-label="Confirm new password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    disabled={busy || !ready}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </Field>
              </>
            )}
            {error && (
              <p role="alert" className="account-error">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={busy || !ready}>
              {busy ? 'Please wait…' : mode === 'request' ? 'Send recovery email' : 'Update password'}
            </Button>
          </form>
        )}
        <p>
          <Link href="/auth/login">Return to sign in</Link>
        </p>
        {mode === 'reset' && (
          <p>
            <Link href="/auth/forgot-password">Request a new recovery link</Link>
          </p>
        )}
      </main>
    </div>
  );
}
