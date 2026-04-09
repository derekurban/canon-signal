/**
 * @module canon-signal/instrumentation/event
 *
 * Implements `signal.event()` — timestamped events on the active span.
 */

import type { AttributeValue } from '../types/otel.js'
import type { SignalStore } from '../context/store.js'
import { getContext } from '../context/scope.js'

/**
 * Builds the `signal.event(name, data?)` function. Adds a timestamped
 * event to the **active** span (root or child, depending on context).
 *
 * Events are for notable point-in-time occurrences during a span's
 * lifetime — cache misses, retry attempts, state transitions, feature
 * flag evaluations. They appear in the trace waterfall as annotations.
 *
 * **Don't use this for**:
 * - High-frequency loop iterations (use a counter metric)
 * - Things that should be queryable as dimensions (use `signal.attr()`)
 * - Large payloads (use a log record)
 *
 * Throws if called outside a request scope.
 */
export function createEventFn(store: SignalStore) {
  return function event(name: string, data?: Record<string, AttributeValue>): void {
    const ctx = getContext(store)
    ctx.activeSpan.addEvent(name, data)
  }
}
