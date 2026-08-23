import { Link } from 'react-router-dom'

/**
 * The inline "this is Pro" block a gated control (the chat panel, the refine
 * button) drops in place of itself when the account isn't Pro. Names the
 * specific feature so the sentence reads for wherever it lands.
 */
export function ProUpsell({ feature }: { feature: string }) {
  return (
    <div className="border-border bg-card space-y-2 rounded-md border p-4">
      <span className="bg-cobalt-wash text-cobalt inline-block rounded px-1.5 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase">
        pro
      </span>
      <p className="text-sm">{feature} is a Pro feature.</p>
      <Link to="/upgrade" className="text-cobalt inline-block text-sm font-medium hover:underline">
        See what Pro includes →
      </Link>
    </div>
  )
}
