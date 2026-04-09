/**
 * @module canon-signal/middleware/common
 *
 * Shared request-handling logic used by every framework-specific middleware
 * adapter (Hono, Express, Fastify, Next.js).
 *
 * Each framework adapter is a thin wrapper that pulls the request method,
 * route, and headers from the framework's request object and calls
 * `createRequestHandler()` to do the actual work. The shared logic here
 * handles:
 *
 * 1. **Auto-instrumented span detection** — checks `trace.getActiveSpan()`
 *    for an existing recording span (created by
 *    `@opentelemetry/instrumentation-http` before middleware ran) and uses
 *    it as the root span if present. This unifies canon-signal middleware
 *    with the OTel HTTP instrumentation rather than producing duplicate
 *    spans.
 *
 * 2. **Scope creation** — builds a `SignalContext` and runs the handler
 *    inside `store.run(ctx, ...)` so all downstream `signal.*` calls have
 *    a context to read from.
 *
 * 3. **Automatic attributes** — sets `http.request.method`, `http.route`,
 *    `app.request.id`, `app.schema.version`, and any user-supplied
 *    `defaultAttributes` on the root span.
 *
 * 4. **Error mapping** — on uncaught error, records the exception and
 *    sets ERROR status (mirroring what `signal.error()` does), then
 *    re-throws so the framework can handle the response.
 *
 * 5. **Status code recording** — writes `http.response.status_code` from
 *    the response in both success and error paths.
 */

import { SpanStatusCode, trace, type Span } from '@opentelemetry/api'
import type { Tracer } from '@opentelemetry/api'
import { randomUUID } from 'node:crypto'
import type { SignalStore, SignalContext } from '../context/store.js'
import type { SignalAttributes } from '../types/attributes.js'
import type { MiddlewareOptions } from '../types/config.js'

/** Request metadata extracted by the framework adapter. */
export interface RequestInfo {
  method: string
  route: string
  requestId?: string
}

/** Response metadata read at request completion (or 500 on error). */
export interface ResponseInfo {
  statusCode: number
}

/** Configuration passed from the framework adapter into the request handler. */
export interface MiddlewareConfig<T extends SignalAttributes> {
  schemaVersion: string
  options: MiddlewareOptions<T>
}

/**
 * Returns the active span if one exists from auto-instrumentation,
 * otherwise undefined.
 *
 * Auto-instrumented HTTP spans are created by
 * `@opentelemetry/instrumentation-http` *before* canon-signal middleware
 * runs (the instrumentation hooks into the Node.js HTTP server at a
 * lower level than framework middleware). When this function detects
 * such a span, the middleware uses it as the root span and lets the
 * instrumentation end it after the response.
 *
 * Returns undefined if either:
 * - No span is active in the OTel context
 * - The active span is a non-recording stub (e.g. when sampling has
 *   already decided not to record this trace)
 */
function getAutoInstrumentedSpan(): Span | undefined {
  const active = trace.getActiveSpan()
  if (!active) return undefined

  // Check that this is a recording span — auto-instrumentation creates real spans,
  // not no-op stub spans
  if (typeof (active as any).isRecording === 'function' && (active as any).isRecording()) {
    return active
  }
  return undefined
}

/**
 * Creates the framework-agnostic request handler. Returns a function
 * the framework adapter calls once per request.
 *
 * @param store - The signal instance's AsyncLocalStorage store
 * @param tracer - The signal instance's OTel tracer (used to create a span when no auto-instrumented one exists)
 * @param config - Schema version and middleware options
 *
 * @returns An async function `handleRequest(request, getHeader, handler, getResponse)` that the framework adapter calls per request.
 *
 * The framework adapter passes:
 * - `request` — `{method, route}` extracted from the framework request
 * - `getHeader` — function to read a header by name (framework-specific)
 * - `handler` — async function that runs the actual handler chain (`next()`)
 * - `getResponse` — function to read the final status code after the handler completes
 */
export function createRequestHandler<T extends SignalAttributes>(
  store: SignalStore,
  tracer: Tracer,
  config: MiddlewareConfig<T>,
) {
  const requestIdHeader = config.options.requestIdHeader ?? 'x-request-id'
  // Use the explicit `node:crypto` import rather than the global `crypto`
  // because the Web Crypto API on `globalThis.crypto` was only unflagged
  // in Node 19+. We claim Node 18 support in package.json `engines`, so
  // we must not depend on the global.
  const generateRequestId = config.options.generateRequestId ?? (() => randomUUID())

  return async function handleRequest(
    request: RequestInfo,
    getHeader: (name: string) => string | undefined,
    handler: () => Promise<void>,
    getResponse: () => ResponseInfo,
  ): Promise<void> {
    // Try to use the auto-instrumented HTTP span if present.
    const existingSpan = getAutoInstrumentedSpan()

    if (existingSpan) {
      // Use the existing span as our root — don't create a new one,
      // and don't end it (auto-instrumentation will end it after the response).
      return runWithSpan(existingSpan, /* shouldEnd */ false)
    }

    // No auto-instrumented span — create our own and end it ourselves.
    const spanName = `${request.method} ${request.route}`
    return tracer.startActiveSpan(spanName, (rootSpan) => runWithSpan(rootSpan, /* shouldEnd */ true))

    /**
     * Inner function that does the actual scope/attribute/error work.
     * Closed over `request`, `getHeader`, `handler`, `getResponse` from
     * the outer scope.
     */
    async function runWithSpan(rootSpan: Span, shouldEnd: boolean): Promise<void> {
      const traceId = rootSpan.spanContext().traceId
      const ctx: SignalContext = {
        rootSpan,
        activeSpan: rootSpan,
        traceId,
        attributes: new Map(),
      }

      const requestId = getHeader(requestIdHeader) ?? generateRequestId()

      // Set automatic attributes on both the span and the parallel cache
      // (so signal.getAttr() can read them back).
      rootSpan.setAttribute('http.request.method', request.method)
      rootSpan.setAttribute('http.route', request.route)
      rootSpan.setAttribute('app.request.id', requestId)
      rootSpan.setAttribute('app.schema.version', config.schemaVersion)

      ctx.attributes.set('app.request.id', requestId)
      ctx.attributes.set('app.schema.version', config.schemaVersion)

      // Apply any user-supplied default attributes.
      if (config.options.defaultAttributes) {
        for (const [key, value] of Object.entries(config.options.defaultAttributes)) {
          if (value !== undefined) {
            rootSpan.setAttribute(key, value as any)
            ctx.attributes.set(key, value as any)
          }
        }
      }

      try {
        await store.run(ctx, handler)
        const response = getResponse()
        rootSpan.setAttribute('http.response.status_code', response.statusCode)
        if (shouldEnd) rootSpan.end()
      } catch (err) {
        rootSpan.recordException(err as Error)
        rootSpan.setStatus({ code: SpanStatusCode.ERROR })
        // Try to read the response status; default to 500 if unavailable
        // (e.g. error before any status was set).
        try {
          const response = getResponse()
          rootSpan.setAttribute('http.response.status_code', response.statusCode)
        } catch {
          rootSpan.setAttribute('http.response.status_code', 500)
        }
        if (shouldEnd) rootSpan.end()
        throw err
      }
    }
  }
}
