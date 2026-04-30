import type { SignalAttributes } from '../types/attributes.js'
import type { WorkerCreateSignalOptions, WorkerEnv, WorkerExportConfig } from '../types/worker.js'
import type { WorkerExporterConfig } from '../types/worker.js'
import type { SamplingConfig, ServiceConfig } from '../types/config.js'

export interface NormalizedWorkerConfig<T extends SignalAttributes> {
  service: ServiceConfig
  schemaVersion: string
  options: WorkerCreateSignalOptions<T>
  extraResourceAttributes: Record<string, string>
}

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

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes'].includes(value.toLowerCase())
}

function applyOtlpEnvOverrides(
  config: WorkerExporterConfig,
  env: WorkerEnv,
  envHeaders: Record<string, string>,
): WorkerExporterConfig {
  if (config.type !== 'otlp') return config

  const endpoint = config.endpoint || env.OTEL_EXPORTER_OTLP_ENDPOINT || ''
  const mergedHeaders = { ...envHeaders, ...(config.headers ?? {}) }

  return {
    ...config,
    endpoint,
    headers: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : config.headers,
  }
}

function applyExportEnvOverrides(
  exportConfig: WorkerExportConfig | undefined,
  env: WorkerEnv,
): WorkerExportConfig | undefined {
  if (!exportConfig) return undefined
  const envHeaders = parseKeyValueList(env.OTEL_EXPORTER_OTLP_HEADERS)
  const applyToList = (configs: WorkerExporterConfig[] | undefined) =>
    configs?.map((config) => applyOtlpEnvOverrides(config, env, envHeaders))

  return {
    all: applyToList(exportConfig.all),
    traces: applyToList(exportConfig.traces),
    logs: applyToList(exportConfig.logs),
  }
}

function applySamplingEnvOverrides<T extends SignalAttributes>(
  sampling: SamplingConfig<T> | undefined,
  env: WorkerEnv,
): SamplingConfig<T> | undefined {
  if (isEnvTruthy(env.CANON_SIGNAL_DEBUG)) {
    return { ...sampling, defaultRate: 1.0 }
  }

  const rateOverride = env.CANON_SIGNAL_SAMPLE_RATE
  if (rateOverride !== undefined) {
    const parsed = parseFloat(rateOverride)
    if (!Number.isNaN(parsed)) {
      return { ...sampling, defaultRate: parsed }
    }
  }

  return sampling
}

export function normalizeWorkerConfig<T extends SignalAttributes>(
  options: WorkerCreateSignalOptions<T>,
): NormalizedWorkerConfig<T> {
  const env = options.env ?? {}
  const service = { ...options.service }

  if (env.OTEL_SERVICE_NAME) {
    service.name = env.OTEL_SERVICE_NAME
  }

  const normalizedOptions: WorkerCreateSignalOptions<T> = {
    ...options,
    service,
    export: applyExportEnvOverrides(options.export, env),
    sampling: applySamplingEnvOverrides(options.sampling, env),
  }

  return {
    service,
    schemaVersion: options.schema.version,
    options: normalizedOptions,
    extraResourceAttributes: parseKeyValueList(env.OTEL_RESOURCE_ATTRIBUTES),
  }
}
