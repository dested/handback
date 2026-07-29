import { useState } from 'react'
import { useLoaderData } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import type { RootLoaderData } from './routes'

export function DashboardPage() {
  const { session } = useLoaderData() as RootLoaderData
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const postsQuery = useQuery(trpc.posts.list.queryOptions())
  const createPost = useMutation(
    trpc.posts.create.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.posts.list.queryKey() }),
    })
  )

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  if (!session) return null

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back, <strong>{session.user.name || session.user.email}</strong>.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>New post</CardTitle>
          <CardDescription>
            Posts are stored in Postgres via Prisma, fetched over tRPC.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              createPost.mutate(
                { title, content },
                {
                  onSuccess: () => {
                    setTitle('')
                    setContent('')
                  },
                }
              )
            }}
            className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="content">Content</Label>
              <Input
                id="content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={createPost.isPending}>
              {createPost.isPending ? 'Posting…' : 'Post'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Recent posts</h2>
        {postsQuery.isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
        {postsQuery.data?.length === 0 && (
          <p className="text-muted-foreground text-sm">No posts yet — be the first.</p>
        )}
        <div className="space-y-3">
          {postsQuery.data?.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle>{p.title}</CardTitle>
                <CardDescription>
                  by {p.authorName ?? 'unknown'} · {p.createdAt.slice(0, 10)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{p.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}
