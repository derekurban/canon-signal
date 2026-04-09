/**
 * @module canon-signal/logging/logger
 *
 * Shared logger factory used by both `signal.log` (context-aware) and
 * `signal.systemLog` (process-scoped). Previously these were two
 * near-identical modules; the only difference was whether the logger
 * attached trace context from the store on each emit.
 *
 * The consolidated factory takes an optional `contextInjector` callback
 * that mutates a pre-built attributes object:
 *
 * - For `signal.log`: the injector reads the AsyncLocalStorage store
 *   and adds `trace_id`/`span_id` when a scope is active.
 * - For `signal.systemLog`: no injector is passed, so records are
 *   emitted without trace context regardless of scope.
 */

import type { Logger as OtelLogger } from '@opentelemetry/api-logs'
import { SeverityNumber } from '@opentelemetry/api-logs'
import type { AttributeValue } from '../types/otel.js'
import type { LoggerInterface } from '../types/config.js'
import type { SignalStore } from '../context/store.js'

/** Maps user-facing severity names to OTel's SeverityNumber enum. */
const SEVERITY_MAP = {
  trace: SeverityNumber.TRACE,
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
  fatal: SeverityNumber.FATAL,
} as const

type Severity = keyof typeof SEVERITY_MAP

/**
 * Function that enriches a log record's attributes in place. Used by
 * `signal.log` to inject trace context; omitted for `signal.systemLog`.
 */
type AttributeEnricher = (attributes: Record<string, AttributeValue>) => void

/**
 * Builds a single severity method bound to a specific OTel logger,
 * severity level, and optional enricher.
 */
function buildLogMethod(
  otelLogger: OtelLogger,
  severity: Severity,
  enricher?: AttributeEnricher,
) {
  return function (message: string, data?: Record<string, AttributeValue>): void {
    const attributes: Record<string, AttributeValue> = { ...data }
    enricher?.(attributes)

    otelLogger.emit({
      severityNumber: SEVERITY_MAP[severity],
      severityText: severity.toUpperCase(),
      body: message,
      attributes,
    })
  }
}

/**
 * Builds a complete `LoggerInterface` with all six severity methods.
 *
 * @param otelLogger - The OTel logger the methods emit through
 * @param enricher - Optional callback to enrich attributes before emit (e.g. inject trace context)
 */
export function buildLogger(
  otelLogger: OtelLogger,
  enricher?: AttributeEnricher,
): LoggerInterface {
  return {
    trace: buildLogMethod(otelLogger, 'trace', enricher),
    debug: buildLogMethod(otelLogger, 'debug', enricher),
    info: buildLogMethod(otelLogger, 'info', enricher),
    warn: buildLogMethod(otelLogger, 'warn', enricher),
    error: buildLogMethod(otelLogger, 'error', enricher),
    fatal: buildLogMethod(otelLogger, 'fatal', enricher),
  }
}

/**
 * Creates the context-aware `signal.log`. Each emit checks the store
 * and attaches `trace_id`/`span_id` when inside a request scope.
 */
export function createContextAwareLogger(
  store: SignalStore,
  otelLogger: OtelLogger,
): LoggerInterface {
  return buildLogger(otelLogger, (attributes) => {
    const ctx = store.getStore()
    if (ctx) {
      attributes.trace_id = ctx.traceId
      attributes.span_id = ctx.activeSpan.spanContext().spanId
    }
  })
}

/**
 * Creates the process-scoped `signal.systemLog`. Never attaches trace
 * context, even when called inside a request scope.
 */
export function createSystemLogger(otelLogger: OtelLogger): LoggerInterface {
  return buildLogger(otelLogger)
}
