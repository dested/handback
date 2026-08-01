/** First-paint placeholder: header block, one take, report slab. */
export function ViewerSkeleton() {
  return (
    <div className="animate-pulse space-y-8" aria-busy="true" aria-label="Loading walkthrough">
      <div className="space-y-3">
        <div className="bg-muted h-3 w-16 rounded" />
        <div className="bg-muted h-8 w-2/3 rounded" />
        <div className="bg-muted h-3 w-1/3 rounded" />
        <div className="bg-muted h-3 w-1/2 rounded" />
        <div className="bg-muted h-9 w-72 rounded-md" />
      </div>
      <div className="rule pt-8">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-2 lg:col-span-2">
            <div className="bg-muted h-72 rounded-md" />
            <div className="bg-muted h-16 rounded-md" />
          </div>
          <div className="bg-muted h-72 rounded-md lg:col-span-1" />
        </div>
      </div>
      <div className="rule pt-8">
        <div className="bg-muted h-40 rounded-md" />
      </div>
    </div>
  )
}
