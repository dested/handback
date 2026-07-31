import { useState } from 'react'
import { Link, useNavigate, useRevalidator, useSearchParams } from 'react-router-dom'
import { ReturnMark } from '~/components/logo'
import { authClient } from '~/lib/auth-client'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

export function SignInPage() {
  const navigate = useNavigate()
  const revalidator = useRevalidator()
  const [search] = useSearchParams()
  // Carried through from /join so an invite survives the round trip.
  const inviteId = search.get('invite') ?? ''
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
    await revalidator.revalidate()
    navigate(inviteId ? `/join/${encodeURIComponent(inviteId)}?accept=1` : '/dashboard')
  }

  return (
    <div className="mx-auto w-full max-w-sm px-6 py-20 md:py-28">
      <ReturnMark className="h-6" />
      <h1 className="font-display mt-6 text-3xl font-semibold tracking-tight">Welcome back</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Sign in to pick up the gripes waiting on you.
      </p>
      <div className="bg-card mt-8 rounded-lg border p-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                to="/forgot-password"
                className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline">
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
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
      <p className="text-muted-foreground mt-6 text-sm">
        No account?{' '}
        <Link
          to={inviteId ? `/sign-up?invite=${encodeURIComponent(inviteId)}` : '/sign-up'}
          className="text-primary underline-offset-4 hover:underline">
          Create one
        </Link>
      </p>
    </div>
  )
}
