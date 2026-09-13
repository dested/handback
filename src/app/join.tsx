// /join/:inviteId — the one page a signed-out stranger can land on. Peeking at
// an invite is public; accepting it needs a session, so we send them to sign up
// and back again.

import { useEffect, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useRouteLoaderData, useSearchParams } from 'react-router-dom'
import { Wordmark } from '~/components/logo'
import { Button, buttonVariants } from '~/components/ui/button'
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
    <div className="mx-auto w-full max-w-sm px-6 py-16">
      <Link to="/" aria-label="Handback home" className="flex justify-center">
        <Wordmark />
      </Link>
      <div className="bg-card mt-8 rounded-lg border p-6">
        {inviteQuery.isPending ? (
          <p className="text-muted-foreground text-center text-[13px]">Checking the invite…</p>
        ) : inviteQuery.isError ? (
          <p className="text-destructive text-[13px]">{inviteQuery.error.message}</p>
        ) : !inviteQuery.data ? (
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              This invite has expired or was revoked.
            </h1>
            <p className="text-muted-foreground mt-1.5 text-[13px]">
              Ask whoever sent it for a fresh link.
            </p>
          </div>
        ) : (
          <>
            <div className="text-center">
              <h1 className="text-xl font-semibold tracking-tight">
                You're invited to {inviteQuery.data.teamName}
              </h1>
              {inviteQuery.data.email && (
                <p className="text-muted-foreground mt-1.5 font-mono text-xs">
                  {inviteQuery.data.email}
                </p>
              )}
            </div>
            <div className="mt-5 space-y-3">
              {session && wrongAccount ? (
                <>
                  <p className="text-[13px]">
                    This invite was sent to{' '}
                    <span className="font-mono text-xs">{invitedEmail}</span>, but you're signed in
                    as <span className="font-mono text-xs">{session.user.email}</span>.
                  </p>
                  <p className="text-muted-foreground text-[13px]">
                    Sign in as the invited address to accept it, or ask whoever sent it for a link
                    addressed to you.
                  </p>
                </>
              ) : session ? (
                <>
                  <Button
                    type="button"
                    size="lg"
                    className="w-full"
                    disabled={accept.isPending}
                    onClick={() => accept.mutate({ inviteId })}>
                    {accept.isPending ? 'Joining…' : 'Accept invite'}
                  </Button>
                  {accept.isError && (
                    <p className="text-destructive text-center text-[13px]">
                      {accept.error.message}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <Link
                    to={`/sign-up?invite=${encodeURIComponent(inviteId)}`}
                    className={buttonVariants({ size: 'lg', className: 'w-full' })}>
                    Create an account
                  </Link>
                  <Link
                    to={`/sign-in?invite=${encodeURIComponent(inviteId)}`}
                    className={buttonVariants({ variant: 'outline', size: 'lg', className: 'w-full' })}>
                    Sign in
                  </Link>
                  <p className="text-muted-foreground text-center text-xs">
                    You'll join {inviteQuery.data.teamName} as soon as you're in.
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
