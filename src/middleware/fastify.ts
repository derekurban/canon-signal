/**
 * @module canon-signal/middleware/fastify
 *
 * Fastify framework adapter. Returns a Fastify plugin that registers
 * an `onRequest` hook delegating to the shared `createRequestHandler`
 * from `common.ts`.
 *
 * Usage:
 * ```ts
 * import Fastify from 'fastify'
 * import { signal } from './signal'
 *
 * const app = Fastify()
 * app.register(signal.middleware({ framework: 'fastify' }))
 * ```
 */

import type { Tracer } from '@opentelemetry/api'
import type { SignalStore } from '../context/store.js'
import type { SignalAttributes } from '../types/attributes.js'
import type { MiddlewareOptions } from '../types/config.js'
import { createRequestHandler } from './common.js'

/**
 * Creates the Fastify plugin function.
 *
 * **Route extraction**: uses `request.routeOptions.url` (Fastify's
 * matched route template, e.g. `/users/:id`), falling back to
 * `request.url` (the actual URL with parameter values).
 *
 * **Hook lifecycle**: Fastify's `onRequest` hook fires before the
 * route handler runs. We need to keep the request scope active until
 * the response is sent, so we await `reply.raw.on('finish')`.
 *
 * **Plugin pattern**: Fastify expects plugins to call `done()` after
 * registration so it knows the plugin is ready. Hooks registered
 * synchronously inside the plugin function are guaranteed to fire
 * for subsequent requests.
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

  return function fastifyPlugin(fastify: any, _opts: any, done: () => void) {
    fastify.addHook('onRequest', async (request: any, reply: any) => {
      const method = request.method
      const route = request.routeOptions?.url ?? request.url

      await handleRequest(
        { method, route },
        (name) => request.headers?.[name.toLowerCase()],
        async () => {
          // The request continues after this hook
          // We wait for the response to be sent
          await new Promise<void>((resolve) => {
            reply.raw.on('finish', resolve)
          })
        },
        () => ({ statusCode: reply.statusCode ?? 500 }),
      )
    })

    done()
  }
}
