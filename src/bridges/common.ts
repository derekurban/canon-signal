/**
 * @module canon-signal/bridges/common
 *
 * Shared helpers for the Pino and Winston bridges. Both bridges need
 * the same things:
 *
 * 1. **Resolve a logger** — prefer the user-supplied `LoggerProvider`,
 *    fall back to the globally registered one. Resolved fresh on every
 *    emit so provider replacements (e.g. test isolation) take effect.
 *
 * 2. **Emit with trace context** — build an OTel `LogRecord` with the
 *    given severity and body, auto-injecting `trace_id` and `span_id`
 *    from the active span when one exists.
 *
 * This module centralizes both concerns so the bridge implementations
 * only have to map their own level/field conventions to OTel.
 */

import { logs, SeverityNumber } from '@opentelemetry/api-logs'
import { trace } from '@opentelemetry/api'
import type { Logger as OtelLogger, LoggerProvider } from '@opentelemetry/api-logs'

/**
 * Returns a function that resolves an OTel logger fresh on every call.
 * If a `provider` is supplied, the logger is fetched from that specific
 * provider; otherwise the globally registered provider is used.
 *
 * No caching: the returned function re-resolves the logger on every
 * invocation so provider replacements take effect immediately. This is
 * essential for test isolation where multiple `createSignal()` calls
 * happen within a single test run.
 */
export function resolveLogger(
  provider: LoggerProvider | undefined,
  name: string,
): () => OtelLogger {
  return () => (provider ? provider.getLogger(name) : logs.getLogger(name))
}

/**
 * Emits a log record with the given severity/body/timestamp, auto-injecting
 * `trace_id` and `span_id` from the currently active span if one exists.
 *
 * The `extraAttributes` object is shallow-copied into the final attributes
 * map; callers should pass their already-flattened attribute bag.
 */
export function emitWithTraceContext(
  logger: OtelLogger,
  severityNumber: SeverityNumber,
  severityText: string,
  body: string,
  timestamp: number,
  extraAttributes: Record<string, any>,
): void {
  const attributes: Record<string, any> = { ...extraAttributes }

  const activeSpan = trace.getActiveSpan()
  if (activeSpan) {
    const spanCtx = activeSpan.spanContext()
    attributes.trace_id = spanCtx.traceId
    attributes.span_id = spanCtx.spanId
  }

  logger.emit({
    severityNumber,
    severityText,
    body,
    timestamp,
    attributes,
  })
}
