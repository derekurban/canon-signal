/**
 * @module canon-signal/types/config
 *
 * Configuration types passed to `createSignal<T>()` and its subsystems.
 *
 * Every option that affects runtime behavior — service identity, schema
 * metadata, sampling rules, exporters, instrumentation toggles, SDK
 * limits, middleware options — is declared here. The generic parameter
 * `T extends SignalAttributes` flows through any option that references
 * attribute keys, so the user's interface constrains the config at compile
 * time as well.
 */

import type { SignalAttributes } from './attributes.js'
import type { AttributeValue } from './otel.js'

/**
 * Service identity. Becomes OTel resource attributes:
 * `service.name`, `service.version`, `deployment.environment.name`.
 *
 * @property name - Service name. Maps to `service.name`. Overridable via `OTEL_SERVICE_NAME`.
 * @property version - Deployed version or build SHA. Maps to `service.version`.
 * @property environment - `production`, `staging`, `development`. Maps to `deployment.environment.name`.
 * @property team - Optional owning team identifier. Becomes a custom resource attribute.
 */
export interface ServiceConfig {
  name: string
  version: string
  environment: string
  team?: string
}

/**
 * Per-attribute metadata for runtime tooling. Optional — attributes
 * without explicit metadata default to `sensitivity: 'public'`.
 *
 * @property sensitivity - PII classification. `'prohibited'` causes `createSignal()` to throw at startup.
 * @property description - Human/agent-readable description used by `signal.schema()` and inspect tooling.
 */
export interface AttributeMeta {
  sensitivity?: 'public' | 'internal' | 'sensitive' | 'prohibited'
  description?: string
}

/**
 * Schema configuration. The TypeScript interface `T` is the source of
 * truth for what attributes exist; this object adds runtime concerns
 * like the schema version and per-attribute metadata.
 *
 * @property version - Schema version, set on every root span as `app.schema.version`. Bump on breaking changes.
 * @property required - Explicit list of attribute keys that must be present on every root span. Checked by `harness.assertRequired()`.
 * @property meta - Optional per-attribute metadata (sensitivity, description). Validated at startup.
 */
export interface SchemaConfig<T extends SignalAttributes> {
  version: string
  required?: readonly (keyof T & string)[]
  meta?: Partial<Record<keyof T & string, AttributeMeta>>
}

/**
 * Tail-sampling configuration. Sampling decisions are made at span end
 * (post-execution), so the processor has full attribute and outcome data
 * to evaluate the rules below.
 *
 * @property alwaysKeep - Rules that force a span to be exported regardless of `defaultRate`.
 * @property defaultRate - Probability (0.0–1.0) for spans not matching any always-keep rule. Uses deterministic hash of trace ID for cross-service consistency.
 */
export interface SamplingConfig<T extends SignalAttributes> {
  alwaysKeep?: {
    /** Keep every ERROR-status span. Default: `true`. */
    errors?: boolean
    /** Keep spans whose duration exceeds this many milliseconds. */
    slowerThanMs?: number
    /** Keep spans whose `http.route` is in this list. */
    routes?: string[]
    /** Keep spans where the named attribute matches any value in the array. Keys typed to `T`. */
    attributes?: Partial<Record<keyof T & string, unknown[]>>
  }
  defaultRate?: number
}

/**
 * OTLP exporter configuration. Used for production export to any
 * OTLP-compatible backend (Grafana, Honeycomb, Datadog, etc).
 */
export interface OtlpExporterConfig {
  type: 'otlp'
  /**
   * Base OTLP collector endpoint URL. canon-signal appends the
   * signal-specific path (`/v1/traces`, `/v1/logs`, `/v1/metrics`) by
   * default so one collector URL can be shared across all signals.
   *
   * If you already have a signal-specific or proxy-specific full URL,
   * set `appendSignalPath: false` to use this value as-is.
   */
  endpoint: string
  /**
   * Whether canon-signal should append the default signal path when
   * constructing the final OTLP request URL. Defaults to `true`.
   *
   * Set to `false` for unusual collectors or proxies that expect an
   * exact custom URL rather than the standard `/v1/<signal>` routes.
   */
  appendSignalPath?: boolean
  /** OTLP wire format. Defaults to `'http/protobuf'`. */
  protocol?: 'http/protobuf' | 'grpc'
  /** Additional headers (e.g. `Authorization`) for OTLP requests. */
  headers?: Record<string, string>
}

/**
 * Pretty console exporter configuration. Renders a colored trace
 * waterfall to stdout — intended for development only.
 */
export interface PrettyConsoleExporterConfig {
  type: 'pretty-console'
  /** Reserved for future verbosity controls. */
  verbosity?: 'short' | 'full'
}

/**
 * Structured JSON console exporter configuration. Writes each span as
 * a JSON object to stdout — suitable for container environments that
 * collect stdout as logs.
 */
export interface ConsoleExporterConfig {
  type: 'console'
}

