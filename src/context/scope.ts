/**
 * @module canon-signal/context/scope
 *
 * Helpers for accessing the current `SignalContext` from the store.
 *
 * Two flavors:
 * - `getContext()` — throws if outside a scope. Used by methods that
 *   make no sense without a request (`attr`, `span`, `event`, `error`, `keep`).
 * - `getContextSafe()` — returns undefined if outside a scope. Used by
 *   methods that gracefully degrade (`traceId`, `signal.log`).
 */

import type { SignalContext, SignalStore } from './store.js'

/**
 * Returns the current `SignalContext`, throwing a clear error if called
 * outside a request scope.
 *
 * The error message tells the developer how to fix it: wrap their code
 * in `signal.middleware()` (for HTTP) or `signal.trace()` (for background
 * jobs).
 *
 * @throws {Error} If called outside a request or trace scope.
 */
export function getContext(store: SignalStore): SignalContext {
  const ctx = store.getStore()
  if (!ctx) {
    throw new Error(
      'canon-signal: Called outside a request scope. ' +
      'Wrap your code in signal.middleware() or signal.trace().',
    )
  }
  return ctx
}

/**
 * Returns the current `SignalContext`, or `undefined` if called outside
 * a request scope. Does not throw.
 *
 * Used by `signal.traceId()` (which is documented as safe to call
 * anywhere) and `signal.log` (which falls back to plain log records
 * outside a scope).
 */
export function getContextSafe(store: SignalStore): SignalContext | undefined {
  return store.getStore()
}
