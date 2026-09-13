import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useRevalidator, useSearchParams } from 'react-router-dom'
import { Wordmark } from '~/components/logo'
import { authClient } from '~/lib/auth-client'
import { clearIdentity } from '~/lib/space'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

/** A next param is only ever a path on this site — anything else is an open redirect. */
export function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null
  return raw
}

export function SignInPage() {
  const navigate = useNavigate()
  const revalidator = useRevalidator()
  const queryClient = useQueryClient()
  const [search] = useSearchParams()
  // Carried through from /join so an invite survives the round trip.
  const inviteId = search.get('invite') ?? ''
  // Where to land after auth (e.g. /phone?shared=1 — a shared clip must not be
  // orphaned by the sign-in bounce). Same-site paths only.
  const next = safeNext(search.get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: err } = await authClient.signIn.email({ email, password })
    setLoading(false)
    if (err) {
      setError(err.message ?? 'Sign in failed')
      return
    }
    // A different account may have been signed in before this one — everything
    // cached (teams, inbox, active space) is theirs, not this user's.
    clearIdentity(queryClient)
    await revalidator.revalidate()
    navigate(inviteId ? `/join/${encodeURIComponent(inviteId)}?accept=1` : (next ?? '/dashboard'))
  }

  return (
    <div className="mx-auto w-full max-w-sm px-6 py-16">
      <Link to="/" aria-label="Handback home" className="flex justify-center">
        <Wordmark />
      </Link>
      <div className="bg-card mt-8 rounded-lg border p-6">
        <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-muted-foreground mt-1.5 text-[13px]">
          Sign in to pick up the walkthroughs waiting on you.
        </p>
        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-muted-foreground text-xs">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="password" className="text-muted-foreground text-xs">
                Password
              </Label>
              <Link
                to="/forgot-password"
                className="text-cobalt text-[13px] font-medium hover:underline">
                Forgot it?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-destructive text-[13px]">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
      <p className="text-muted-foreground mt-6 text-center text-[13px]">
        No account?{' '}
        <Link
          to={
            inviteId
              ? `/sign-up?invite=${encodeURIComponent(inviteId)}`
              : next
                ? `/sign-up?next=${encodeURIComponent(next)}`
                : '/sign-up'
          }
          className="text-cobalt font-medium hover:underline">
          Create one
        </Link>
      </p>
    </div>
  )
}
