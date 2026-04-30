import type { ExportResult } from '@opentelemetry/core'
import { ExportResultCode } from '@opentelemetry/core'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs'
import { ProtobufTraceSerializer, ProtobufLogsSerializer } from '@opentelemetry/otlp-transformer'
import type { OtlpExporterConfig } from '../types/config.js'
import { resolveOtlpUrl } from '../export/otlp-url.js'

type SignalPath = '/v1/traces' | '/v1/logs'

async function postOtlp(
  config: OtlpExporterConfig,
  signalPath: SignalPath,
  body: Uint8Array,
): Promise<void> {
  const response = await fetch(resolveOtlpUrl(config, signalPath), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-protobuf',
      ...(config.headers ?? {}),
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`canon-signal: OTLP export failed with HTTP ${response.status}`)
  }
}

function toExportResult(error?: unknown): ExportResult {
  if (!error) return { code: ExportResultCode.SUCCESS }
  return {
    code: ExportResultCode.FAILED,
    error: error instanceof Error ? error : new Error(String(error)),
  }
}

export class WorkerOtlpTraceExporter implements SpanExporter {
  constructor(private readonly config: OtlpExporterConfig) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const body = ProtobufTraceSerializer.serializeRequest(spans)
    if (!body) {
      resultCallback(toExportResult())
      return
    }

    void postOtlp(this.config, '/v1/traces', body)
      .then(() => resultCallback(toExportResult()))
      .catch((error) => resultCallback(toExportResult(error)))
  }

  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}

export class WorkerOtlpLogExporter implements LogRecordExporter {
  constructor(private readonly config: OtlpExporterConfig) {}

  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    const body = ProtobufLogsSerializer.serializeRequest(logs)
    if (!body) {
      resultCallback(toExportResult())
      return
    }

    void postOtlp(this.config, '/v1/logs', body)
      .then(() => resultCallback(toExportResult()))
      .catch((error) => resultCallback(toExportResult(error)))
  }

  async shutdown(): Promise<void> {}
}

export function createWorkerOtlpTraceExporter(config: OtlpExporterConfig): SpanExporter {
  return new WorkerOtlpTraceExporter(config)
}

export function createWorkerOtlpLogExporter(config: OtlpExporterConfig): LogRecordExporter {
  return new WorkerOtlpLogExporter(config)
}
