/**
 * @module canon-signal/middleware/express
 *
 * Express framework adapter. Returns an Express middleware function
 * `(req, res, next) => void` that delegates to the shared
 * `createRequestHandler` from `common.ts`.
 *
 * Usage:
 * ```ts
 * import express from 'express'
 * import { signal } from './signal'
 *
 * const app = express()
 * app.use(signal.middleware({ framework: 'express' }))
 * ```
 */

import type { Tracer } from '@opentelemetry/api'
import type { SignalStore } from '../context/store.js'
import type { SignalAttributes } from '../types/attributes.js'
import type { MiddlewareOptions } from '../types/config.js'
import { createRequestHandler } from './common.js'

/**
 * Creates the Express middleware function.
 *
 * **Route extraction**: tries `req.route.path` first (set by Express's
 * router after route matching), falling back to `req.path` and finally
 * `req.url`. Note that `req.route` is only populated *after* route
 * matching, so when used as application-level middleware (`app.use(...)`)
 * before any routes, the path may not yet be the matched route.
 *
 * **Async handling**: Express middleware is callback-based, so we
 * convert `next()` into a promise that resolves on `res.on('finish')`.
 * This ensures `signal.attr()` calls in the route handler complete
 * before we read the status code.
 *
 * **Error propagation**: any error from the handler is passed to
 * Express's `next(err)` for the framework's standard error pipeline.
 */
export function createExpressMiddleware<T extends SignalAttributes>(
  store: SignalStore,
  tracer: Tracer,
  schemaVersion: string,
  options: MiddlewareOptions<T>,
) {
  const handleRequest = createRequestHandler<T>(store, tracer, {
    schemaVersion,
    options,
  })

  return function expressMiddleware(req: any, res: any, next: (err?: any) => void) {
    const method = req.method
    const route = req.route?.path ?? req.path ?? req.url

    handleRequest(
      { method, route },
      (name) => req.headers?.[name.toLowerCase()],
      async () => {
        await new Promise<void>((resolve, reject) => {
          res.on('finish', resolve)
          res.on('error', reject)
          next()
        })
      },
      () => ({ statusCode: res.statusCode ?? 500 }),
    ).catch(next)
  }
}
