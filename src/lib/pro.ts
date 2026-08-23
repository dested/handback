/** Matches the exact FORBIDDEN message every pro-gated procedure throws. */
export function isProError(err: unknown): boolean {
  return err instanceof Error && err.message === 'Pro feature'
}
