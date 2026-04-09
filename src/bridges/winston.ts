/**
 * @module canon-signal/bridges/winston
 *
 * Winston → OTel LogRecord bridge. Returns a Winston transport instance
 * that converts Winston log records into OTel LogRecords.
 *
 * Usage:
 * ```ts
 * import winston from 'winston'
 * import { signal } from './signal'
 * import { createWinstonTransport } from 'canon-signal/bridges/winston'
 *
 * const logger = winston.createLogger({
 *   transports: [createWinstonTransport({ loggerProvider: signal.loggerProvider })],
 * })
 * ```
 *
 * Like the Pino bridge, this auto-injects `trace_id` and `span_id`
 * from the active span when called inside a request scope.
 */

import { SeverityNumber } from '@opentelemetry/api-logs'
import type { LoggerProvider } from '@opentelemetry/api-logs'
import { resolveLogger, emitWithTraceContext } from './common.js'

/** Maps Winston level names to OTel SeverityNumber. */
const WINSTON_TO_SEVERITY: Record<string, SeverityNumber> = {
  silly: SeverityNumber.TRACE,
  debug: SeverityNumber.DEBUG,
  verbose: SeverityNumber.DEBUG,
  http: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
}

/** Maps Winston level names to user-facing severity text. */
const WINSTON_LEVEL_NAMES: Record<string, string> = {
  silly: 'TRACE',
  debug: 'DEBUG',
  verbose: 'DEBUG',
  http: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
}

/**
 * Options for `createWinstonTransport()`.
 *
 * @property loggerProvider - Optional explicit `LoggerProvider` for binding to a specific signal instance.
 * @property name - Logger name passed to `getLogger(name)`. Defaults to `'winston'`.
 * @property level - Winston log level. Defaults to `'silly'` to forward everything; set to e.g. `'info'` to filter at the transport.
 */
export interface WinstonTransportOptions {
  loggerProvider?: LoggerProvider
  name?: string
  level?: string
}

/**
 * Creates a Winston transport instance. Extends `winston-transport`'s
 * base `Transport` class.
 *
 * The transport strips Winston's internal `Symbol(level)` /
 * `Symbol(message)` / `Symbol(splat)` keys before mapping the rest to
 * OTel log record attributes. Trace context is auto-injected via the
 * shared `emitWithTraceContext` helper.
 */
export function createWinstonTransport(options?: WinstonTransportOptions): any {
  // Use require so winston-transport is only loaded when this function is called.
  // It's an optional peer dependency.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Transport = require('winston-transport')

  const getLogger = resolveLogger(options?.loggerProvider, options?.name ?? 'winston')

  class CanonSignalWinstonTransport extends Transport {
    constructor(opts: any) {
      super(opts)
    }

    log(info: any, callback: () => void): void {
      setImmediate(() => {
        try {
          const level = info.level ?? 'info'
          const severityNumber = WINSTON_TO_SEVERITY[level] ?? SeverityNumber.INFO
          const severityText = WINSTON_LEVEL_NAMES[level] ?? 'INFO'

          // Strip Winston's internal symbol-keyed fields and standard
          // top-level fields; everything else becomes log attributes.
          const {
            level: _level,
            message,
            timestamp,
            [Symbol.for('level')]: _symLevel,
            [Symbol.for('message')]: _symMsg,
            [Symbol.for('splat')]: _splat,
            ...rest
          } = info

          emitWithTraceContext(
            getLogger(),
            severityNumber,
            severityText,
            typeof message === 'string' ? message : JSON.stringify(message),
            typeof timestamp === 'number' ? timestamp : Date.now(),
            rest,
          )

          this.emit('logged', info)
        } catch (err) {
          this.emit('error', err)
        }
      })

      callback()
    }
  }

  return new CanonSignalWinstonTransport({ level: options?.level ?? 'silly' })
}
