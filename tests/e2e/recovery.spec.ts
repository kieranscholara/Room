import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { localTestPreflight } from '../../scripts/test-preflight.mjs';

test('recovers an account through captured mail, rejects replay and requires authenticated password changes', async ({
  page,
  browser,
}) => {
  const status = await localTestPreflight();
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const mailbox = 'recovery-' + randomUUID(),
    email = mailbox + '@roomsell.test';
  const originalPassword = randomBytes(24).toString('base64url'),
    newPassword = randomBytes(24).toString('base64url');
  const user = await admin.auth.admin.createUser({ email, password: originalPassword, email_confirm: true });
  expect(user.error).toBeNull();
  const anonymous = await browser.newContext();
  try {
    expect(
      (await anonymous.request.post('/api/auth/password', { data: { password: newPassword } })).status(),
    ).toBe(401);
    expect(
      (
        await anonymous.request.post('/api/auth/recover', {
          headers: { Origin: 'https://unrelated.test' },
          data: { email },
        })
      ).status(),
    ).toBe(403);
    await page.goto('/auth/login');
    await page.getByRole('link', { name: 'Forgot your password?', exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/forgot-password$/);
    await expect(page.getByRole('heading', { name: 'Recover your account', exact: true })).toBeVisible();
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(email);
    await page.getByRole('button', { name: 'Send recovery email', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('If this email has an account');
    let messages: { ID: string }[] = [];
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent('to:' + email)}`,
        );
        messages = (await response.json()).messages;
        return messages.length;
      })
      .toBeGreaterThan(0);
    const message = await (
      await page.request.get(`http://127.0.0.1:54324/api/v1/message/${messages[0].ID}`)
    ).json();
    const link = /href="([^"]+)"/.exec(message.HTML)?.[1]?.replaceAll('&amp;', '&');
    if (!link || new URL(link).origin !== 'http://127.0.0.1:54321')
      throw new Error('Expected the local captured recovery link.');
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible();
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Update password', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Password updated');
    expect((await page.request.get('/api/auth/session')).status()).toBe(401);
    expect(
      (await page.request.post('/api/auth/login', { data: { email, password: originalPassword } })).status(),
    ).toBe(401);
    expect(
      (await page.request.post('/api/auth/login', { data: { email, password: newPassword } })).status(),
    ).toBe(200);
    await page.request.post('/api/auth/logout');
    await page.goto(link);
    await expect(page).toHaveURL(/\/auth\/login\?confirmation=invalid/);
    expect((await page.request.get('/api/auth/session')).status()).toBe(401);
    const unknown = await anonymous.request.post('/api/auth/recover', {
      data: { email: 'unknown-' + randomUUID() + '@roomsell.test' },
    });
    expect(unknown.status()).toBe(200);
    expect((await unknown.json()).message).toContain('If this email has an account');
  } finally {
    await anonymous.close();
    if (user.data.user) await admin.auth.admin.deleteUser(user.data.user.id);
  }
});
