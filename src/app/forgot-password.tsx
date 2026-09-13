import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Wordmark } from '~/components/logo'
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
    <div className="mx-auto w-full max-w-sm px-6 py-16">
      <Link to="/" aria-label="Handback home" className="flex justify-center">
        <Wordmark />
      </Link>
      <div className="bg-card mt-8 rounded-lg border p-6">
        <h1 className="text-xl font-semibold tracking-tight">Forgot your password</h1>
        {sent ? (
          <>
            <p className="text-muted-foreground mt-1.5 text-[13px]">
              If there's an account for{' '}
              <span className="text-foreground font-medium">{email}</span>, a reset link is on its
              way. It's good for one hour.
            </p>
            <p className="text-muted-foreground mt-4 text-[13px]">
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
            <p className="text-muted-foreground mt-1.5 text-[13px]">
              Give us the address you signed up with and we'll send a link to set a new password.
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
              {error && <p className="text-destructive text-[13px]">{error}</p>}
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? 'Sending…' : 'Send the link'}
              </Button>
            </form>
          </>
        )}
      </div>
      <p className="text-muted-foreground mt-6 text-center text-[13px]">
        Remembered it?{' '}
        <Link className="text-cobalt font-medium hover:underline" to="/sign-in">
          Sign in
        </Link>
      </p>
    </div>
  )
}
