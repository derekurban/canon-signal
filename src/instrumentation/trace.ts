/**
 * @module canon-signal/instrumentation/trace
 *
 * Implements `signal.trace()` — creates a brand new trace with its own
 * root span, for non-HTTP units of work like background jobs and queue
 * consumers.
 */

import { type Tracer, SpanStatusCode, ROOT_CONTEXT, SpanKind } from '@opentelemetry/api'
import type { SignalStore, SignalContext } from '../context/store.js'
import type { TraceOptions } from '../types/signal.js'

/**
 * Maps the user-facing kind string to the OTel SpanKind enum.
 * Limited to the three kinds that make sense for `signal.trace()`:
 * `internal` (default — generic background work), `consumer` (queue/message
 * handlers), and `producer` (outbound message producers).
 */
const SPAN_KIND_MAP = {
  internal: SpanKind.INTERNAL,
  consumer: SpanKind.CONSUMER,
  producer: SpanKind.PRODUCER,
} as const

/**
 * Builds the `signal.trace(name, fn, options?)` function. Creates a new
 * root span (with `root: true` and `ROOT_CONTEXT`, ensuring no parent),
 * a fresh `SignalContext` with empty attributes, and runs the user
 * callback inside `store.run()` so the full request scope is active.
 *
 * Use this for:
 * - Background job processing (Bull, BullMQ, etc.)
 * - Queue consumers (Kafka, SQS, RabbitMQ)
 * - Scheduled tasks / cron jobs
 * - CLI command invocations
 * - Anywhere you need a unit of work that isn't an HTTP request
 *
 * Inside the callback, all the request-scope APIs work identically:
 * `signal.attr()`, `signal.span()`, `signal.error()`, `signal.log`,
 * `signal.keep()`, etc.
 *
 * The schema version is set automatically on the new root span (just
 * like middleware does for HTTP requests).
 *
 * On error: records the exception, sets ERROR status, ends the span,
 * and re-throws so the caller can handle the error.
 */
export function createTraceFn(store: SignalStore, tracer: Tracer, schemaVersion: string) {
  return async function trace<R>(
    name: string,
    fn: () => R | Promise<R>,
    options?: TraceOptions,
  ): Promise<R> {
    const spanKind = options?.kind ? SPAN_KIND_MAP[options.kind] : SpanKind.INTERNAL

    return tracer.startActiveSpan(
      name,
      {
        kind: spanKind,
        links: options?.links,
        root: true,
      },
      ROOT_CONTEXT,
      async (rootSpan) => {
        const traceId = rootSpan.spanContext().traceId
        const ctx: SignalContext = {
          rootSpan,
          activeSpan: rootSpan,
          traceId,
          attributes: new Map(),
        }

        rootSpan.setAttribute('app.schema.version', schemaVersion)

        try {
          const result = await store.run(ctx, fn)
          rootSpan.end()
          return result
        } catch (err) {
          rootSpan.recordException(err as Error)
          rootSpan.setStatus({ code: SpanStatusCode.ERROR })
          rootSpan.end()
          throw err
        }
      },
    )
  }
}
