import { convexTest } from 'convex-test'
import schema from '../src/schema'

/** Every Convex module, so `convexTest` can resolve scheduled functions and internal calls. */
const modules = import.meta.glob('../src/**/*.ts')

export function setup() {
  return convexTest(schema, modules)
}
