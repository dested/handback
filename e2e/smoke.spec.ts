import { expect, test } from '@playwright/test'

// Fixed user — the DB is truncated in global-setup, so this is deterministic
// across runs (stable screenshots).
const USER = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'password123' }

test('landing page renders for a signed-out visitor', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /Your agents ship\. The last word is yours\./ })
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
  // Fonts arrive from Google Fonts; give the render a beat before the pixel diff.
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveScreenshot('home.png', { fullPage: true })
})

test('sign-up page renders', async ({ page }) => {
  await page.goto('/sign-up')
  await expect(page.getByText('Create your account', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveScreenshot('sign-up.png', { fullPage: true })
})

test('unknown route returns a 404 with the not-found page', async ({ page }) => {
  const res = await page.goto('/this-page-does-not-exist')
  expect(res?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
})

test('sign up → create org → empty inbox → team + projects render', async ({ page }) => {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill(USER.name)
  await page.getByLabel('Email').fill(USER.email)
  await page.getByLabel('Password').fill(USER.password)
  await page.getByRole('button', { name: 'Create account' }).click()

  // Fresh users land in the inbox's first-run state and name their workspace.
  await page.waitForURL('**/app')
  await page.getByLabel('Organization name').fill('Ada Industries')
  await page.getByRole('button', { name: /create/i }).click()

  // The empty inbox teaches both halves: getting a gripe in, and getting one out.
  await expect(page.getByText('No gripes yet', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Set up the recorder' })).toBeVisible()

  // A workspace no agent has reached yet gets the connect prompt, and it leads
  // to a copy-paste-complete command. This is the whole onboarding path for the
  // person who actually fixes things, so it's worth a click-through.
  await expect(page.getByText("Are you the engineer who's going to fix these?")).toBeVisible()
  await page.getByRole('link', { name: 'Connect an agent' }).click()
  await page.waitForURL('**/connect')
  await expect(page.getByRole('heading', { name: 'Connect your coding agent' })).toBeVisible()
  await expect(page.getByText('claude mcp add --transport http handback')).toBeVisible()
  // Nothing has called in yet, so step 03 must not claim otherwise.
  await expect(page.getByText('No token yet', { exact: false })).toBeVisible()

  // Team: the member list shows the owner.
  await page.getByRole('link', { name: 'Team', exact: true }).click()
  await expect(page.getByText(USER.email).first()).toBeVisible()

  // Projects: the create form renders.
  await page.getByRole('link', { name: 'Projects' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()

  // Sign out returns to the signed-out landing.
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
})
