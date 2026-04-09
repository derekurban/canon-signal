/**
 * @module canon-signal/instrumentation/error
 *
 * Implements `signal.error()` — exception recording on the active span.
 */

import { SpanStatusCode } from '@opentelemetry/api'
import type { SignalStore } from '../context/store.js'
import { getContext } from '../context/scope.js'

/**
 * Builds the `signal.error(err)` function. Records the exception as a
 * span event (creating an `exception` event with `exception.type`,
 * `exception.message`, and `exception.stacktrace`) and sets the active
 * span's status to ERROR.
 *
 * **Targets the active span**, not the root span — so when called inside
 * a `signal.span()` callback, the child span gets the exception, not
 * the root.
 *
 * The pattern is to pair this with `signal.attr('app.error.code', ...)`,
 * which always targets the root span. Both annotations are preserved:
 * the child span records *where* the error happened, the root span
 * records the request-level outcome.
 *
 * Throws if called outside a request scope.
 */
export function createErrorFn(store: SignalStore) {
  return function error(err: Error | unknown): void {
    const ctx = getContext(store)
    ctx.activeSpan.recordException(err as Error)
    ctx.activeSpan.setStatus({ code: SpanStatusCode.ERROR })
  }
}
