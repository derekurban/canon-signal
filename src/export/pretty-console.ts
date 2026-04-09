/**
 * @module canon-signal/export/pretty-console
 *
 * Human-friendly console exporters for local development.
 *
 * The trace exporter is the richest of the three because traces have
 * natural parent/child structure. Logs and metrics intentionally use a
 * lighter presentation: one readable line per log record or metric item.
 *
 * This keeps `pretty-console` consistent across all three signals while
 * still respecting the fact that traces, logs, and metrics are emitted
 * through different OTel SDK abstractions.
 */

import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs'
import type { PushMetricExporter, ResourceMetrics, MetricData } from '@opentelemetry/sdk-metrics'
import { ExportResultCode, type ExportResult } from '@opentelemetry/core'
import { SpanStatusCode } from '@opentelemetry/api'
import { isRootSpan, formatSpanDuration, compareByStartTime } from '../util/span.js'

// ANSI escape codes for terminal colors
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const MAGENTA = '\x1b[35m'
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

/**
 * Pretty log exporter. Produces one concise colored line per record with
 * enough context to read a stream directly in the terminal.
 */
export class PrettyConsoleLogExporter implements LogRecordExporter {
  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    for (const logRecord of logs) {
      const severity = logRecord.severityText ?? 'INFO'
      const color = severityColor(severity)
      const timestamp = formatLogTime(logRecord.hrTime)
      const message = formatValue(logRecord.body)
      const traceInfo = logRecord.spanContext
        ? `${DIM}trace=${logRecord.spanContext.traceId}${RESET} ${DIM}span=${logRecord.spanContext.spanId}${RESET}`
        : ''
      const attrs = formatAttrMap(logRecord.attributes)
      const suffix = [traceInfo, attrs].filter(Boolean).join('  ')
      console.log(
        `${DIM}${timestamp}${RESET} ${BOLD}${color}${severity}${RESET} ${message}${suffix ? `  ${suffix}` : ''}`,
      )
    }
    resultCallback({ code: ExportResultCode.SUCCESS })
  }

  async shutdown(): Promise<void> {}
}

/**
 * Pretty metric exporter. Each export cycle is rendered as a compact
 * batch with one line per metric so developers can inspect values
 * without wading through raw SDK object dumps.
 */
export class PrettyConsoleMetricExporter implements PushMetricExporter {
  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    if (metrics.scopeMetrics.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS })
      return
    }

    console.log(`${BOLD}${MAGENTA}Metrics${RESET}`)
    for (const scopeMetrics of metrics.scopeMetrics) {
      for (const metric of scopeMetrics.metrics) {
        const type = dataPointTypeLabel(metric.dataPointType)
        const values = metric.dataPoints
          .map((point) => {
            const attrs = formatAttrMap(point.attributes)
            const rendered = formatMetricValue(metric, point.value)
            return attrs ? `${rendered} ${DIM}${attrs}${RESET}` : rendered
          })
          .join(`${DIM} | ${RESET}`)

        console.log(
          ` ${DIM}└─${RESET} ${CYAN}${metric.descriptor.name}${RESET} ${DIM}[${type}${metric.descriptor.unit ? ` ${metric.descriptor.unit}` : ''}]${RESET} ${values}`,
        )
      }
    }
    console.log()

    resultCallback({ code: ExportResultCode.SUCCESS })
  }

  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

/** Factory function for the pretty log exporter. */
export function createPrettyConsoleLogExporter() {
  return new PrettyConsoleLogExporter()
}

/** Factory function for the pretty metric exporter. */
export function createPrettyConsoleMetricExporter() {
  return new PrettyConsoleMetricExporter()
}

function severityColor(severity: string): string {
  switch (severity.toUpperCase()) {
    case 'ERROR':
    case 'FATAL':
      return RED
    case 'WARN':
      return YELLOW
    case 'DEBUG':
    case 'TRACE':
      return CYAN
    default:
      return GREEN
  }
}

function formatLogTime(hrTime: [number, number]): string {
  const millis = hrTime[0] * 1000 + Math.floor(hrTime[1] / 1_000_000)
  return new Date(millis).toISOString()
}

function formatAttrMap(attributes: Record<string, unknown>): string {
  const entries = Object.entries(attributes)
  if (entries.length === 0) return ''
  return entries.map(([key, value]) => `${key}=${formatValue(value)}`).join(' ')
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
    return String(value)
  }
  return JSON.stringify(value)
}

function dataPointTypeLabel(dataPointType: MetricData['dataPointType']): string {
  switch (dataPointType) {
    case 0:
      return 'histogram'
    case 1:
      return 'exp-histogram'
    case 2:
      return 'gauge'
    case 3:
      return 'sum'
    default:
      return 'metric'
  }
}

function formatMetricValue(metric: MetricData, value: MetricData['dataPoints'][number]['value']): string {
  switch (metric.dataPointType) {
    case 0:
    case 1:
      return `count=${(value as { count?: number }).count ?? 0} sum=${(value as { sum?: number }).sum ?? 0}`
    case 2:
    case 3:
    default:
      return String(value)
  }
}
