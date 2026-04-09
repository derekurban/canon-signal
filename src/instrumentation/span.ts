/**
 * @module canon-signal/instrumentation/span
 *
 * Implements `signal.span()` — child span creation with automatic
 * error handling and context propagation.
 */

import type { Tracer, Span } from '@opentelemetry/api'
import { SpanStatusCode } from '@opentelemetry/api'
import type { SignalStore, SignalContext } from '../context/store.js'
import { getContext } from '../context/scope.js'

/**
 * Builds the `signal.span(name, fn)` function bound to a signal's
 * context store and tracer.
 *
 * The returned function:
 * 1. Reads the current context (must be inside a request scope)
 * 2. Calls `tracer.startActiveSpan()` to create a child of the current active span
 * 3. Forks a new `SignalContext` where `activeSpan` is the new child but `rootSpan` is preserved (so `signal.attr()` still targets the root)
 * 4. Runs the user callback inside `store.run(childCtx, ...)`
 * 5. Ends the child span on success
 * 6. On error: records the exception, sets ERROR status, ends the span, and re-throws
 *
 * The user callback receives the OTel `Span` object directly (not via
 * the store) so they can call `span.setAttribute()` for child-specific
 * attributes that don't belong on the canonical root span schema.
 *
 * Span name **must be low-cardinality** (e.g. `payment.process`, not
 * `payment.process.usr_123`). canon-signal doesn't enforce this — it's
 * a convention you must follow to avoid breaking trace backend indexing.
 */
export function createSpanFn(store: SignalStore, tracer: Tracer) {
  return async function span<R>(name: string, fn: (span: Span) => R | Promise<R>): Promise<R> {
    const ctx = getContext(store)
    return tracer.startActiveSpan(name, async (childSpan) => {
      const childCtx: SignalContext = {
        rootSpan: ctx.rootSpan,
        activeSpan: childSpan,
        traceId: ctx.traceId,
        attributes: ctx.attributes,
      }
      try {
        const result = await store.run(childCtx, () => fn(childSpan))
        childSpan.end()
        return result
      } catch (err) {
        childSpan.recordException(err as Error)
        childSpan.setStatus({ code: SpanStatusCode.ERROR })
        childSpan.end()
        throw err
      }
    })
  }
}
