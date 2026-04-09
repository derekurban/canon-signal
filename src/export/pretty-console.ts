/**
 * @module canon-signal/export/pretty-console
 *
 * The "dev waterfall" exporter — collects spans by trace ID and renders
 * each completed trace as a colored tree to stdout when its root span
 * arrives.
 *
 * **Why this exists**: in development, raw JSON span output is hard to
 * read at a glance. The pretty-console exporter groups spans by trace,
 * shows the request method/route as a header, lists child spans with
 * indentation and durations, and surfaces key `app.*` attributes at the
 * bottom — making each request feel like a single readable unit.
 *
 * **How it works**:
 * - On every `export()` call, spans are buffered in a per-trace map
 * - When a root span arrives (no parent), the entire trace is rendered
 *   and removed from the buffer
 * - Children are sorted by start time so the waterfall reads top-to-bottom
 * - Errors are highlighted in red, success in green
 */

import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'
import { ExportResultCode, type ExportResult } from '@opentelemetry/core'
import { SpanStatusCode } from '@opentelemetry/api'
import { isRootSpan, formatSpanDuration, compareByStartTime } from '../util/span.js'

// ANSI escape codes for terminal colors
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'

/** Canon-signal-internal attributes that shouldn't appear in the attribute footer. */
const INTERNAL_ATTRS = new Set(['app.schema.version', 'app.debug', 'app.request.id'])

/**
 * Returns the ANSI color code for a span based on its status.
 * Red for errors, green for success/UNSET.
 */
function statusColor(span: ReadableSpan): string {
  if (span.status.code === SpanStatusCode.ERROR) return RED
  return GREEN
}

/**
 * The pretty-console SpanExporter. Buffers spans per trace and renders
 * the full tree when a root span completes.
 */
export class PrettyConsoleExporter implements SpanExporter {
  /** Per-trace buffer of pending spans, keyed by traceId. */
  private pending = new Map<string, ReadableSpan[]>()

  /**
   * Receives spans from the SpanProcessor pipeline. Buffers each span
   * by trace ID. When a root span arrives, renders the trace and
   * removes it from the buffer.
   *
   * Always returns SUCCESS — rendering failures (e.g. broken stdout)
   * are non-fatal and silently swallowed.
   */
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    for (const span of spans) {
      const traceId = span.spanContext().traceId
      if (!this.pending.has(traceId)) {
        this.pending.set(traceId, [])
      }
      this.pending.get(traceId)!.push(span)

      if (isRootSpan(span)) {
        this.renderTrace(traceId, span)
        this.pending.delete(traceId)
      }
    }
    resultCallback({ code: ExportResultCode.SUCCESS })
  }

  async shutdown(): Promise<void> {
    this.pending.clear()
  }

  async forceFlush(): Promise<void> {}

  /**
   * Renders a single trace as a tree to stdout. Layout:
   *
   * ```
   * POST /checkout  200  847ms
   *  ├─ auth.verify  12ms
   *  ├─ db.query SELECT users  3ms
   *  └─ payment.process  780ms
   *  └─ user=usr_123  tier=enterprise
   * ```
   */
  private renderTrace(traceId: string, rootSpan: ReadableSpan): void {
    const allSpans = this.pending.get(traceId) ?? [rootSpan]
    const statusCode = rootSpan.attributes['http.response.status_code'] ?? ''
    const color = statusColor(rootSpan)
    const duration = formatSpanDuration(rootSpan)

    // Header line
    console.log(
      `${BOLD}${color}${rootSpan.name}${RESET}  ${color}${statusCode}${RESET}  ${DIM}${duration}${RESET}`,
    )

    // Build span tree — children only, sorted chronologically
    const children = allSpans
      .filter((s) => s.spanContext().spanId !== rootSpan.spanContext().spanId)
      .sort(compareByStartTime)

    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      const isLast = i === children.length - 1
      const prefix = isLast ? ' └─ ' : ' ├─ '
      const childColor = statusColor(child)
      const childDuration = formatSpanDuration(child)
      console.log(
        `${DIM}${prefix}${RESET}${childColor}${child.name}${RESET}  ${DIM}${childDuration}${RESET}`,
      )
    }

    // Show key attributes from root span (filtering out canon-signal internals)
    const attrKeys = Object.keys(rootSpan.attributes).filter(
      (k) => k.startsWith('app.') && !INTERNAL_ATTRS.has(k),
    )
    if (attrKeys.length > 0) {
      const attrs = attrKeys
        .map((k) => `${CYAN}${k.replace('app.', '')}${RESET}=${rootSpan.attributes[k]}`)
        .join('  ')
      console.log(` ${DIM}└─${RESET} ${attrs}`)
    }

    console.log()
  }
}

/** Factory function for the pretty console exporter. */
export function createPrettyConsoleExporter() {
  return new PrettyConsoleExporter()
}
