/// <reference types="@cloudflare/workers-types" />
/**
 * The studio's Cloudflare Worker: serves the SPA, and counts tracked-link
 * clicks on /go/:slug and redirects (ADR 0003) through the backend's public
 * function over HTTP.
 */
import { ConvexHttpClient } from 'convex/browser'
import { api } from '@influstep/convex/_generated/api'

interface Env {
  ASSETS: Fetcher
  CONVEX_URL: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const go = url.pathname.match(/^\/go\/([a-z0-9-]+)\/?$/)
    if (go?.[1]) {
      const client = new ConvexHttpClient(env.CONVEX_URL)
      const result = await client.mutation(api.public.links.click, {
        slug: go[1],
        referrer: request.headers.get('referer') ?? undefined,
        country: request.headers.get('cf-ipcountry') ?? undefined,
      })
      if (!result) return new Response('This link does not exist.', { status: 404 })
      return Response.redirect(result.target, 302)
    }
    return env.ASSETS.fetch(request)
  },
}
