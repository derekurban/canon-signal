/**
 * @module canon-signal/export/file
 *
 * JSONL file exporters for traces, logs, and metrics.
 *
 * Every exporter writes one signal-native object per line and includes
 * a top-level `signal` discriminator. That keeps `export.all` workable
 * even when the same file path is shared across traces/logs/metrics.
 *
 * **Use cases**:
 * - Local debugging without a backend
 * - CI artifact uploads (attach `telemetry.jsonl` to test runs)
 * - Forensic analysis of specific runs
 * - Agent-driven debugging (an AI agent can grep / parse the JSONL
 *   to find specific traces, logs, or metrics)
 */

import { writeFileSync, appendFileSync } from 'node:fs'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'
import type { ReadableLogRecord, LogRecordExporter } from '@opentelemetry/sdk-logs'
import type { MetricData, PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics'
import { ExportResultCode, hrTimeToMicroseconds, type ExportResult } from '@opentelemetry/core'

/**
 * SpanExporter that writes spans to a JSONL file. Each line is a single
 * span serialized with the fields needed by the inspect CLI plus a
 * `signal: 'trace'` discriminator:
 * traceId, spanId, parentSpanId, name, kind, startTime, endTime, status,
 * attributes, and events.
 *
 * **Truncates the file on construction**: every new signal instance
 * starts with a clean file. To accumulate across runs, use a different
 * file name per process or pre-rename the file before startup.
 */
export class FileSpanExporter implements SpanExporter {
  private path: string

  constructor(path: string) {
    this.path = path
    // Ensure file exists / truncate
    writeFileSync(this.path, '')
  }

  /**
   * Serializes the batch of spans as one JSON object per line and
   * appends them to the file. On any I/O error, returns FAILED so
   * the SpanProcessor can decide how to handle it (canon-signal's
   * SimpleSpanProcessor logs and continues).
   */
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    try {
      const lines = spans.map((span) => {
        return JSON.stringify({
          signal: 'trace',
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          parentSpanId: span.parentSpanId,
          name: span.name,
          kind: span.kind,
          startTime: span.startTime,
          endTime: span.endTime,
          status: span.status,
          attributes: span.attributes,
          events: span.events.map((e) => ({
            name: e.name,
            time: e.time,
            attributes: e.attributes,
          })),
        })
      })
      appendFileSync(this.path, lines.join('\n') + '\n')
      resultCallback({ code: ExportResultCode.SUCCESS })
    } catch {
      resultCallback({ code: ExportResultCode.FAILED })
    }
  }

  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}

/** Factory function for the file exporter. */
export function createFileSpanExporter(path: string) {
  return new FileSpanExporter(path)
}

/**
 * File-backed `LogRecordExporter`. Writes one log record per JSONL line.
 *
 * The line shape stays close to OTel's readable log record fields so
 * developers can grep it directly or feed it into downstream tooling
 * without needing a canon-signal-specific parser.
 */
export class FileLogExporter implements LogRecordExporter {
  private path: string

  constructor(path: string) {
    this.path = path
    writeFileSync(this.path, '')
  }

  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    try {
      const lines = logs.map((logRecord) => {
        return JSON.stringify({
          signal: 'log',
          timestamp: hrTimeToMicroseconds(logRecord.hrTime),
          observedTimestamp: hrTimeToMicroseconds(logRecord.hrTimeObserved),
          severityText: logRecord.severityText,
          severityNumber: logRecord.severityNumber,
          body: logRecord.body,
          traceId: logRecord.spanContext?.traceId,
          spanId: logRecord.spanContext?.spanId,
          resource: logRecord.resource.attributes,
          instrumentationScope: logRecord.instrumentationScope,
          attributes: logRecord.attributes,
        })
      })
      appendFileSync(this.path, lines.join('\n') + '\n')
      resultCallback({ code: ExportResultCode.SUCCESS })
    } catch {
      resultCallback({ code: ExportResultCode.FAILED })
    }
  }

  async shutdown(): Promise<void> {}
}

/**
 * Metric file exporter. Writes one metric record per JSONL line so each
 * line is grep-friendly even though metrics are collected/exported in
 * batches internally.
 */
export class FileMetricExporter implements PushMetricExporter {
  private path: string

  constructor(path: string) {
    this.path = path
    writeFileSync(this.path, '')
  }

  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    try {
      const lines: string[] = []
      for (const scopeMetrics of metrics.scopeMetrics) {
        for (const metric of scopeMetrics.metrics) {
          lines.push(
            JSON.stringify({
              signal: 'metric',
              resource: metrics.resource.attributes,
              instrumentationScope: scopeMetrics.scope,
              descriptor: metric.descriptor,
              aggregationTemporality: metric.aggregationTemporality,
              dataPointType: metric.dataPointType,
              isMonotonic: 'isMonotonic' in metric ? metric.isMonotonic : undefined,
              dataPoints: serializeMetricData(metric),
            }),
          )
        }
      }
      if (lines.length > 0) {
        appendFileSync(this.path, lines.join('\n') + '\n')
      }
      resultCallback({ code: ExportResultCode.SUCCESS })
    } catch {
      resultCallback({ code: ExportResultCode.FAILED })
    }
  }

  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

function serializeMetricData(metric: MetricData) {
  return metric.dataPoints.map((point) => ({
    startTime: point.startTime,
    endTime: point.endTime,
    attributes: point.attributes,
    value: point.value,
  }))
}

/** Factory function for the file-backed log exporter. */
export function createFileLogExporter(path: string) {
  return new FileLogExporter(path)
}

/** Factory function for the file-backed metric exporter. */
export function createFileMetricExporter(path: string) {
  return new FileMetricExporter(path)
}
