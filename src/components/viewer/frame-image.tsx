// A keyframe as a person should read it. Most frames are the whole screen and
// render as one <img>. A close-up (library 1.2+) is only the region that
// changed, so it never shows as a bare crop: it is drawn back into its base
// frame at its box, outlined in cobalt, with the rest of the screen dimmed —
// "this part changed". The overlay is an SVG over the base image whose viewBox
// is the base's own pixel size, with the same fit rule as the <img>, so the box
// lands on the right pixels at any size, contained or covered.

import { useEffect, useRef, useState } from 'react'
import type { FrameBox } from '@dested/video-to-prompt'
import { cn } from '~/lib/utils'

export type FrameCloseUp = {
  box: FrameBox
  /** The base frame's walkthrough-relative path; null when its take doesn't list it. */
  basePath: string | null
  /** Presigned GET for the base; null when it never uploaded or was deleted. */
  baseUrl: string | null
}

export function FrameImage({
  url,
  closeUp,
  fit,
  className,
  imgClassName,
  style,
  lazy,
}: {
  url: string
  closeUp?: FrameCloseUp
  /** Must match the object-fit in `imgClassName`; the overlay follows it. */
  fit: 'contain' | 'cover'
  /** The wrapper: give it the size. The <img> should fill it. */
  className?: string
  imgClassName?: string
  style?: React.CSSProperties
  lazy?: boolean
}): React.ReactElement {
  const baseUrl = closeUp?.baseUrl ?? null
  // The base's pixel size, keyed by its path: a re-signed URL is the same image.
  const baseKey = closeUp?.basePath ?? baseUrl
  const ref = useRef<HTMLImageElement>(null)
  const [size, setSize] = useState<{ key: string; w: number; h: number } | null>(null)

  const measure = () => {
    const img = ref.current
    if (img && baseKey !== null && img.naturalWidth > 0) {
      setSize({ key: baseKey, w: img.naturalWidth, h: img.naturalHeight })
    }
  }
  // An image that finished before hydration never fires onLoad.
  useEffect(() => {
    if (ref.current?.complete) measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey])

  // A close-up whose base is gone can only be the crop itself; the caller labels it.
  if (!closeUp || baseUrl === null) {
    return (
      <div className={cn('relative', className)} style={style}>
        <img
          src={url}
          alt=""
          draggable={false}
          loading={lazy ? 'lazy' : undefined}
          className={imgClassName}
        />
      </div>
    )
  }

  const measured = size && size.key === baseKey ? size : null
  // The box in the base's pixels.
  const x = closeUp.box.x * (measured?.w ?? 0)
  const y = closeUp.box.y * (measured?.h ?? 0)
  const w = closeUp.box.w * (measured?.w ?? 0)
  const h = closeUp.box.h * (measured?.h ?? 0)
  return (
    <div className={cn('relative', className)} style={style}>
      <img
        ref={ref}
        src={baseUrl}
        alt=""
        draggable={false}
        loading={lazy ? 'lazy' : undefined}
        onLoad={measure}
        className={imgClassName}
      />
      {measured && (
        <svg
          viewBox={`0 0 ${measured.w} ${measured.h}`}
          preserveAspectRatio={fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden>
          <path
            d={`M0 0H${measured.w}V${measured.h}H0Z M${x} ${y}h${w}v${h}h${-w}Z`}
            fillRule="evenodd"
            fill="black"
            fillOpacity={0.3}
          />
          <image href={url} x={x} y={y} width={w} height={h} preserveAspectRatio="none" />
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="none"
            stroke="var(--cobalt)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </div>
  )
}
