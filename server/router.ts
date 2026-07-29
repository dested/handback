import { z } from 'zod'
import { router, publicProcedure, protectedProcedure } from './trpc'
import { prisma } from './prisma'

export const appRouter = router({
  me: protectedProcedure.query(({ ctx }) => ctx.session.user),
  posts: router({
    list: publicProcedure.query(async () => {
      const rows = await prisma.post.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' },
        include: { author: { select: { name: true } } },
      })
      // ISO strings on the wire so SSR-rendered HTML and React Query's
      // post-hydration render produce identical markup (no Date-locale drift).
      return rows.map((p) => ({
        id: p.id,
        title: p.title,
        content: p.content,
        createdAt: p.createdAt.toISOString(),
        authorName: p.author?.name ?? null,
      }))
    }),
    create: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1).max(200),
          content: z.string().min(1).max(2000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return prisma.post.create({
          data: { ...input, authorId: ctx.session.user.id },
        })
      }),
  }),
})

export type AppRouter = typeof appRouter
