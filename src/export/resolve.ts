/**
 * @module canon-signal/export/resolve
 *
 * Resolves user-supplied export config into concrete OTel pipeline pieces.
 *
 * Traces and logs are exporter-based. Metrics are reader-based. Keeping
 * those concerns separate is the key design fix behind issues #1 and #2:
 *
 * - logs can now support the same destination family as traces without
 *   pretending they share the same implementation
 * - metrics are no longer silently ignored, because they resolve into
 *   `MetricReader` instances that are passed to `MeterProvider`
 *
 * `export.all` acts as a baseline list for every signal. Signal-specific
 * lists are appended after it with order preserved and no deduplication.
 */

import type { SpanExporter } from '@opentelemetry/sdk-trace-base'
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import type { LogRecordExporter } from '@opentelemetry/sdk-logs'
import { InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs'
import { PeriodicExportingMetricReader, type MetricReader } from '@opentelemetry/sdk-metrics'
import type {
  ExportConfig,
  LogExporterConfig,
  MetricExporterConfig,
  TraceExporterConfig,
} from '../types/config.js'
import {
  createOtlpTraceExporter,
  createOtlpLogExporter,
  createOtlpMetricExporter,
} from './otlp.js'
import {
  createConsoleLogExporter,
  createConsoleMetricExporter,
  createConsoleSpanExporter,
} from './console.js'
import {
  createPrettyConsoleExporter,
  createPrettyConsoleLogExporter,
  createPrettyConsoleMetricExporter,
} from './pretty-console.js'
import {
  createFileLogExporter,
  createFileMetricExporter,
  createFileSpanExporter,
} from './file.js'

/**
 * The resolved pipeline pieces used by the factory.
 *
 * In-memory trace/log exporters are always present so the test harness
 * retains a stable source of truth regardless of user export config.
 * Metrics intentionally stay black-box in tests for now, so no in-memory
 * metric reader is added here.
 */
export interface ResolvedExporters {
  spanExporters: SpanExporter[]
  logExporters: LogRecordExporter[]
  metricReaders: MetricReader[]
  inMemorySpanExporter: InMemorySpanExporter
  inMemoryLogExporter: InMemoryLogRecordExporter
}

function resolveTraceExporter(config: TraceExporterConfig): SpanExporter {
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

function resolveLogExporter(config: LogExporterConfig): LogRecordExporter {
  switch (config.type) {
    case 'otlp':
      return createOtlpLogExporter(config)
    case 'console':
      return createConsoleLogExporter()
    case 'pretty-console':
      return createPrettyConsoleLogExporter()
    case 'file':
      return createFileLogExporter(config.path)
  }
}

function resolveMetricReader(config: MetricExporterConfig): MetricReader {
  switch (config.type) {
    case 'otlp':
      return createMetricReader(createOtlpMetricExporter(config))
    case 'console':
      return createMetricReader(createConsoleMetricExporter())
    case 'pretty-console':
      return createMetricReader(createPrettyConsoleMetricExporter())
    case 'file':
      return createMetricReader(createFileMetricExporter(config.path))
  }
}

function createMetricReader(
  exporter: ReturnType<
    | typeof createOtlpMetricExporter
    | typeof createConsoleMetricExporter
    | typeof createPrettyConsoleMetricExporter
    | typeof createFileMetricExporter
  >,
): MetricReader {
  return new PeriodicExportingMetricReader({ exporter })
}

function mergeSignalExporters<T>(
  shared: T[] | undefined,
  specific: T[] | undefined,
): T[] {
  return [...(shared ?? []), ...(specific ?? [])]
}

function mergeExportConfig(exportConfig?: ExportConfig) {
  return {
    traces: mergeSignalExporters(exportConfig?.all, exportConfig?.traces),
    logs: mergeSignalExporters(exportConfig?.all, exportConfig?.logs),
    metrics: mergeSignalExporters(exportConfig?.all, exportConfig?.metrics),
  }
}

export function resolveExporters(exportConfig?: ExportConfig): ResolvedExporters {
  const merged = mergeExportConfig(exportConfig)

  const inMemorySpanExporter = new InMemorySpanExporter()
  const inMemoryLogExporter = new InMemoryLogRecordExporter()

  const spanExporters: SpanExporter[] = [inMemorySpanExporter]
  const logExporters: LogRecordExporter[] = [inMemoryLogExporter]
  const metricReaders: MetricReader[] = []

  for (const cfg of merged.traces) {
    spanExporters.push(resolveTraceExporter(cfg))
  }

  for (const cfg of merged.logs) {
    logExporters.push(resolveLogExporter(cfg))
  }

  for (const cfg of merged.metrics) {
    metricReaders.push(resolveMetricReader(cfg))
  }

  return {
    spanExporters,
    logExporters,
    metricReaders,
    inMemorySpanExporter,
    inMemoryLogExporter,
  }
}
