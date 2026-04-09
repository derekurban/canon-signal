/**
 * @module canon-signal/bridges/pino
 *
 * Pino → OTel LogRecord bridge. Returns a Node.js `Writable` stream
 * that Pino can use as a transport target.
 *
 * **Why this exists**: many existing projects use Pino as their logger.
 * Migrating to `signal.log` directly is the recommended steady-state,
 * but the bridge lets you keep your existing Pino calls and have them
 * automatically flow into canon-signal's LoggerProvider — including
 * auto-injection of `trace_id` and `span_id` when called inside a
 * request scope.
 *
 * Usage:
 * ```ts
 * import pino from 'pino'
 * import { signal } from './signal'
 * import { createPinoTransport } from 'canon-signal/bridges/pino'
 *
 * const logger = pino({}, createPinoTransport({ loggerProvider: signal.loggerProvider }))
 * ```
 *
 * **Test isolation**: pass `loggerProvider: signal.loggerProvider`
 * explicitly to bind the bridge to a specific signal instance.
 */

import { SeverityNumber } from '@opentelemetry/api-logs'
import type { Logger as OtelLogger, LoggerProvider } from '@opentelemetry/api-logs'
import { Writable } from 'node:stream'
import { resolveLogger, emitWithTraceContext } from './common.js'

/** Maps Pino's numeric levels (10-60) to OTel SeverityNumber. */
const PINO_TO_SEVERITY: Record<number, SeverityNumber> = {
  10: SeverityNumber.TRACE,
  20: SeverityNumber.DEBUG,
  30: SeverityNumber.INFO,
  40: SeverityNumber.WARN,
  50: SeverityNumber.ERROR,
  60: SeverityNumber.FATAL,
}

/** Maps Pino's numeric levels to user-facing severity text. */
const PINO_LEVEL_NAMES: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
}

/**
 * Options for `createPinoTransport()`.
 *
 * @property loggerProvider - Optional explicit `LoggerProvider`. If supplied, the bridge binds to it. If omitted, the bridge falls back to the global provider (set by `createSignal()`).
 * @property name - Logger name passed to `getLogger(name)`. Defaults to `'pino'`.
 */
export interface PinoTransportOptions {
  loggerProvider?: LoggerProvider
  name?: string
}

/**
 * Creates a Pino transport stream. The returned `Writable` can be passed
 * to Pino as a transport target.
 *
 * The stream receives newline-delimited JSON chunks from Pino, parses
 * each line, and forwards it as an OTel LogRecord with trace context
 * auto-injected.
 */
export function createPinoTransport(options?: PinoTransportOptions): Writable {
  const getLogger = resolveLogger(options?.loggerProvider, options?.name ?? 'pino')

  return new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      try {
        const text = chunk.toString()
        // Pino can write multiple newline-delimited records in one chunk
        for (const line of text.split('\n')) {
          if (!line.trim()) continue
          emitPinoLine(getLogger(), line)
        }
        callback()
      } catch (err) {
        callback(err as Error)
      }
    },
  })
}

/**
 * Parses a single Pino log line and emits it as an OTel LogRecord.
 *
 * Maps Pino fields:
 * - `level` (number) → `severityNumber`
 * - `msg` → `body`
 * - `time` → `timestamp`
 * - `pid`, `hostname` → discarded (Pino-internal noise)
 * - everything else → flattened into `attributes`
 *
 * Silently skips lines that fail to parse as JSON (Pino sometimes
 * writes setup messages during transport bootstrap).
 */
function emitPinoLine(logger: OtelLogger, line: string): void {
  let record: any
  try {
    record = JSON.parse(line)
  } catch {
    // Pino sometimes writes non-JSON output during transport setup; ignore
    return
  }

  const level = typeof record.level === 'number' ? record.level : 30
  const severityNumber = PINO_TO_SEVERITY[level] ?? SeverityNumber.INFO
  const severityText = PINO_LEVEL_NAMES[level] ?? 'INFO'

  const { msg, level: _level, time, pid: _pid, hostname: _host, ...rest } = record

  emitWithTraceContext(
    logger,
    severityNumber,
    severityText,
    msg ?? '',
    typeof time === 'number' ? time : Date.now(),
    rest,
  )
}
