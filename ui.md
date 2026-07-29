# inloop — UI / Visual Language

> Source of truth for how this looks and feels. Follow it for anything visual.
> Keep it current as part of finishing a UI change — same discipline as cliffnotes.
> This is a starter's baseline; tighten the north star once the product has one.

## North star

**Clean, neutral, system-native — shadcn/ui "new-york" out of the box.** Think Linear/Vercel-dashboard restraint: lots of whitespace, hairline borders, near-black-on-white, one job per screen. Failure looks like (a) too sterile → no hierarchy, walls of muted text; (b) too toy → gratuitous color, heavy shadows, rounded-everything. This template ships intentionally unopinionated so a real brand can be layered on by editing tokens in `src/styles/app.css`.

1. **Tokens over hardcoded values** — color/radius come from CSS variables; never hardcode hex.
2. **Borders, not shadows** — separation via 1px `border` + subtle `shadow-xs/sm`, not big elevation.
3. **Muted by default, ink for signal** — body copy is `text-muted-foreground`; headings/primary actions are full-contrast.
4. **Contained width** — content sits in a centered `max-w-5xl` column.

## Tokens

Defined as CSS variables in `src/styles/app.css` (`:root` + `.dark`), exposed to Tailwind via `@theme inline`. Light + dark are both defined; dark activates under `.dark` (no toggle wired yet). All colors are **oklch**.

### Color

| Token          | Tailwind class                           | Use                                      |
| -------------- | ---------------------------------------- | ---------------------------------------- |
| Background     | `bg-background`                          | page canvas (`oklch(1 0 0)` light)       |
| Foreground     | `text-foreground`                        | primary text (`oklch(0.145 0 0)`)        |
| Card           | `bg-card`                                | panels/cards                             |
| Muted fg       | `text-muted-foreground`                  | secondary text, descriptions             |
| Primary        | `bg-primary` / `text-primary-foreground` | primary buttons (near-black)             |
| Secondary      | `bg-secondary`                           | subtle surfaces                          |
| Accent         | `bg-accent`                              | hover surfaces                           |
| Destructive    | `text-destructive` / `bg-destructive`    | errors, dangerous actions                |
| Border / Input | `border`, `border-input`                 | hairlines, field borders                 |
| Ring           | `ring-ring`                              | focus rings (`focus-visible:ring-[3px]`) |

Accent discipline: there is **no brand accent** by default — primary is neutral near-black. Introduce a brand color by overriding `--primary` (and friends) in `app.css`, not by sprinkling Tailwind palette classes (`bg-blue-500`) in components.

### Typography

| Role            | Class                                        | Use                              |
| --------------- | -------------------------------------------- | -------------------------------- |
| Display/title   | `text-4xl font-bold tracking-tight`          | page H1 (home)                   |
| Page heading    | `text-3xl font-bold tracking-tight`          | section H1 (dashboard)           |
| Section heading | `text-xl font-semibold`                      | subsections                      |
| Card title      | `CardTitle` (`font-semibold tracking-tight`) | renders a `<div>`, not a heading |
| Body            | default / `text-sm`                          | content                          |
| Muted/label     | `text-sm text-muted-foreground`              | descriptions, eyebrows           |

Font: system stack (`ui-sans-serif, system-ui, sans-serif`) set on `body` — no web font loaded.

### Spacing, shape, elevation

| Token           | Value                                                               | Use                       |
| --------------- | ------------------------------------------------------------------- | ------------------------- |
| Page container  | `mx-auto max-w-5xl px-6 py-8`                                       | main content column       |
| Auth card width | `mx-auto max-w-sm`                                                  | sign-in/up                |
| Vertical rhythm | `space-y-8` (sections), `space-y-4` (forms), `space-y-2` (fields)   |                           |
| Radius          | `--radius: 0.625rem`; `rounded-md` (controls), `rounded-xl` (cards) | scale derived in `@theme` |
| Elevation       | `shadow-xs` (buttons/inputs), `shadow-sm` (cards)                   | keep shadows minimal      |

## Layout

App shell is `src/app/layout.tsx`: a bordered `header` with a `max-w-5xl` nav (logo · Dashboard link · auth links/email+sign-out on the right), then `<main class="mx-auto max-w-5xl px-6 py-8"><Outlet/></main>`. Page anatomy: H1 + muted subtitle → content sections (`space-y-8`), often a grid of `Card`s (`grid gap-4 md:grid-cols-2`). Empty states are a single muted line (e.g. "No posts yet — be the first.").

## Components

Reuse these shadcn primitives — don't hand-roll. They take `className` (merged via `cn()`), no `asChild`.

| Component                   | File                           | Notes                                                                                 |
| --------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `Button` + `buttonVariants` | `src/components/ui/button.tsx` | variants: default/destructive/outline/secondary/ghost/link; sizes: default/sm/lg/icon |
| `Card` family               | `src/components/ui/card.tsx`   | Card / Header / Title / Description / Content / Footer                                |
| `Input`                     | `src/components/ui/input.tsx`  | full-width, `aria-invalid` styling                                                    |
| `Label`                     | `src/components/ui/label.tsx`  | pair with `htmlFor`                                                                   |
| `cn()`                      | `src/lib/utils.ts`             | clsx + tailwind-merge                                                                 |
| Icons                       | `lucide-react`                 | icon library (configured in `components.json`)                                        |

Add more: `bunx --bun shadcn@latest add <name>` (writes to `src/components/ui/`). If a component needs `asChild`, install `@radix-ui/react-slot` first.

Signature patterns:

```tsx
// Field
<div className="space-y-2">
  <Label htmlFor="email">Email</Label>
  <Input id="email" type="email" required autoComplete="email" />
</div>

// Link styled as a button (no asChild here)
<Link to="/" className={buttonVariants()}>Back home</Link>

// Inline error
{error && <p className="text-sm text-destructive">{error}</p>}
```

## States (every async surface)

- **Loading:** muted line — `<p className="text-muted-foreground text-sm">Loading…</p>` (see dashboard posts).
- **Empty:** one muted sentence, no illustration.
- **Pending action:** disable the button + swap its label (`disabled={isPending}` → "Posting…").
- **Error:** inline `text-destructive` text under the form; loader/route errors fall to the root `ErrorBoundary` (`src/app/error-boundary.tsx`).

## Voice / copy

Terse, lowercase-leaning, developer-direct. Sentence case for UI; the brand wordmark is lowercase (`inloop`). Short imperative buttons ("Sign in", "Post"). Example good: "No posts yet — be the first." Avoid: marketing fluff, exclamation marks, ALL-CAPS, emoji in UI.

## Don'ts

- ❌ Hardcoded colors (`bg-blue-500`, hex) — use token classes; override tokens in `app.css` for brand.
- ❌ Heavy shadows / `shadow-lg` cards — this is a borders-first look.
- ❌ `tailwind.config.{js,ts}` — Tailwind v4, tokens live in `app.css`.
- ❌ `asChild` on shadcn components — not supported (no Slot); use `buttonVariants()`.
- ❌ Treating `CardTitle` as a heading element — it's a `<div>` (matters for a11y + test selectors).
- ❌ Full-bleed layouts — content stays in the centered `max-w-5xl` column.
- ❌ Web-font dependencies without reason — system stack is intentional.
