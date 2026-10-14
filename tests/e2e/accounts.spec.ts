import { expect, test, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';

function account(name: string) {
  return {
    name,
    email: `${name.toLowerCase().replaceAll(' ', '-')}-${randomUUID()}@example.test`,
    password: randomBytes(24).toString('base64url'),
  };
}
async function signup(page: Page, person: ReturnType<typeof account>) {
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill(person.name);
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(person.email);
  await page.getByLabel('Password', { exact: true }).fill(person.password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
}
async function createOrganisation(page: Page, name: string) {
  await page.getByRole('textbox', { name: 'Organisation name', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create organisation', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('account, organisation, invitation acceptance and role management work through the browser', async ({
  page,
  browser,
}) => {
  const owner = account('Studio owner');
  const colleague = account('Studio designer');
  const studio = `Studio ${randomUUID().slice(0, 8)}`;
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/auth/signup');
  await signup(page, owner);
  await expect(
    page.getByRole('heading', { name: 'Create your first organisation', exact: true }),
  ).toBeVisible();
  await createOrganisation(page, studio);
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: `Role for ${owner.email}`, exact: true }).selectOption('designer');
  await expect(page.locator('.account-error[role="alert"]')).toContainText(/owner/i);
  await expect(page.getByRole('combobox', { name: `Role for ${owner.email}`, exact: true })).toHaveValue(
    'owner',
  );
  await page.getByRole('button', { name: `Remove member ${owner.email}`, exact: true }).click();
  await page.getByRole('button', { name: `Confirm remove ${owner.email}`, exact: true }).click();
  await expect(page.locator('.account-error[role="alert"]')).toContainText(/owner/i);
  await page.getByRole('button', { name: `Cancel removal for ${owner.email}`, exact: true }).click();
  await page.getByRole('textbox', { name: 'Invitation email', exact: true }).fill(colleague.email);
  await page.getByRole('combobox', { name: 'Invitation role', exact: true }).selectOption('designer');
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Invitation link', exact: true })).toBeVisible();
  const url = new URL(await page.getByRole('textbox', { name: 'Invitation link', exact: true }).inputValue());
  const invitationPath = `${url.pathname}${url.search}`;
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const invitedPage = await context.newPage();
  try {
    await invitedPage.goto(invitationPath);
    await invitedPage.getByRole('link', { name: 'Create an account', exact: true }).click();
    await signup(invitedPage, colleague);
    await expect(invitedPage.getByRole('button', { name: 'Accept invitation', exact: true })).toBeVisible();
    await invitedPage.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(invitedPage.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
    await expect(invitedPage.getByRole('combobox', { name: 'Organisation', exact: true })).toHaveValue(
      new URL(page.url()).searchParams.get('organisation')!,
    );
    await expect(invitedPage.getByRole('button', { name: 'Create invitation', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole('combobox', { name: `Role for ${colleague.email}`, exact: true }),
    ).toBeVisible();
    await page
      .getByRole('combobox', { name: `Role for ${colleague.email}`, exact: true })
      .selectOption('salesperson');
    await expect(
      page.getByRole('combobox', { name: `Role for ${colleague.email}`, exact: true }),
    ).toHaveValue('salesperson');
    await invitedPage.reload();
    await expect(invitedPage.locator('.account-role').first()).toHaveText('salesperson');
    await invitedPage.goto(invitationPath);
    await invitedPage.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(invitedPage.locator('.account-error[role="alert"]')).toBeVisible();
    await page.getByRole('button', { name: `Remove member ${colleague.email}`, exact: true }).click();
    await page.getByRole('button', { name: `Confirm remove ${colleague.email}`, exact: true }).click();
    await expect(
      page.getByRole('combobox', { name: `Role for ${colleague.email}`, exact: true }),
    ).toHaveCount(0);
    await invitedPage.goto('/workspace');
    await expect(
      invitedPage.getByRole('heading', { name: 'Create your first organisation', exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
  expect(pageErrors).toEqual([]);
});

test('invitation links reject a different email and can be revoked', async ({ page, browser }) => {
  const owner = account('Invitation owner');
  const outsider = account('Wrong email');
  await page.goto('/auth/signup');
  await signup(page, owner);
  await createOrganisation(page, `Invitations ${randomUUID().slice(0, 8)}`);
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  const invitedEmail = `intended-${randomUUID()}@example.test`;
  await page.getByRole('textbox', { name: 'Invitation email', exact: true }).fill(invitedEmail);
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const url = new URL(await page.getByRole('textbox', { name: 'Invitation link', exact: true }).inputValue());
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const outsiderPage = await context.newPage();
  try {
    await outsiderPage.goto('/auth/signup');
    await signup(outsiderPage, outsider);
    await expect(
      outsiderPage.getByRole('heading', { name: 'Create your first organisation', exact: true }),
    ).toBeVisible();
    await outsiderPage.goto(`${url.pathname}${url.search}`);
    await outsiderPage.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(outsiderPage.locator('.account-error[role="alert"]')).toContainText(/email|invitation/i);
    await page.getByRole('button', { name: `Revoke invitation for ${invitedEmail}`, exact: true }).click();
    await expect(page.getByRole('table', { name: 'Organisation invitations', exact: true })).toContainText(
      'Revoked',
    );
  } finally {
    await context.close();
  }
});

test('sign out, sign in and mobile organisation controls remain usable', async ({ page }) => {
  const person = account('Mobile owner');
  const studio = `Mobile ${randomUUID().slice(0, 8)}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/auth/signup');
  await signup(page, person);
  await createOrganisation(page, studio);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(person.email);
  await page.getByLabel('Password', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.account-error[role="alert"]')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(person.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: studio, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
