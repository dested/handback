/**
 * The walkthrough's slug — its identity in the space. Re-declaring the same
 * (space, slug) replaces the previous upload wholesale, so a title typed twice
 * on a phone overwrites rather than piles up.
 */
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      // Strip combining marks so "café" slugs as "cafe", not "caf".
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'walkthrough'
  )
}
