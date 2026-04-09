/**
 * @module canon-signal/export/ring-buffer
 *
 * In-memory ring buffer exporter. Keeps the last N spans in memory
 * (default 1000), evicting the oldest when the buffer is full.
 *
 * **Intended use**: backing storage for in-process inspect/debug tools
 * — agents that need to query recent traces without writing to disk
 * or hitting an external backend. Pair with the inspect CLI's narrative
 * functions (`narrateTrace`) for structured introspection.
 *
 * Note: this exporter is currently not wired into the factory by
 * default. To use it, instantiate it manually and add it as an additional
 * SpanProcessor on the tracer provider, or extend the factory to support
 * a `'ring-buffer'` exporter type.
 */

import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'
import { ExportResultCode, type ExportResult } from '@opentelemetry/core'
import { SpanStatusCode } from '@opentelemetry/api'

/**
 * SpanExporter that retains the most recent N spans in memory. Useful
 * for in-process debugging tools and agent integrations.
 */
export class RingBufferExporter implements SpanExporter {
  private buffer: ReadableSpan[] = []
  private maxSize: number

  /**
   * @param maxSize - Maximum number of spans to retain. Default: 1000.
   */
  constructor(maxSize = 1000) {
    this.maxSize = maxSize
  }

  /**
   * Appends each incoming span to the buffer, evicting the oldest
   * spans once the buffer exceeds `maxSize`.
   */
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    for (const span of spans) {
      this.buffer.push(span)
      if (this.buffer.length > this.maxSize) {
        this.buffer.shift()
      }
    }
    resultCallback({ code: ExportResultCode.SUCCESS })
  }

  /** Returns a snapshot copy of the current buffer. Mutations don't affect storage. */
  getSpans(): ReadableSpan[] {
    return [...this.buffer]
  }

  /**
   * Groups buffered spans by trace ID and returns the last `count`
   * traces. With `errorsOnly: true`, filters to only traces that contain
   * at least one ERROR-status span.
   *
   * @param count - Maximum number of traces to return
   * @param errorsOnly - If true, only return traces containing errors
   */
  getRecentTraces(count: number, errorsOnly = false): ReadableSpan[][] {
    const byTrace = new Map<string, ReadableSpan[]>()
    for (const span of this.buffer) {
      const tid = span.spanContext().traceId
      if (!byTrace.has(tid)) byTrace.set(tid, [])
      byTrace.get(tid)!.push(span)
    }

    let traces = [...byTrace.values()]

    if (errorsOnly) {
      traces = traces.filter((spans) =>
        spans.some((s) => s.status.code === SpanStatusCode.ERROR),
      )
    }

    return traces.slice(-count)
  }

  async shutdown(): Promise<void> {
    this.buffer = []
  }

  async forceFlush(): Promise<void> {}
}

/** Factory function for the ring buffer exporter. */
export function createRingBufferExporter(maxSize?: number) {
  return new RingBufferExporter(maxSize)
}
