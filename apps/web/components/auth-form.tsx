'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Layers, LogIn, UserPlus } from 'lucide-react';
import { Button, Field } from '@roomsell/ui';

export function safeReturnTo(value?: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/workspace';
  try {
    const url = new URL(value, 'https://roomsell.invalid');
    if (
      url.origin !== 'https://roomsell.invalid' ||
      (!['/workspace', '/join'].includes(url.pathname) && !/^\/projects\/[0-9a-f-]{36}$/i.test(url.pathname))
    )
      return '/workspace';
    return `${url.pathname}${url.search}`;
  } catch {
    return '/workspace';
  }
}

export function AuthForm({
  mode,
  returnTo = '/workspace',
  confirmationInvalid = false,
}: {
  mode: 'login' | 'signup';
  returnTo?: string;
  confirmationInvalid?: boolean;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState(false);
  const destination = safeReturnTo(returnTo);
  const alternative = mode === 'login' ? 'signup' : 'login';
  return (
    <div className="account-page">
      <Link href="/" className="account-brand">
        <Layers size={25} /> roomsell<span>AI</span>
      </Link>
      <main className="auth-card">
        <p className="account-eyebrow">ROOM DESIGN WORKSPACE</p>
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="account-muted">
          {mode === 'login'
            ? 'Sign in to your organisation, projects and furniture catalogue.'
            : 'Start a workspace for your team and your customers.'}
        </p>
        {confirmationInvalid && (
          <p className="account-notice" role="status">
            This email confirmation link is invalid or expired. Check the latest confirmation email and try
            its link again.
          </p>
        )}
        {confirmation ? (
          <div className="account-notice" role="status">
            <h2>Check your email</h2>
            <p>
              Confirm your email address before signing in. Your workspace will be ready after confirmation.
            </p>
            <Link
              className="button button-primary"
              href={`/auth/login?next=${encodeURIComponent(destination)}`}
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <form
            className="account-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!ready || busy) return;
              setBusy(true);
              setError('');
              try {
                const response = await fetch(`/api/auth/${mode}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    email: email.trim(),
                    password,
                    ...(mode === 'signup' ? { displayName: displayName.trim() } : {}),
                  }),
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Could not sign in. Please try again.');
                if (mode === 'signup' && data.requiresEmailConfirmation) {
                  setConfirmation(true);
                  setPassword('');
                } else {
                  router.push(destination);
                  router.refresh();
                }
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : 'Unable to continue.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {mode === 'signup' && (
              <Field label="Your name">
                <input
                  aria-label="Your name"
                  autoComplete="name"
                  value={displayName}
                  required
                  maxLength={100}
                  disabled={busy || !ready}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </Field>
            )}
            <Field label="Email address">
              <input
                aria-label="Email address"
                type="email"
                autoComplete="email"
                value={email}
                required
                maxLength={254}
                disabled={busy || !ready}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label="Password">
              <input
                aria-label="Password"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                required
                minLength={mode === 'signup' ? 12 : 1}
                maxLength={128}
                disabled={busy || !ready}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            {mode === 'signup' && <p className="account-muted account-small">Use at least 12 characters.</p>}
            {error && (
              <p className="account-error" role="alert">
                {error}
              </p>
            )}
            <Button variant="primary" disabled={busy || !ready} type="submit">
              {mode === 'login' ? <LogIn size={16} /> : <UserPlus size={16} />}
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        )}
        <p className="auth-switch">
          {mode === 'login' ? 'New to RoomSell?' : 'Already have an account?'}{' '}
          <Link href={`/auth/${alternative}?next=${encodeURIComponent(destination)}`}>
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </Link>
        </p>
        {mode === 'login' && (
          <p>
            <Link href="/auth/forgot-password">Forgot your password?</Link>
          </p>
        )}
        <Link href="/demo" className="account-small account-muted">
          Explore the synthetic furniture demo
        </Link>
      </main>
    </div>
  );
}
