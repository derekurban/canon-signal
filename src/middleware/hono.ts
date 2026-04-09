/**
 * @module canon-signal/middleware/hono
 *
 * Hono framework adapter. Returns a Hono middleware function that
 * delegates to the shared `createRequestHandler` from `common.ts`.
 *
 * Usage:
 * ```ts
 * import { Hono } from 'hono'
 * import { signal } from './signal'
 *
 * const app = new Hono()
 * app.use('*', signal.middleware()) // hono is the default framework
 * ```
 */

import type { Tracer } from '@opentelemetry/api'
import type { SignalStore } from '../context/store.js'
import type { SignalAttributes } from '../types/attributes.js'
import type { MiddlewareOptions } from '../types/config.js'
import { createRequestHandler } from './common.js'

/**
 * Creates the Hono middleware function. Reads `c.req.method`, parses
 * `c.req.url` to extract the pathname (used as the route), and reads
 * the response status from `c.res.status` after the handler chain
 * completes.
 *
 * **Why pathname instead of `c.req.routePath`**: `routePath` returns
 * the wildcard middleware pattern (`'/*'`) when called from middleware,
 * not the actual matched route. The pathname is the actual URL path,
 * which is what we want.
 */
export function createHonoMiddleware<T extends SignalAttributes>(
  store: SignalStore,
  tracer: Tracer,
  schemaVersion: string,
  options: MiddlewareOptions<T>,
) {
  const handleRequest = createRequestHandler<T>(store, tracer, {
    schemaVersion,
    options,
  })

  return async function honoMiddleware(c: any, next: () => Promise<void>) {
    const method = c.req.method
    const url = new URL(c.req.url)
    const route = url.pathname

    let responseStatusCode = 200

    await handleRequest(
      { method, route },
      (name) => c.req.header(name),
      async () => {
        await next()
        responseStatusCode = c.res.status
      },
      () => ({ statusCode: responseStatusCode }),
    )
  }
}
