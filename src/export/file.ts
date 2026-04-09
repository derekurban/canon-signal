/**
 * @module canon-signal/export/file
 *
 * JSONL file exporter. Writes each span as a single line of JSON to a
 * file on disk. The output format is compatible with `npx canon-signal
 * inspect --file <path>`, which reads the file back and renders trace
 * waterfalls.
 *
 * **Use cases**:
 * - Local debugging without a backend
 * - CI artifact uploads (attach `traces.jsonl` to test runs)
 * - Forensic analysis of specific runs
 * - Agent-driven debugging (an AI agent can grep / parse the JSONL
 *   to find specific traces)
 */

import { writeFileSync, appendFileSync } from 'node:fs'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'
import { ExportResultCode, type ExportResult } from '@opentelemetry/core'

/**
 * SpanExporter that writes spans to a JSONL file. Each line is a single
 * span serialized with the fields needed by the inspect CLI:
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
