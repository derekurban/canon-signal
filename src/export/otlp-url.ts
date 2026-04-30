import type { OtlpExporterConfig } from '../types/config.js'

export function resolveOtlpUrl(
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
