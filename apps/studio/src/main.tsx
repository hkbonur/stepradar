import './styles.css'

import { RouterProvider, createRouter } from '@tanstack/react-router'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { routeTree } from './routeTree.gen'

const convexUrl = import.meta.env.VITE_CONVEX_URL
if (!convexUrl) throw new Error('VITE_CONVEX_URL is not set (apps/studio/.env.local)')
const convex = new ConvexReactClient(convexUrl)

const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// The service worker shows the notifier's pushes (public/sw.js); the studio works the same without it.
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <RouterProvider router={router} />
    </ConvexProvider>
  </StrictMode>
)
