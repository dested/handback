import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ReturnMark } from '~/components/logo'
import { authClient } from '~/lib/auth-client'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: err } = await authClient.requestPasswordReset({
      email,
      redirectTo: '/reset-password',
    })
    setLoading(false)
    // Deliberately the same answer either way: telling a stranger whether an
    // address has an account here is a free user-enumeration oracle.
    if (err && err.status !== 404) {
      setError(err.message ?? 'Something went wrong. Try again.')
      return
    }
    setSent(true)
  }

  return (
    <div className="mx-auto w-full max-w-sm px-6 py-20 md:py-28">
      <ReturnMark className="h-6" />
      <h1 className="font-display mt-6 text-3xl font-semibold tracking-tight">
        Forgot your password
      </h1>
      {sent ? (
        <>
          <p className="text-muted-foreground mt-2 text-sm">
            If there's an account for <span className="text-foreground font-medium">{email}</span>,
            a reset link is on its way. It's good for one hour.
          </p>
          <p className="text-muted-foreground mt-6 text-sm">
            Nothing arrived? Check spam, then{' '}
            <button
              type="button"
              className="text-cobalt font-medium hover:underline"
              onClick={() => setSent(false)}>
              try a different address
            </button>
            .
          </p>
        </>
      ) : (
        <>
          <p className="text-muted-foreground mt-2 text-sm">
            Give us the address you signed up with and we'll send a link to set a new password.
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
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending…' : 'Send the link'}
              </Button>
            </form>
          </div>
        </>
      )}
      <p className="text-muted-foreground mt-6 text-sm">
        Remembered it?{' '}
        <Link className="text-cobalt font-medium hover:underline" to="/sign-in">
          Sign in
        </Link>
      </p>
    </div>
  )
}
