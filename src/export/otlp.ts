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
 * Resolves canon-signal's OTLP endpoint semantics into the exact URL
 * expected by the underlying JS SDK exporters.
 *
 * canon-signal treats `endpoint` as a base collector URL by default so
 * one config entry can drive traces, logs, and metrics together. The
 * SDK's `url` option, however, is the full request URL. This helper
 * bridges that mismatch while preserving an explicit escape hatch for
 * unusual proxy routes via `appendSignalPath: false`.
 */
function resolveOtlpUrl(
  config: OtlpExporterConfig,
  signalPath: '/v1/traces' | '/v1/logs' | '/v1/metrics',
): string {
  if (config.appendSignalPath === false) {
    return config.endpoint
  }

  try {
    const url = new URL(config.endpoint)
    if (url.pathname.endsWith(signalPath)) {
      return url.toString()
    }

    url.pathname = `${url.pathname.replace(/\/+$/, '')}${signalPath}`
    return url.toString()
  } catch {
    if (config.endpoint.endsWith(signalPath)) {
      return config.endpoint
    }

    return `${config.endpoint.replace(/\/+$/, '')}${signalPath}`
  }
}

/**
 * Creates an OTLP trace exporter from user config.
 */
export function createOtlpTraceExporter(config: OtlpExporterConfig) {
  return new OTLPTraceExporter({
    url: resolveOtlpUrl(config, '/v1/traces'),
    headers: config.headers,
  })
}

/**
 * Creates an OTLP log exporter from user config.
 */
export function createOtlpLogExporter(config: OtlpExporterConfig) {
  return new OTLPLogExporter({
    url: resolveOtlpUrl(config, '/v1/logs'),
    headers: config.headers,
  })
}

/**
 * Creates an OTLP metric exporter from user config. Metrics are wired
 * through `PeriodicExportingMetricReader`, so this factory returns the
 * push exporter that the reader wraps.
 */
export function createOtlpMetricExporter(config: OtlpExporterConfig) {
  return new OTLPMetricExporter({
    url: resolveOtlpUrl(config, '/v1/metrics'),
    headers: config.headers,
  })
}
