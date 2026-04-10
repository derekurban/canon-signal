/**
 * @module canon-signal/factory/config
 *
 * Options normalization and environment variable resolution for the
 * factory.
 *
 * The user-facing `CreateSignalOptions<T>` type is what people pass to
 * `createSignal()`. The factory uses `NormalizedConfig<T>` (returned by
 * `normalizeConfig()`) which has env var overrides applied and any
 * default fields filled in.
 *
 * Supported environment variable overrides:
 *
 * - `OTEL_SERVICE_NAME` → `service.name`
 * - `OTEL_RESOURCE_ATTRIBUTES` → parsed and merged into resource attributes
 * - `OTEL_EXPORTER_OTLP_ENDPOINT` → default OTLP base `endpoint` for exporters that didn't specify one
 * - `OTEL_EXPORTER_OTLP_HEADERS` → parsed `key=value,key2=value2` merged into OTLP exporter headers
 * - `CANON_SIGNAL_SAMPLE_RATE` → overrides `sampling.defaultRate` (parsed as float)
 * - `CANON_SIGNAL_DEBUG` → when truthy, forces `defaultRate` to 1.0 and keeps every trace
 */

import type { SignalAttributes } from '../types/attributes.js'
import type {
  AllExporterConfig,
  CreateSignalOptions,
  ExporterConfig,
  ExportConfig,
  SamplingConfig,
  ServiceConfig,
} from '../types/config.js'

export interface NormalizedConfig<T extends SignalAttributes> {
  service: ServiceConfig
  schemaVersion: string
  options: CreateSignalOptions<T>
  /** Additional resource attributes parsed from `OTEL_RESOURCE_ATTRIBUTES`. */
  extraResourceAttributes: Record<string, string>
}

/**
 * Parses a comma-separated `key=value,key2=value2` string into an
 * object. Empty input returns an empty object.
 */
function parseKeyValueList(input: string | undefined): Record<string, string> {
  if (!input) return {}
  const result: Record<string, string> = {}
  for (const pair of input.split(',')) {
    const trimmed = pair.trim()
    if (!trimmed) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    if (key) result[key] = value
  }
  return result
}

/**
 * Returns true if the given env var value represents a truthy boolean
 * (`'1'`, `'true'`, `'yes'`, case-insensitive).
 */
function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes'].includes(value.toLowerCase())
}

/**
 * Applies env var overrides to a single exporter config. Only OTLP
 * exporters are affected — the endpoint falls back to
 * `OTEL_EXPORTER_OTLP_ENDPOINT` if not set, and env-supplied headers
 * are merged with any existing headers. The signal-specific OTLP path
 * is appended later when the exporter instance is created.
 */
function applyOtlpEnvOverrides(
  config: ExporterConfig,
  envHeaders: Record<string, string>,
): ExporterConfig {
  if (config.type !== 'otlp') return config

  const endpoint = config.endpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || ''
  const mergedHeaders = { ...envHeaders, ...(config.headers ?? {}) }

  return {
    ...config,
    endpoint,
    headers: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : config.headers,
  }
}

/**
 * Applies env var overrides to every exporter in an export config.
 * Returns a new config — never mutates the input.
 */
function applyExportEnvOverrides(exportConfig: ExportConfig | undefined): ExportConfig | undefined {
  if (!exportConfig) return undefined
  const envHeaders = parseKeyValueList(process.env.OTEL_EXPORTER_OTLP_HEADERS)
  const applyToList = <T extends AllExporterConfig>(configs: T[] | undefined): T[] | undefined => {
    return configs?.map((c) => applyOtlpEnvOverrides(c, envHeaders) as T)
  }

  return {
    all: applyToList(exportConfig.all),
    traces: applyToList(exportConfig.traces),
    logs: applyToList(exportConfig.logs),
    metrics: applyToList(exportConfig.metrics),
  }
}

/**
 * Applies sampling-related env var overrides:
 * - `CANON_SIGNAL_DEBUG` → forces defaultRate to 1.0 (keep everything)
 * - `CANON_SIGNAL_SAMPLE_RATE` → overrides defaultRate with the parsed float
 */
function applySamplingEnvOverrides<T extends SignalAttributes>(
  sampling: SamplingConfig<T> | undefined,
): SamplingConfig<T> | undefined {
  // CANON_SIGNAL_DEBUG wins if set
  if (isEnvTruthy(process.env.CANON_SIGNAL_DEBUG)) {
    return { ...sampling, defaultRate: 1.0 }
  }

  const rateOverride = process.env.CANON_SIGNAL_SAMPLE_RATE
  if (rateOverride !== undefined) {
    const parsed = parseFloat(rateOverride)
    if (!Number.isNaN(parsed)) {
      return { ...sampling, defaultRate: parsed }
    }
  }

  return sampling
}

/**
 * Normalizes user options into the internal config shape. Applies the
 * full set of documented env var overrides and produces a frozen
 * snapshot of the effective configuration.
 *
 * This function never mutates the input options object — every override
 * produces a new object so the original user config remains intact.
 */
export function normalizeConfig<T extends SignalAttributes>(
  options: CreateSignalOptions<T>,
): NormalizedConfig<T> {
  const service = { ...options.service }

  if (process.env.OTEL_SERVICE_NAME) {
    service.name = process.env.OTEL_SERVICE_NAME
  }

  const extraResourceAttributes = parseKeyValueList(process.env.OTEL_RESOURCE_ATTRIBUTES)

  const normalizedOptions: CreateSignalOptions<T> = {
    ...options,
    service,
    export: applyExportEnvOverrides(options.export),
    sampling: applySamplingEnvOverrides(options.sampling),
  }

  return {
    service,
    schemaVersion: options.schema.version,
    options: normalizedOptions,
    extraResourceAttributes,
  }
}
