'use node'

import { providersMode } from '../../lib/env'
import { mockNotifier } from './mock'
import type { NotifierProvider } from './types'
import { webPushNotifier } from './webpush'

/** Web push in real mode; imported by the Node action that pushes (internal/push.ts) and nothing else. */
export function notifierProvider(): NotifierProvider {
  return providersMode() === 'real' ? webPushNotifier : mockNotifier
}

export type { PushDevice, PushOutcome } from './types'
