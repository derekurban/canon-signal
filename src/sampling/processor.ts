/**
 * @module canon-signal/sampling/processor
 *
 * The `TailSamplingProcessor` — outcome-aware sampling that decides
 * whether to export each span *after* the span has finished.
 *
 * Tail sampling (deciding at span end) is more useful than head sampling
 * (deciding at span start) because at the end of a span we know:
 * - Whether it errored
 * - How long it took
 * - What attributes it accumulated (user tier, route, feature flags, etc.)
 *
 * The processor wraps a delegate `SpanProcessor` and only forwards
 * `onEnd` events to the delegate when the sampling rules say "keep".
 * For dropped spans, the delegate never sees the data — no export
 * cost, no backend ingestion cost.
 *
 * Rules are evaluated in order; first match wins. The probabilistic
 * fallback uses a deterministic hash of the trace ID, so the same
 * trace produces the same decision across services and restarts —
 * preventing partial traces caused by independent random decisions.
 */

import type { Context } from '@opentelemetry/api'
import { SpanStatusCode } from '@opentelemetry/api'
import type { SpanProcessor, ReadableSpan } from '@opentelemetry/sdk-trace-base'
import type { SignalAttributes } from '../types/attributes.js'
import type { SamplingConfig } from '../types/config.js'

/**
 * Wraps a delegate `SpanProcessor` and conditionally forwards spans
 * based on the configured sampling rules.
 *
 * @template T - The user's attribute interface, used to type the
 * `alwaysKeep.attributes` config.
 */
export class TailSamplingProcessor<T extends SignalAttributes> implements SpanProcessor {
  private delegate: SpanProcessor
  private config: SamplingConfig<T>

  constructor(delegate: SpanProcessor, config: SamplingConfig<T>) {
    this.delegate = delegate
    this.config = config
  }

  /** Forwards span starts to the delegate without filtering — sampling decisions only happen on end. */
  onStart(span: any, parentContext: Context): void {
    this.delegate.onStart(span, parentContext)
  }

  /**
   * Evaluates the sampling rules. If `shouldExport()` returns true,
   * forwards to the delegate (which exports the span). If false,
   * drops the span — the delegate never sees it.
   */
  onEnd(span: ReadableSpan): void {
    if (this.shouldExport(span)) {
      this.delegate.onEnd(span)
    }
  }

  async shutdown(): Promise<void> {
    return this.delegate.shutdown()
  }

  async forceFlush(): Promise<void> {
    return this.delegate.forceFlush()
  }

  /**
   * Evaluates the sampling rules in order. First match wins.
   *
   * 1. **`app.debug === true`** — set by `signal.keep()`. Always export.
   * 2. **ERROR status** — when `alwaysKeep.errors` is true (default).
   * 3. **Slow requests** — duration exceeds `alwaysKeep.slowerThanMs`.
   * 4. **Route matching** — `http.route` is in `alwaysKeep.routes`.
   * 5. **Attribute matching** — any attribute matches `alwaysKeep.attributes`.
   * 6. **Probabilistic** — `hash(traceId) % 10000 < (defaultRate * 10000)`.
   *
   * The probabilistic hash uses the last 8 hex chars of the trace ID
   * (32 bits) and a modulo of 10000 for 0.01% precision. The decision
   * is deterministic: the same trace ID always produces the same result,
   * so independent services with the same `defaultRate` will agree on
   * which traces to export.
   */
  private shouldExport(span: ReadableSpan): boolean {
    const keep = this.config.alwaysKeep

    // Rule 1: app.debug (signal.keep())
    if (span.attributes['app.debug'] === true) return true

    // Rule 2: errors
    if (keep?.errors !== false && span.status.code === SpanStatusCode.ERROR) return true

    // Rule 3: slow requests
    if (keep?.slowerThanMs !== undefined) {
      const durationMs = (span.endTime[0] - span.startTime[0]) * 1000 +
        (span.endTime[1] - span.startTime[1]) / 1e6
      if (durationMs > keep.slowerThanMs) return true
    }

    // Rule 4: route matching
    if (keep?.routes?.length) {
      const route = span.attributes['http.route']
      if (typeof route === 'string' && keep.routes.includes(route)) return true
    }

    // Rule 5: attribute matching
    if (keep?.attributes) {
      for (const [key, values] of Object.entries(keep.attributes)) {
        if (values && Array.isArray(values)) {
          const attrVal = span.attributes[key]
          if (values.includes(attrVal as any)) return true
        }
      }
    }

    // Rule 6: probabilistic sampling based on traceId hash
    const rate = this.config.defaultRate ?? 1.0
    if (rate >= 1.0) return true
    if (rate <= 0.0) return false

    const traceId = span.spanContext().traceId
    const hash = parseInt(traceId.slice(-8), 16)
    return (hash % 10000) < (rate * 10000)
  }
}
