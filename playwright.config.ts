import { defineConfig, devices } from '@playwright/test'

// E2E runs against an isolated test database on a dedicated port so it never
// touches your dev DB or dev server. `bun run test:e2e` boots the app itself
// (see `webServer`) and `global-setup.ts` truncates the test DB first so screen-
// shots are deterministic. Override the DB with E2E_DATABASE_URL if needed.
const PORT = 3100
const baseURL = `http://localhost:${PORT}`
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/handback_test'

// The server's env schema requires S3 credentials at boot; e2e never uploads,
// so dummies are fine (any test that touched S3 would fail loudly instead).
const S3_ENV = {
  AWS_REGION: process.env.AWS_REGION ?? 'us-west-2',
  S3_BUCKET: process.env.S3_BUCKET ?? 'handback-files',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'e2e-dummy',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'e2e-dummy',
}

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  // Screenshots are pixel-compared; baselines live in e2e/__screenshots__ and
  // are committed. They are OS/font specific — regenerate on the same platform
  // your CI uses (`bun run test:e2e:update`).
  snapshotPathTemplate: 'e2e/__screenshots__/{testFileName}/{arg}{ext}',
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun server.ts',
    url: `${baseURL}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    env: {
      PORT: String(PORT),
      NODE_ENV: 'development',
      DATABASE_URL,
      BETTER_AUTH_SECRET: 'e2e-secret-at-least-32-characters-long!!',
      BETTER_AUTH_URL: baseURL,
      ...S3_ENV,
    },
  },
})
