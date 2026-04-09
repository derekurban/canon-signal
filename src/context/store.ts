/**
 * @module canon-signal/context/store
 *
 * The AsyncLocalStorage store that holds per-request state.
 *
 * canon-signal's "context is ambient" promise depends on this module:
 * every `signal.attr()`, `signal.span()`, `signal.error()`, `signal.log`
 * call reads the current `SignalContext` from this store via
 * `getContext()` (or `getContextSafe()`), without needing the user to
 * pass anything. The middleware layer enters the scope via
 * `store.run(ctx, fn)` once per request.
 *
 * The store is created **per signal instance** by `createSignal()`, not
 * as a module-level singleton. This enables test isolation — each test
 * can call `createSignal()` and get a fresh, independent store.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Span } from '@opentelemetry/api'
import type { AttributeValue } from '../types/otel.js'

/**
 * The per-request context held in the AsyncLocalStorage store.
 *
 * @property rootSpan - The root span of the current trace. `signal.attr()` always targets this. Never changes during a request.
 * @property activeSpan - The currently-active span (which may be the root or a child created by `signal.span()`). `signal.error()` and `signal.event()` target this.
 * @property traceId - The W3C trace ID of the current trace. Stable across the entire request lifecycle.
 * @property attributes - Parallel cache of attributes set via `signal.attr()`. Required because OTel's `Span` interface doesn't expose a public `getAttribute()` reader, so we maintain our own copy to support `signal.getAttr()`.
 */
export interface SignalContext {
  rootSpan: Span
  activeSpan: Span
  traceId: string
  attributes: Map<string, AttributeValue>
}

/**
 * Type alias for the AsyncLocalStorage instance specialized to
 * `SignalContext`. Each signal instance owns one of these.
 */
export type SignalStore = AsyncLocalStorage<SignalContext>

/**
 * Creates a new AsyncLocalStorage store for a signal instance. Called
 * exactly once per `createSignal()` call.
 */
export function createStore(): SignalStore {
  return new AsyncLocalStorage<SignalContext>()
}
