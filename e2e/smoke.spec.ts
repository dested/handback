import { expect, test } from '@playwright/test'

// Fixed user — the DB is truncated in global-setup, so this is deterministic
// across runs (stable screenshots).
const USER = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'password123' }

test('home page renders for a signed-out visitor', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Inloop' })).toBeVisible()
  // Two "Sign in" links exist (nav + prose); the nav one is exact-cased.
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page).toHaveScreenshot('home.png', { fullPage: true })
})

test('sign-up page renders', async ({ page }) => {
  await page.goto('/sign-up')
  // CardTitle renders a <div>, not a heading role.
  await expect(page.getByText('Create account', { exact: true })).toBeVisible()
  await expect(page).toHaveScreenshot('sign-up.png', { fullPage: true })
})

test('unknown route returns a 404 with the not-found page', async ({ page }) => {
  const res = await page.goto('/this-page-does-not-exist')
  expect(res?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
  await expect(page).toHaveScreenshot('not-found.png', { fullPage: true })
})

test('sign up → dashboard → create post → sign out', async ({ page }) => {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill(USER.name)
  await page.getByLabel('Email').fill(USER.email)
  await page.getByLabel('Password').fill(USER.password)
  await page.getByRole('button', { name: 'Sign up' }).click()

  await page.waitForURL('**/dashboard')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText('No posts yet — be the first.')).toBeVisible()
  await expect(page).toHaveScreenshot('dashboard-empty.png', { fullPage: true })

  // Create a post and confirm it shows up (functional, not screenshotted —
  // the post date is dynamic).
  await page.getByLabel('Title').fill('Hello world')
  await page.getByLabel('Content').fill('My first post on the new stack.')
  await page.getByRole('button', { name: 'Post' }).click()
  await expect(page.getByText('Hello world')).toBeVisible()
  await expect(page.getByText('My first post on the new stack.')).toBeVisible()

  // Sign out returns to the signed-out home.
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
})
