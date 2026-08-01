import { expect, test } from '@playwright/test'

// Fixed user — the DB is truncated in global-setup, so this is deterministic
// across runs (stable screenshots).
const USER = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'password123' }

test('landing page renders for a signed-out visitor', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /Debug and review your app in your own words\./ })
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

test('sign up → personal workspace → empty inbox → tokens + projects render', async ({ page }) => {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill(USER.name)
  await page.getByLabel('Email').fill(USER.email)
  await page.getByLabel('Password').fill(USER.password)
  await page.getByRole('button', { name: 'Create account' }).click()

  // Sign-up auto-creates a personal workspace, so there's no naming step — the
  // switcher in the header is already showing it.
  await page.waitForURL('**/app')
  await expect(page.getByRole('button', { name: 'Workspace' })).toHaveText(/Ada's workspace/)

  // The empty inbox teaches both halves: getting a walkthrough in, and getting one out.
  await expect(page.getByText('No walkthroughs yet', { exact: false })).toBeVisible()
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

  // Tokens are managed on /connect now, not on Team — and a personal workspace
  // has no Team tab at all.
  await expect(page.getByRole('heading', { name: 'Your API tokens' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Team', exact: true })).toHaveCount(0)

  // Projects: the create form renders.
  await page.getByRole('link', { name: 'Projects' }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()

  // Sign out returns to the signed-out landing.
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
})
