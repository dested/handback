import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ReturnMark } from '~/components/logo'
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
      <div className="mx-auto w-full max-w-sm px-6 py-20 md:py-28">
        <ReturnMark className="h-6" />
        <h1 className="font-display mt-6 text-3xl font-semibold tracking-tight">
          That link is incomplete
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Reset links carry a one-time token and this one arrived without it — some mail clients cut
          long URLs.{' '}
          <Link className="text-cobalt font-medium hover:underline" to="/forgot-password">
            Ask for a fresh link
          </Link>
          .
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-sm px-6 py-20 md:py-28">
      <ReturnMark className="h-6" />
      <h1 className="font-display mt-6 text-3xl font-semibold tracking-tight">
        {done ? 'Password changed' : 'Set a new password'}
      </h1>
      {done ? (
        <>
          <p className="text-muted-foreground mt-2 text-sm">
            You're all set. Sign in with the new one.
          </p>
          <Button className="mt-6 w-full" onClick={() => navigate('/sign-in')}>
            Go to sign in
          </Button>
        </>
      ) : (
        <>
          <p className="text-muted-foreground mt-2 text-sm">
            Pick something you aren't using anywhere else.
          </p>
          <div className="bg-card mt-8 rounded-lg border p-6">
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Again, to be sure</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Saving…' : 'Save it'}
              </Button>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
