/**
 * @module canon-signal/middleware/loader
 *
 * Builds the `signal.middleware()` function — the framework dispatch
 * layer that returns the right middleware adapter based on the user's
 * `framework` option.
 *
 * Currently dispatches synchronously since all four framework files
 * are statically imported. The original design called for dynamic
 * imports (so unused framework code wouldn't be loaded), but vitest
 * doesn't handle dynamic imports of source `.ts` files cleanly during
 * tests. Static imports are simple and the framework adapters are
 * small enough that the bundle cost is negligible.
 *
 * Each framework module imports the user's installed framework as a
 * peer dependency (Hono, Express, Fastify, Next.js are all optional
 * peer deps in `package.json`). If the framework isn't installed but
 * the adapter never runs, nothing breaks — the framework imports are
 * type-only.
 */

import type { Tracer } from '@opentelemetry/api'
import type { SignalStore } from '../context/store.js'
import type { SignalAttributes } from '../types/attributes.js'
import type { MiddlewareOptions } from '../types/config.js'
import { createHonoMiddleware } from './hono.js'
import { createExpressMiddleware } from './express.js'
import { createFastifyPlugin } from './fastify.js'
import { createNextMiddleware } from './next.js'

/**
 * Builds the `signal.middleware(options?)` function bound to a signal's
 * store, tracer, and schema version.
 *
 * If no `framework` is specified in the options, defaults to `'hono'`
 * (chosen as the default because it's the lightest and works in both
 * Node.js and edge environments).
 *
 * @throws {Error} If an unknown framework name is passed.
 */
export function createMiddlewareFn<T extends SignalAttributes>(
  store: SignalStore,
  tracer: Tracer,
  schemaVersion: string,
) {
  return function middleware(options?: MiddlewareOptions<T>): any {
    const framework = options?.framework ?? 'hono'
    const opts = options ?? ({} as MiddlewareOptions<T>)

    switch (framework) {
      case 'hono':
        return createHonoMiddleware(store, tracer, schemaVersion, opts)
      case 'express':
        return createExpressMiddleware(store, tracer, schemaVersion, opts)
      case 'fastify':
        return createFastifyPlugin(store, tracer, schemaVersion, opts)
      case 'next':
        return createNextMiddleware(store, tracer, schemaVersion, opts)
      default:
        throw new Error(`canon-signal: Framework "${framework}" is not supported.`)
    }
  }
}
