import type { Tracer } from '@opentelemetry/api'
import type { SignalStore } from '../context/store.js'
import type { SignalAttributes } from '../types/attributes.js'
import type { MiddlewareOptions } from '../types/config.js'
import { createRequestHandler } from '../middleware/common.js'

export function createWorkerHonoMiddleware<T extends SignalAttributes>(
  store: SignalStore,
  tracer: Tracer,
  schemaVersion: string,
  options: MiddlewareOptions<T>,
  generateRequestId: () => string,
  flush: () => Promise<void>,
) {
  const handleRequest = createRequestHandler<T>(store, tracer, {
    schemaVersion,
    options,
    generateRequestId,
  })

  return async function workerHonoMiddleware(c: any, next: () => Promise<void>) {
    const method = c.req.method
    const url = new URL(c.req.url)
    const route = url.pathname
    let responseStatusCode = 200

    try {
      await handleRequest(
        { method, route },
        (name) => c.req.header(name),
        async () => {
          await next()
          responseStatusCode = c.res.status
        },
        () => ({ statusCode: responseStatusCode }),
      )
    } finally {
      const pendingFlush = flush()
      let waitUntil: ((promise: Promise<unknown>) => void) | undefined
      let executionCtx: { waitUntil?: (promise: Promise<unknown>) => void } | undefined
      try {
        executionCtx = c.executionCtx
        waitUntil = executionCtx?.waitUntil
      } catch {
        waitUntil = undefined
      }
      if (typeof waitUntil === 'function') {
        waitUntil.call(executionCtx, pendingFlush)
      } else {
        await pendingFlush
      }
    }
  }
}

export function createWorkerMiddlewareFn<T extends SignalAttributes>(
  store: SignalStore,
  tracer: Tracer,
  schemaVersion: string,
  generateRequestId: () => string,
  flush: () => Promise<void>,
) {
  return function middleware(options?: MiddlewareOptions<T>): any {
    const framework = options?.framework ?? 'hono'
    if (framework !== 'hono') {
      throw new Error(
        `canon-signal/worker: Framework "${framework}" is not supported. ` +
          'Cloudflare Workers currently support the Hono adapter only.',
      )
    }

    return createWorkerHonoMiddleware(
      store,
      tracer,
      schemaVersion,
      options ?? ({} as MiddlewareOptions<T>),
      generateRequestId,
      flush,
    )
  }
}
