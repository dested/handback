import { useState } from 'react'
import { Link, useNavigate, useRevalidator } from 'react-router-dom'
import { ReturnMark } from '~/components/logo'
import { authClient } from '~/lib/auth-client'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

export function SignUpPage() {
  const navigate = useNavigate()
  const revalidator = useRevalidator()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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
    revalidator.revalidate()
    navigate('/dashboard')
  }

  return (
    <div className="mx-auto w-full max-w-sm px-6 py-20 md:py-28">
      <ReturnMark className="h-6" />
      <h1 className="font-display mt-6 text-3xl font-semibold tracking-tight">
        Create your account
      </h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Record a gripe, hand it to your agent, sign off on the fix.
      </p>
      <div className="bg-card mt-8 rounded-lg border p-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
          </div>
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
            <Label htmlFor="password">Password</Label>
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
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </div>
      <p className="text-muted-foreground mt-6 text-sm">
        Already have an account?{' '}
        <Link to="/sign-in" className="text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
