/**
 * @module canon-signal/worker
 *
 * Cloudflare Worker-compatible entry point. This path avoids Node-only
 * OpenTelemetry SDKs, auto-instrumentation, file exporters, and logger
 * bridges while preserving canon-signal's typed trace-first API for
 * Hono-based Worker applications.
 */

export { createWorkerSignal } from './worker/create.js'
export type {
  WorkerCreateSignalOptions,
  WorkerEnv,
  WorkerExportConfig,
  WorkerExporterConfig,
  WorkerSignal,
} from './types/worker.js'
export type { SignalAttributes } from './types/attributes.js'
