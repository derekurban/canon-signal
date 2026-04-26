/**
 * @module canon-signal/middleware/fastify
 *
 * Fastify framework adapter. Returns a Fastify plugin that registers an
 * `onRoute` hook to wrap each route's handler with the shared
 * `createRequestHandler` from `common.ts`.
 *
 * Usage:
 * ```ts
 * import Fastify from 'fastify'
 * import { signal } from './signal'
 *
 * const app = Fastify()
 * await app.register(signal.middleware({ framework: 'fastify' }))
 * ```
 *
 * **Why `onRoute` instead of `onRequest`** (issue #4): the earlier
 * implementation used an async `onRequest` hook that awaited
 * `reply.raw 'finish'` inside `store.run(ctx, handler)`. Fastify v4+
 * awaits async `onRequest` hooks before advancing the request lifecycle,
 * so the hook deadlocked: the route handler couldn't run until `'finish'`
 * fired, and `'finish'` couldn't fire until the route handler ran.
 *
 * `onRoute` fires once per route registration and gives us
 * `routeOptions.handler` to replace. We wrap it in `handleRequest`,
 * which runs the original handler inside `store.run(ctx, ...)` and
 * `tracer.startActiveSpan(...)` — so `signal.attr`, `signal.span`, and
 * `signal.log` all work inside route handlers and downstream code.
 *
 * **Why `Symbol.for('skip-override')`** (the second half of issue #4):
 * Fastify wraps every plugin in an encapsulated child context by default.
 * Hooks added inside an encapsulated plugin only fire for routes
 * registered *inside* that same scope. Without the override,
 * `app.register(signal.middleware({ framework: 'fastify' }))` would
 * silently do nothing for routes registered on `app`. The symbol opts
 * the plugin out of encapsulation so its `onRoute` hook fires for every
 * route in the parent scope.
 *
 * **Limitations**: plugin-level `onRequest` / `preHandler` hooks
 * (registered via `app.addHook(...)` rather than per-route) fire
 * *before* the route handler, which means they fire outside the
 * canon-signal request scope. `signal.attr` inside such hooks would
 * throw "outside request scope". Per-route hooks are not currently
 * wrapped either — only `routeOptions.handler` is. If you need
 * identity attributes set in a `preHandler` to land on the root span,
 * re-stamp them at the top of the route handler.
 */

import type { Tracer } from '@opentelemetry/api'
import type { SignalStore } from '../context/store.js'
import type { SignalAttributes } from '../types/attributes.js'
import type { MiddlewareOptions } from '../types/config.js'
import { createRequestHandler } from './common.js'

const SKIP_OVERRIDE = Symbol.for('skip-override')

/**
 * Creates the Fastify plugin function.
 *
 * **Route extraction**: uses `routeOptions.url` (Fastify's matched
 * route template, e.g. `/users/:id`), falling back to `request.url`
 * for the rare case where `url` is missing on the route options.
 *
 * **Status code**: read from `reply.statusCode` after the original
 * handler returns. Fastify defaults `statusCode` to 200, so this is
 * accurate even when the user returns a value without calling
 * `reply.status(...)`.
 */
export function createFastifyPlugin<T extends SignalAttributes>(
  store: SignalStore,
  tracer: Tracer,
  schemaVersion: string,
  options: MiddlewareOptions<T>,
) {
  const handleRequest = createRequestHandler<T>(store, tracer, {
    schemaVersion,
    options,
  })

  function fastifyPlugin(fastify: any, _opts: any, done: () => void) {
    fastify.addHook('onRoute', (routeOptions: any) => {
      const originalHandler = routeOptions.handler
      if (typeof originalHandler !== 'function') return

      routeOptions.handler = async function wrappedHandler(
        this: any,
        request: any,
        reply: any,
      ) {
        const method = request.method
        const route = routeOptions.url ?? request.url

        let result: unknown
        await handleRequest(
          { method, route },
          (name) => request.headers?.[name.toLowerCase()],
          async () => {
            result = await originalHandler.call(this, request, reply)
          },
          () => ({ statusCode: reply.statusCode ?? 200 }),
        )
        return result
      }
    })

    done()
  }

  ;(fastifyPlugin as any)[SKIP_OVERRIDE] = true

  return fastifyPlugin
}
