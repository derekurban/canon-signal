/**
 * @module canon-signal/testing
 *
 * Public entry point for the test harness. Re-exports `createTestHarness`
 * and the `TestHarness<T>` interface.
 *
 * Most consumers won't import from this path directly — they'll access
 * the harness via `signal.test.harness()` on their signal instance,
 * which lazy-loads this module. The subpath import exists as an
 * alternative for test files that prefer explicit imports.
 *
 * ```ts
 * // Via the signal instance (recommended)
 * import { signal } from './signal'
 * const harness = signal.test.harness()
 *
 * // Via the subpath import (alternative)
 * import { createTestHarness } from 'canon-signal/testing'
 * ```
 */

export { createTestHarness } from './harness.js'
export type { TestHarness } from '../types/signal.js'

// Query helpers for filtering captured spans — useful for tests that
// want to work with multi-trace span arrays directly.
export {
  filterByErrors,
  filterByRoute,
  filterByAttribute,
  groupByTraceId,
} from '../inspect/query.js'
