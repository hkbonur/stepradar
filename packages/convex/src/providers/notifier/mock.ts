import type { NotifierProvider } from './types'

/** Pushes nothing: the notification row is the record, and Today's in-app list shows it. */
export const mockNotifier: NotifierProvider = {
  name: 'mock',
  async send() {
    return { kind: 'recorded' }
  },
}