/**
 * File exporter configuration. Writes each span as a single line of
 * JSON to the specified file path.
 */
export interface FileExporterConfig {
  type: 'file'
  /** File path to write spans to. Required. */
  path: string
}

/**
 * Single exporter configuration — a discriminated union where the
 * `type` field determines which other fields are required. This gives
 * you compile-time guarantees (e.g. `{ type: 'file' }` without a `path`
 * is a compile error).
 */
export type AllExporterConfig =
  | OtlpExporterConfig
  | PrettyConsoleExporterConfig
  | ConsoleExporterConfig
  | FileExporterConfig

/**
 * Trace exporter configuration. Kept as its own alias even though the
 * currently supported destination types match `AllExporterConfig`.
 *
 * This avoids coupling every signal to one generic exporter union —
 * traces, logs, and metrics can diverge safely in a future release
 * without breaking the public shape of `ExportConfig`.
 */
export type TraceExporterConfig = AllExporterConfig

/** Log exporter configuration. See `TraceExporterConfig` note above. */
export type LogExporterConfig = AllExporterConfig

/** Metric exporter configuration. See `TraceExporterConfig` note above. */
export type MetricExporterConfig = AllExporterConfig

/**
 * Legacy generic exporter alias. Prefer the signal-specific aliases
 * above when typing trace/log/metric resolver code.
 */
export type ExporterConfig = AllExporterConfig

/**
 * Per-signal export configuration. Each signal type accepts an array
 * of destinations that all run in parallel.
 *
 * `all` is a shared baseline list applied to traces, logs, and metrics.
 * Signal-specific lists are appended after `all` with no deduplication.
 */
export interface ExportConfig {
  all?: AllExporterConfig[]
  traces?: TraceExporterConfig[]
  logs?: LogExporterConfig[]
  metrics?: MetricExporterConfig[]
}

/**
 * Toggles for `@opentelemetry/auto-instrumentations-node` categories.
 * Categories not listed (or set to `undefined`) use canon-signal's
 * defaults: HTTP/database/redis on, gRPC/messaging off.
 */
export interface InstrumentationConfig {
  http?: boolean
  database?: boolean
  redis?: boolean
  grpc?: boolean
  messaging?: boolean
}

/**
 * OTel SDK limits applied to span attributes.
 *
 * @property maxAttributesPerSpan - Default 200 (canon-signal raises this from OTel's stock 128 to accommodate rich canonical events).
 * @property maxAttributeValueLength - Default 2048 bytes per attribute value.
 */
export interface LimitsConfig {
  maxAttributesPerSpan?: number
  maxAttributeValueLength?: number
}

/**
 * Options accepted by `signal.middleware()`.
 *
 * @property framework - Which framework adapter to use. Defaults to `'hono'`.
 * @property requestIdHeader - Header name to read the request ID from. Defaults to `'x-request-id'`.
 * @property generateRequestId - Function to generate a request ID when the header is absent. Defaults to `crypto.randomUUID`.
 * @property defaultAttributes - Static attributes set on every root span (e.g. deploy SHA from env). Typed against `T`.
 */
export interface MiddlewareOptions<T extends SignalAttributes> {
  framework?: 'hono' | 'express' | 'fastify' | 'next'
  requestIdHeader?: string
  generateRequestId?: () => string
  defaultAttributes?: Partial<T>
}

/**
 * Common shape for both `signal.log` (context-aware) and `signal.systemLog`
 * (process-scoped). Both implement these methods identically; they only
 * differ in whether they auto-attach trace context.
 */
export interface LoggerInterface {
  trace(message: string, data?: Record<string, AttributeValue>): void
  debug(message: string, data?: Record<string, AttributeValue>): void
  info(message: string, data?: Record<string, AttributeValue>): void
  warn(message: string, data?: Record<string, AttributeValue>): void
  error(message: string, data?: Record<string, AttributeValue>): void
  fatal(message: string, data?: Record<string, AttributeValue>): void
}

/**
 * Definition of a single metric instrument passed to `signal.meter()`.
 *
 * @property type - `'counter'` (monotonic), `'gauge'` (bidirectional), or `'histogram'` (distribution).
 * @property unit - Human-readable unit (e.g. `'ms'`, `'orders'`, `'connections'`).
 * @property description - Description for the metric.
 * @property buckets - Optional explicit bucket boundaries for histograms.
 */
export interface MeterInstrumentDef {
  type: 'counter' | 'gauge' | 'histogram'
  unit: string
  description: string
  buckets?: number[]
}

/**
 * The complete options object accepted by `createSignal<T>()`. Only
 * `service` and `schema` are required; everything else has sensible
 * defaults appropriate for development.
 */
export interface CreateSignalOptions<T extends SignalAttributes> {
  service: ServiceConfig
  schema: SchemaConfig<T>
  sampling?: SamplingConfig<T>
  export?: ExportConfig
  instrumentation?: InstrumentationConfig
  limits?: LimitsConfig
}
