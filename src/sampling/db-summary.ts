/**
 * @module canon-signal/sampling/db-summary
 *
 * The `DbSummaryProcessor` — automatically computes `app.db.total_duration_ms`
 * and `app.db.query_count` on every root span by accumulating data from
 * the trace's database child spans.
 *
 * **How it works**:
 * 1. As each child span ends, check whether it has a `db.system` attribute
 *    (set by `@opentelemetry/instrumentation-pg`, `instrumentation-mysql2`,
 *    `instrumentation-mongodb`, etc. on every database operation).
 * 2. If it's a DB span, accumulate its duration and increment a counter,
 *    keyed by trace ID.
 * 3. When the root span ends, write the accumulated totals onto the
 *    root span's attributes.
 *
 * **Caveat**: this works because in normal request lifecycles, child
 * spans (including DB spans) complete before the root span ends. If a
 * DB operation runs concurrently and hasn't completed when the root
 * span ends, its data is missed. The summary is best-effort, not
 * guaranteed exact — but the individual DB child spans in the trace
 * are always accurate, so the data isn't lost, just not aggregated.
 */

import type { Context } from '@opentelemetry/api'
import type { SpanProcessor, ReadableSpan, Span } from '@opentelemetry/sdk-trace-base'
import { isRootSpan, spanDurationMs } from '../util/span.js'

/** Per-trace accumulator for DB stats. Keyed by traceId in the processor. */
interface TraceAccumulator {
  totalDurationMs: number
  queryCount: number
}

/**
 * SpanProcessor that watches for database child spans and writes
 * summary stats onto the root span when the trace completes.
 */
export class DbSummaryProcessor implements SpanProcessor {
  /** Per-trace accumulators. Cleaned up on root span end. */
  private accumulators = new Map<string, TraceAccumulator>()

  onStart(_span: Span, _parentContext: Context): void {
    // No-op on start — we only care about completed spans where the
    // db.system attribute is finalized.
  }

  /**
   * Called when each span ends. Two responsibilities:
   *
   * 1. If the span is a DB span (has `db.system`), accumulate its
   *    duration and increment the count for its trace.
   *
   * 2. If the span is a root span, write the accumulated totals
   *    onto the root and clean up the accumulator.
   *
   * Both can happen on the same call if a single DB operation is
   * also somehow the root span (uncommon but possible for direct
   * DB-only requests).
   */
  onEnd(span: ReadableSpan): void {
    const traceId = span.spanContext().traceId

    // Check if this is a DB span (auto-instrumented DB spans have db.system attribute)
    if (span.attributes['db.system']) {
      const durationMs = spanDurationMs(span)

      let acc = this.accumulators.get(traceId)
      if (!acc) {
        acc = { totalDurationMs: 0, queryCount: 0 }
        this.accumulators.set(traceId, acc)
      }
      acc.totalDurationMs += durationMs
      acc.queryCount += 1
    }

    // If this is a root span, write accumulated DB stats and clean up
    if (isRootSpan(span)) {
      const acc = this.accumulators.get(traceId)
      if (acc) {
        // ReadableSpan is read-only by interface, but the underlying object
        // is mutable. We mutate it directly here because the OTel SDK
        // allows attribute mutation in the processor pipeline before
        // the span is committed to exporters.
        ;(span as any).attributes['app.db.total_duration_ms'] = Math.round(acc.totalDurationMs)
        ;(span as any).attributes['app.db.query_count'] = acc.queryCount
        this.accumulators.delete(traceId)
      }
    }
  }

  async shutdown(): Promise<void> {
    this.accumulators.clear()
  }

  async forceFlush(): Promise<void> {}
}
