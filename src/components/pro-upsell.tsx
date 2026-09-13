import { Link } from 'react-router-dom'
import { buttonVariants } from '~/components/ui/button'

/**
 * The inline "this is Pro" block a gated control (the chat panel, the refine
 * button) drops in place of itself when the account isn't Pro. Names the
 * specific feature so the sentence reads for wherever it lands.
 */
export function ProUpsell({ feature }: { feature: string }) {
  return (
    <div className="bg-secondary border-border space-y-3 rounded-lg border p-4 text-[13px]">
      <p>{feature} is a Pro feature.</p>
      <Link to="/upgrade" className={buttonVariants({ size: 'sm' })}>
        Upgrade
      </Link>
    </div>
  )
}
