import type { LoggerProvider } from '@opentelemetry/api-logs'
import type { SignalAttributes } from './attributes.js'
import type { AttributeValue, ReadableSpan, Span, SpanLink } from './otel.js'
import type {
  LoggerInterface,
  MiddlewareOptions,
  SamplingConfig,
  SchemaConfig,
  ServiceConfig,
  OtlpExporterConfig,
  PrettyConsoleExporterConfig,
  ConsoleExporterConfig,
} from './config.js'
import type { TestHarness, TraceOptions } from './signal.js'

export type WorkerEnv = Record<string, string | undefined>

export type WorkerExporterConfig =
  | OtlpExporterConfig
  | PrettyConsoleExporterConfig
  | ConsoleExporterConfig

export interface WorkerExportConfig {
  all?: WorkerExporterConfig[]
  traces?: WorkerExporterConfig[]
  logs?: WorkerExporterConfig[]
}

export interface WorkerCreateSignalOptions<T extends SignalAttributes> {
  service: ServiceConfig
  schema: SchemaConfig<T>
  sampling?: SamplingConfig<T>
  export?: WorkerExportConfig
  limits?: {
    maxAttributesPerSpan?: number
    maxAttributeValueLength?: number
  }
  /**
   * Cloudflare Worker bindings or another explicit environment object.
   * Workers do not expose Node's `process.env`, so Worker env overrides
   * must be passed in deliberately.
   */
  env?: WorkerEnv
}

export interface WorkerSignal<T extends SignalAttributes> {
  shutdown(): Promise<void>
  /** Flushes pending trace and log exports without shutting down providers. */
  flush(): Promise<void>
  middleware(options?: MiddlewareOptions<T>): any
  attr<K extends keyof T & string>(key: K, value: T[K]): void
  attrs(attributes: Partial<T>): void
  getAttr<K extends keyof T & string>(key: K): T[K] | undefined
  traceId(): string | undefined
  span<R>(name: string, fn: (span: Span) => R | Promise<R>): Promise<R>
  trace<R>(name: string, fn: () => R | Promise<R>, options?: TraceOptions): Promise<R>
  link(traceparent: string | { traceId: string; spanId: string }): SpanLink
  event(name: string, data?: Record<string, AttributeValue>): void
  error(err: Error | unknown): void
  keep(): void
  log: LoggerInterface
  systemLog: LoggerInterface
  loggerProvider: LoggerProvider
  schema(): { version: string; meta?: SchemaConfig<T>['meta'] }
  test: {
    harness(): TestHarness<T>
  }
}

export type WorkerReadableSpan = ReadableSpan
