/**
 * @module canon-signal/export/otlp
 *
 * Thin wrappers around the OTLP/protobuf exporters from
 * `@opentelemetry/exporter-{trace,logs,metrics}-otlp-proto`.
 *
 * canon-signal currently only supports the protobuf wire format
 * (`http/protobuf`). gRPC support is reserved for a future version.
 */

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto'
import type { OtlpExporterConfig } from '../types/config.js'

/**
 * Creates an OTLP trace exporter from user config. Maps `endpoint`
 * and `headers` directly to the underlying OTel exporter constructor.
 */
export function createOtlpTraceExporter(config: OtlpExporterConfig) {
  return new OTLPTraceExporter({
    url: config.endpoint,
    headers: config.headers,
  })
}

/**
 * Creates an OTLP log exporter from user config.
 */
export function createOtlpLogExporter(config: OtlpExporterConfig) {
  return new OTLPLogExporter({
    url: config.endpoint,
    headers: config.headers,
  })
}

/**
 * Creates an OTLP metric exporter from user config. Currently unused
 * by `resolveExporters` (metric export is wired separately when needed),
 * but kept here for symmetry and future use.
 */
export function createOtlpMetricExporter(config: OtlpExporterConfig) {
  return new OTLPMetricExporter({
    url: config.endpoint,
    headers: config.headers,
  })
}
