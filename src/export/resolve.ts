/**
 * @module canon-signal/export/resolve
 *
 * Resolves user-supplied `ExporterConfig` objects into concrete OTel
 * `SpanExporter` and `LogRecordExporter` instances.
 *
 * The factory calls `resolveExporters(options.export)` once at startup
 * and uses the returned instances to wire up SpanProcessors and
 * LogRecordProcessors. **In-memory exporters are always added at the
 * front of each array** so the test harness has something to read from
 * regardless of user configuration — that's why every signal instance,
 * even one configured for production OTLP export, supports
 * `signal.test.harness()`.
 */

import type { SpanExporter } from '@opentelemetry/sdk-trace-base'
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import type { LogRecordExporter } from '@opentelemetry/sdk-logs'
import { InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs'
import type { ExporterConfig, ExportConfig } from '../types/config.js'
import { createOtlpTraceExporter, createOtlpLogExporter } from './otlp.js'
import { createConsoleSpanExporter } from './console.js'
import { createPrettyConsoleExporter } from './pretty-console.js'
import { createFileSpanExporter } from './file.js'

/**
 * The set of exporters returned by `resolveExporters`.
 *
 * @property spanExporters - All trace exporters in pipeline order. Always starts with the in-memory exporter.
 * @property logExporters - All log exporters in pipeline order. Always starts with the in-memory exporter.
 * @property inMemorySpanExporter - The in-memory span exporter (also at the front of `spanExporters`). Exposed separately so the test harness can be wired to it directly.
 * @property inMemoryLogExporter - The in-memory log exporter (also at the front of `logExporters`). Exposed separately so the test harness can read log records.
 */
export interface ResolvedExporters {
  spanExporters: SpanExporter[]
  logExporters: LogRecordExporter[]
  inMemorySpanExporter: InMemorySpanExporter
  inMemoryLogExporter: InMemoryLogRecordExporter
}

/**
 * Dispatches a single exporter config to the right factory function
 * based on `config.type`. The discriminated union type ensures each
 * case has access to the fields it needs without any runtime checks.
 */
function resolveTraceExporter(config: ExporterConfig): SpanExporter {
  switch (config.type) {
    case 'otlp':
      return createOtlpTraceExporter(config)
    case 'console':
      return createConsoleSpanExporter()
    case 'pretty-console':
      return createPrettyConsoleExporter()
    case 'file':
      return createFileSpanExporter(config.path)
  }
}

/**
 * Dispatches a log exporter config. Currently only OTLP is supported
 * for logs — pretty-console, console, and file are trace-only.
 *
 * @throws {Error} If a non-OTLP log exporter type is supplied.
 */
function resolveLogExporter(config: ExporterConfig): LogRecordExporter {
  if (config.type === 'otlp') {
    return createOtlpLogExporter(config)
  }
  throw new Error(
    `canon-signal: Unsupported log exporter type: ${config.type}. Use 'otlp'.`,
  )
}

/**
 * Resolves the user's `ExportConfig` into concrete exporter instances.
 *
 * The in-memory exporters are *always* created and *always* placed at
 * the front of their respective arrays. User-supplied exporters are
 * appended after them. This ensures:
 *
 * 1. The test harness has access to the in-memory exporters regardless
 *    of user config
 * 2. In tests, only the in-memory exporters need to fire to make
 *    assertions pass — the user's OTLP exporters can fail silently
 *    without breaking the test
 */
export function resolveExporters(exportConfig?: ExportConfig): ResolvedExporters {
  // Always create in-memory exporters for the test harness
  const inMemorySpanExporter = new InMemorySpanExporter()
  const inMemoryLogExporter = new InMemoryLogRecordExporter()

  const spanExporters: SpanExporter[] = [inMemorySpanExporter]
  const logExporters: LogRecordExporter[] = [inMemoryLogExporter]

  if (exportConfig?.traces) {
    for (const cfg of exportConfig.traces) {
      spanExporters.push(resolveTraceExporter(cfg))
    }
  }

  if (exportConfig?.logs) {
    for (const cfg of exportConfig.logs) {
      logExporters.push(resolveLogExporter(cfg))
    }
  }

  return { spanExporters, logExporters, inMemorySpanExporter, inMemoryLogExporter }
}
