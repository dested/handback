import { Client } from 'pg'

// Wipe the test database before the suite so sign-up uses a fresh fixed user
// and screenshots are byte-for-byte reproducible. Runs once per `playwright test`.
export default async function globalSetup() {
  const connectionString =
    process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/inloop_test'
  const client = new Client({ connectionString })
  await client.connect()
  await client.query(
    'TRUNCATE TABLE "org", "session", "account", "verification", "user" RESTART IDENTITY CASCADE'
  )
  await client.end()
}
