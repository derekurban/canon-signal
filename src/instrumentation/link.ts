/**
 * @module canon-signal/instrumentation/link
 *
 * Implements `signal.link()` — creates an OTel `Link` object from a
 * W3C `traceparent` header value or an explicit `{traceId, spanId}` object.
 *
 * Used with `signal.trace()` options to causally connect a new trace
 * to an existing one — for example, linking a queue consumer trace
 * back to the producer trace whose message it's processing.
 */

import type { SpanLink } from '../types/otel.js'
import { TraceFlags } from '@opentelemetry/api'

/**
 * Builds a `SpanLink` from either a W3C traceparent string
 * (`'00-<traceId>-<spanId>-<flags>'`) or an explicit
 * `{traceId, spanId}` object.
 *
 * @example
 * ```ts
 * await signal.trace('message.consume', async () => {
 *   // ...
 * }, {
 *   links: [signal.link(message.headers.traceparent)],
 *   kind: 'consumer',
 * })
 * ```
 *
 * @throws {Error} If the traceparent string has fewer than 4 dash-separated parts.
 */
export function parseTraceparent(
  traceparent: string | { traceId: string; spanId: string },
): SpanLink {
  if (typeof traceparent === 'string') {
    const parts = traceparent.split('-')
    if (parts.length < 4) {
      throw new Error(`canon-signal: Invalid traceparent format: ${traceparent}`)
    }
    return {
      context: {
        traceId: parts[1],
        spanId: parts[2],
        traceFlags: parseInt(parts[3], 16) as TraceFlags,
      },
    }
  }

  return {
    context: {
      traceId: traceparent.traceId,
      spanId: traceparent.spanId,
      traceFlags: TraceFlags.SAMPLED,
    },
  }
}
