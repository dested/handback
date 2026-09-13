import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Wordmark } from '~/components/logo'
import { authClient } from '~/lib/auth-client'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

const MIN_PASSWORD = 8

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // better-auth puts the one-time token on the redirect it sends people to.
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (password !== confirm) {
      setError("Those don't match.")
      return
    }
    setLoading(true)
    const { error: err } = await authClient.resetPassword({ newPassword: password, token })
    setLoading(false)
    if (err) {
      setError(err.message ?? 'That link is no longer good. Ask for a fresh one.')
      return
    }
    setDone(true)
  }

  if (!token) {
    return (
      <div className="mx-auto w-full max-w-sm px-6 py-16">
        <Link to="/" aria-label="Handback home" className="flex justify-center">
          <Wordmark />
        </Link>
        <div className="bg-card mt-8 rounded-lg border p-6">
          <h1 className="text-xl font-semibold tracking-tight">That link is incomplete</h1>
          <p className="text-muted-foreground mt-1.5 text-[13px]">
            Reset links carry a one-time token and this one arrived without it — some mail clients
            cut long URLs.{' '}
            <Link className="text-cobalt font-medium hover:underline" to="/forgot-password">
              Ask for a fresh link
            </Link>
            .
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-sm px-6 py-16">
      <Link to="/" aria-label="Handback home" className="flex justify-center">
        <Wordmark />
      </Link>
      <div className="bg-card mt-8 rounded-lg border p-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {done ? 'Password changed' : 'Set a new password'}
        </h1>
        {done ? (
          <>
            <p className="text-muted-foreground mt-1.5 text-[13px]">
              You're all set. Sign in with the new one.
            </p>
            <Button size="lg" className="mt-5 w-full" onClick={() => navigate('/sign-in')}>
              Go to sign in
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground mt-1.5 text-[13px]">
              Pick something you aren't using anywhere else.
            </p>
            <form onSubmit={onSubmit} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-muted-foreground text-xs">
                  New password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm" className="text-muted-foreground text-xs">
                  Again, to be sure
                </Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              {error && <p className="text-destructive text-[13px]">{error}</p>}
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? 'Saving…' : 'Save it'}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
