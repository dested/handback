import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useRevalidator, useSearchParams } from 'react-router-dom'
import { Wordmark } from '~/components/logo'
import { authClient } from '~/lib/auth-client'
import { clearIdentity } from '~/lib/space'
import { useTRPC } from '~/lib/trpc'
import { safeNext } from './sign-in'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

export function SignUpPage() {
  const navigate = useNavigate()
  const revalidator = useRevalidator()
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [search] = useSearchParams()
  // Someone who arrived from /join carries the invite through sign-up so we can
  // hand them straight back to it — otherwise the account exists and the
  // invitation is orphaned.
  const inviteId = search.get('invite') ?? ''
  const next = safeNext(search.get('next'))
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const inviteQuery = useQuery({
    ...trpc.invites.peek.queryOptions({ inviteId }),
    enabled: inviteId !== '',
  })
  const invitedEmail = inviteQuery.data?.email ?? null
  useEffect(() => {
    if (invitedEmail) setEmail((current) => (current === '' ? invitedEmail : current))
  }, [invitedEmail])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: err } = await authClient.signUp.email({ name, email, password })
    setLoading(false)
    if (err) {
      setError(err.message ?? 'Sign up failed')
      return
    }
    // Whatever was cached belongs to whoever was signed in before, if anyone.
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
        <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-muted-foreground mt-1.5 text-[13px]">
          {inviteQuery.data
            ? `Then you'll join ${inviteQuery.data.teamName}.`
            : 'Record a walkthrough, hand it to your agent, sign off on the fix.'}
        </p>
        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-muted-foreground text-xs">
              Name
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
          </div>
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
            <Label htmlFor="password" className="text-muted-foreground text-xs">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          {error && <p className="text-destructive text-[13px]">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </div>
      <p className="text-muted-foreground mt-6 text-center text-[13px]">
        Already have an account?{' '}
        <Link
          to={inviteId ? `/sign-in?invite=${encodeURIComponent(inviteId)}` : '/sign-in'}
          className="text-cobalt font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
