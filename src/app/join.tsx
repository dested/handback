// /join/:inviteId — the one page a signed-out stranger can land on. Peeking at
// an invite is public; accepting it needs a session, so we send them to sign up
// and back again.

import { useEffect, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useRouteLoaderData, useSearchParams } from 'react-router-dom'
import { ReturnMark } from '~/components/logo'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { useActiveSpace } from '~/lib/space'
import { useTRPC } from '~/lib/trpc'
import type { Session } from '../../server/auth'

export function JoinPage() {
  const { inviteId = '' } = useParams()
  const navigate = useNavigate()
  const trpc = useTRPC()
  const { refreshTeams, setActiveSpace } = useActiveSpace()
  const data = useRouteLoaderData('root') as { session: Session | null } | undefined
  const session = data?.session ?? null
  const [search] = useSearchParams()
  // Set by /sign-up and /sign-in when they hand the visitor back here: they
  // already clicked "accept" once, before they had an account to accept with.
  const autoAccept = search.get('accept') === '1'

  const inviteQuery = useQuery({
    ...trpc.invites.peek.queryOptions({ inviteId }),
    enabled: inviteId !== '',
  })

  const accept = useMutation(
    trpc.invites.accept.mutationOptions({
      onSuccess: (result) => {
        refreshTeams()
        setActiveSpace(result.teamId)
        navigate('/app')
      },
    })
  )

  // An addressed invite only accepts from that address (enforced server-side in
  // invites.accept) — say so before they click rather than after.
  const invitedEmail = inviteQuery.data?.email ?? null
  const wrongAccount =
    !!session && !!invitedEmail && invitedEmail.toLowerCase() !== session.user.email.toLowerCase()

  const fired = useRef(false)
  useEffect(() => {
    if (!autoAccept || fired.current || wrongAccount) return
    if (!session || !inviteQuery.data) return
    fired.current = true
    accept.mutate({ inviteId })
  }, [autoAccept, session, inviteQuery.data, accept, inviteId, wrongAccount])

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      {inviteQuery.isPending ? (
        <p className="text-muted-foreground text-center text-sm">Checking the invite…</p>
      ) : inviteQuery.isError ? (
        <Card>
          <CardContent className="text-destructive text-sm">
            {inviteQuery.error.message}
          </CardContent>
        </Card>
      ) : !inviteQuery.data ? (
        <Card>
          <CardHeader className="items-center text-center">
            <CardTitle>This invite has expired or was revoked.</CardTitle>
            <CardDescription>Ask whoever sent it for a fresh link.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader className="items-center text-center">
            <ReturnMark className="mx-auto h-6" />
            <CardTitle className="font-display text-2xl leading-snug font-semibold">
              You're invited to {inviteQuery.data.teamName}
            </CardTitle>
            {inviteQuery.data.email && (
              <CardDescription className="font-mono text-xs">
                {inviteQuery.data.email}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {session && wrongAccount ? (
              <>
                <p className="text-sm">
                  This invite was sent to <span className="font-mono text-xs">{invitedEmail}</span>,
                  but you're signed in as{' '}
                  <span className="font-mono text-xs">{session.user.email}</span>.
                </p>
                <p className="text-muted-foreground text-sm">
                  Sign in as the invited address to accept it, or ask whoever sent it for a link
                  addressed to you.
                </p>
              </>
            ) : session ? (
              <>
                <Button
                  type="button"
                  className="w-full"
                  disabled={accept.isPending}
                  onClick={() => accept.mutate({ inviteId })}>
                  {accept.isPending ? 'Joining…' : 'Accept invite'}
                </Button>
                {accept.isError && (
                  <p className="text-destructive text-center text-sm">{accept.error.message}</p>
                )}
              </>
            ) : (
              <>
                <Link
                  to={`/sign-up?invite=${encodeURIComponent(inviteId)}`}
                  className="bg-primary text-primary-foreground flex h-9 w-full items-center justify-center rounded-md text-sm font-medium hover:opacity-90">
                  Create an account
                </Link>
                <Link
                  to={`/sign-in?invite=${encodeURIComponent(inviteId)}`}
                  className="border-input bg-background hover:bg-accent hover:text-accent-foreground flex h-9 w-full items-center justify-center rounded-md border text-sm font-medium">
                  Sign in
                </Link>
                <p className="text-muted-foreground text-center text-xs">
                  You'll join {inviteQuery.data.teamName} as soon as you're in.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
