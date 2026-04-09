/**
 * @module canon-signal/context/detection
 *
 * Boolean guard for detecting whether the calling code is inside a
 * canon-signal request scope.
 */

import type { SignalStore } from './store.js'

/**
 * Returns `true` if the current async chain is inside a canon-signal
 * request scope (created by middleware or `signal.trace()`).
 *
 * Useful for code paths that conditionally enrich behavior based on
 * scope presence — e.g. integration code that wants to set attributes
 * only when called from a request handler.
 */
export function isInRequestScope(store: SignalStore): boolean {
  return store.getStore() !== undefined
}
