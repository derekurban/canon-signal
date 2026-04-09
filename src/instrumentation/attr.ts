/**
 * @module canon-signal/instrumentation/attr
 *
 * Implements `signal.attr`, `signal.attrs`, `signal.getAttr`, and
 * `signal.traceId` — the four functions for reading and writing
 * attributes on the root span of the current request.
 *
 * `createAttrInstrumentation()` returns all four methods as a single
 * object so the factory can spread them into the Signal instance.
 * Each method is a closure over the AsyncLocalStorage store — no
 * global state.
 *
 * **Why a parallel attributes Map**: OTel's `Span` interface intentionally
 * does not expose a `getAttribute(key)` reader (only writers). To make
 * `signal.getAttr()` work, every `signal.attr()` call writes to *both*
 * `rootSpan.setAttribute()` AND `ctx.attributes` (a `Map<string,
 * AttributeValue>`). The map is the source of truth for reads; the span
 * is the source of truth for export.
 */

import type { SignalAttributes } from '../types/attributes.js'
import type { SignalStore } from '../context/store.js'
import { getContext } from '../context/scope.js'

/**
 * Shape of the attribute instrumentation methods. Matches the
 * corresponding members on `Signal<T>`.
 */
export interface AttrInstrumentation<T extends SignalAttributes> {
  attr<K extends keyof T & string>(key: K, value: T[K]): void
  attrs(attributes: Partial<T>): void
  getAttr<K extends keyof T & string>(key: K): T[K] | undefined
  traceId(): string | undefined
}

/**
 * Builds the four attribute instrumentation methods bound to a signal's
 * context store.
 *
 * - `attr(key, value)` — set a single attribute on the root span, throws outside scope
 * - `attrs({...})` — set multiple attributes on the root span, throws outside scope
 * - `getAttr(key)` — read an attribute from the root span, throws outside scope
 * - `traceId()` — returns current trace ID or undefined (does not throw)
 */
export function createAttrInstrumentation<T extends SignalAttributes>(
  store: SignalStore,
): AttrInstrumentation<T> {
  return {
    attr<K extends keyof T & string>(key: K, value: T[K]): void {
      const ctx = getContext(store)
      ctx.rootSpan.setAttribute(key, value as any)
      ctx.attributes.set(key, value as any)
    },

    attrs(attributes: Partial<T>): void {
      const ctx = getContext(store)
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined) {
          ctx.rootSpan.setAttribute(key, value as any)
          ctx.attributes.set(key, value as any)
        }
      }
    },

    getAttr<K extends keyof T & string>(key: K): T[K] | undefined {
      const ctx = getContext(store)
      return ctx.attributes.get(key) as T[K] | undefined
    },

    traceId(): string | undefined {
      return store.getStore()?.traceId
    },
  }
}
