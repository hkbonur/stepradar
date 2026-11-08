import { api } from '@influstep/convex/_generated/api'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import React from 'react'

/**
 * Dev-only twin of the worker's /go/:slug (ADR 0003): counts the click and
 * redirects. In production the worker answers before the SPA loads.
 */
export const Route = createFileRoute('/go/$slug')({ component: GoPage })

function GoPage() {
  const params = Route.useParams()
  const click = useMutation(api.public.links.click)
  const [missing, setMissing] = React.useState(false)
  // StrictMode mounts twice in dev; count the click once.
  const counted = React.useRef(false)
  React.useEffect(() => {
    if (counted.current) return
    counted.current = true
    void click({ slug: params.slug, referrer: document.referrer || undefined }).then((result) => {
      if (!result) {
        setMissing(true)
        return
      }
      window.location.replace(result.target)
    })
  }, [click, params.slug])
  return <p className="py-20 text-center text-ash">{missing ? 'This link does not exist.' : 'Counting the click…'}</p>
}
