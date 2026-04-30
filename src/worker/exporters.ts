import type { SpanExporter } from '@opentelemetry/sdk-trace-base'
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import type { LogRecordExporter } from '@opentelemetry/sdk-logs'
import { InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs'
import type { WorkerExportConfig, WorkerExporterConfig } from '../types/worker.js'
import {
  createConsoleLogExporter,
  createConsoleSpanExporter,
} from '../export/console.js'
import {
  createPrettyConsoleExporter,
  createPrettyConsoleLogExporter,
} from '../export/pretty-console.js'
import {
  createWorkerOtlpLogExporter,
  createWorkerOtlpTraceExporter,
} from './otlp.js'

export interface ResolvedWorkerExporters {
  spanExporters: SpanExporter[]
  logExporters: LogRecordExporter[]
  inMemorySpanExporter: InMemorySpanExporter
  inMemoryLogExporter: InMemoryLogRecordExporter
}

function resolveTraceExporter(config: WorkerExporterConfig): SpanExporter {
  switch (config.type) {
    case 'otlp':
      return createWorkerOtlpTraceExporter(config)
    case 'console':
      return createConsoleSpanExporter()
    case 'pretty-console':
      return createPrettyConsoleExporter()
  }
}

function resolveLogExporter(config: WorkerExporterConfig): LogRecordExporter {
  switch (config.type) {
    case 'otlp':
      return createWorkerOtlpLogExporter(config)
    case 'console':
      return createConsoleLogExporter()
    case 'pretty-console':
      return createPrettyConsoleLogExporter()
  }
}

function mergeSignalExporters<T>(
  shared: T[] | undefined,
  specific: T[] | undefined,
): T[] {
  return [...(shared ?? []), ...(specific ?? [])]
}

export function resolveWorkerExporters(exportConfig?: WorkerExportConfig): ResolvedWorkerExporters {
  const inMemorySpanExporter = new InMemorySpanExporter()
  const inMemoryLogExporter = new InMemoryLogRecordExporter()
  const spanExporters: SpanExporter[] = [inMemorySpanExporter]
  const logExporters: LogRecordExporter[] = [inMemoryLogExporter]

  for (const config of mergeSignalExporters(exportConfig?.all, exportConfig?.traces)) {
    spanExporters.push(resolveTraceExporter(config))
  }

  for (const config of mergeSignalExporters(exportConfig?.all, exportConfig?.logs)) {
    logExporters.push(resolveLogExporter(config))
  }

  return {
    spanExporters,
    logExporters,
    inMemorySpanExporter,
    inMemoryLogExporter,
  }
}
