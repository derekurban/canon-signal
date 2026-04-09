/**
 * @module canon-signal/instrumentation/keep
 *
 * Implements `signal.keep()` — the escape hatch that forces the current
 * trace to be exported, overriding all sampling rules.
 */

import type { SignalStore } from '../context/store.js'
import { getContext } from '../context/scope.js'

/**
 * Builds the `signal.keep()` function. Sets `app.debug = true` on the
 * root span, which `TailSamplingProcessor` checks first in its rule
 * chain — any span with this attribute is always exported, regardless
 * of `defaultRate` or other rules.
 *
 * Useful for:
 * - Investigating a specific user's behavior (`if (userId === 'usr_X') signal.keep()`)
 * - Debug query parameters (`if (req.query.debug) signal.keep()`)
 * - Forcing capture of low-volume but important paths
 *
 * The `app.debug = true` attribute is also visible in the exported trace,
 * so you can later query "show me all kept traces" in your backend.
 *
 * Throws if called outside a request scope.
 */
export function createKeepFn(store: SignalStore) {
  return function keep(): void {
    const ctx = getContext(store)
    ctx.rootSpan.setAttribute('app.debug', true)
    ctx.attributes.set('app.debug', true)
  }
}
