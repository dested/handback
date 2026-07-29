// One-shot project initializer. After cloning the template, run:
//
//   bun run init <project-name>
//
// It renames the template everywhere (tan-starter / tan_starter / "Tan Starter"),
// writes a fresh `.env` with a new auth secret, and prints next steps. Run it
// once on a clean clone; it only touches git-tracked text files.
//
// Flags:
//   --fresh-git   wipe template git history and start a new repo

import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const c = {
  reset: '\x1b[0m',
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
}

const args = process.argv.slice(2)
const freshGit = args.includes('--fresh-git')
const rawName = args.find((a) => !a.startsWith('--'))

if (!rawName) {
  console.error(c.red('Usage: bun run init <project-name> [--fresh-git]'))
  console.error(c.dim('  project-name must be lowercase letters, numbers, and dashes.'))
  process.exit(1)
}

const name = rawName.trim()
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(c.red(`Invalid name "${name}".`))
  console.error(c.dim('  Use lowercase letters, numbers, and dashes, e.g. "my-app".'))
  process.exit(1)
}
if (name === 'tan-starter') {
  console.error(c.red('Pick a name other than "tan-starter".'))
  process.exit(1)
}

const snake = name.replace(/-/g, '_') // db name / identifiers
const title = name
  .split('-')
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(' ')

// Order matters: most specific first. Each is a plain global substring swap.
const replacements: Array<[RegExp, string]> = [
  [/tan-starter/g, name],
  [/tan_starter/g, snake],
  [/Tan Starter/g, title],
]

// Only rewrite git-tracked files, and never these (binary/lock/self).
const SKIP = new Set(['bun.lock', 'scripts/init.ts', 'public/favicon.svg'])

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !SKIP.has(f) && existsSync(f))

let changed = 0
for (const file of tracked) {
  const before = readFileSync(file, 'utf8')
  let after = before
  for (const [re, to] of replacements) after = after.replace(re, to)
  if (after !== before) {
    writeFileSync(file, after)
    changed++
    console.log(`  ${c.green('renamed')} ${c.dim(file)}`)
  }
}

// Fresh .env with a strong secret (don't clobber an existing one).
if (existsSync('.env')) {
  console.log(`  ${c.dim('kept')}    .env (already exists)`)
} else {
  const secret = randomBytes(32).toString('base64')
  writeFileSync(
    '.env',
    [
      `DATABASE_URL=postgres://postgres:postgres@localhost:5432/${snake}`,
      `BETTER_AUTH_SECRET=${secret}`,
      `BETTER_AUTH_URL=http://localhost:3000`,
      '',
    ].join('\n')
  )
  console.log(`  ${c.green('wrote')}   .env ${c.dim('(fresh BETTER_AUTH_SECRET)')}`)
}

if (freshGit) {
  rmSync('.git', { recursive: true, force: true })
  execFileSync('git', ['init', '-q'])
  console.log(`  ${c.green('reset')}   git history (new repo)`)
}

console.log()
console.log(c.bold(c.green(`✓ Initialized ${title} (${name})`)))
console.log(`  ${changed} file(s) updated.`)
console.log()
console.log(c.bold('Next steps:'))
console.log(
  `  ${c.dim('1.')} createdb ${snake}              ${c.dim('# or point .env at any Postgres')}`
)
console.log(`  ${c.dim('2.')} bun run db:push`)
console.log(`  ${c.dim('3.')} bun run dev                  ${c.dim('# → http://localhost:3000')}`)
console.log()
