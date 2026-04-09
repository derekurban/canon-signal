/**
 * @module canon-signal/inspect/narrate
 *
 * Trace narrative generation — turns raw spans into a structured summary
 * suitable for AI agents and debugging tools.
 *
 * **The agent debugging story**: when an agent needs to understand what
 * happened in a trace, parsing raw OTel span objects is tedious. The
 * `narrateTrace()` function produces a `TraceNarrative` with:
 *
 * - A one-line `summary` ("POST /checkout for user usr_123 (enterprise) returned 500 in 847ms")
 * - A `timeline` of child spans with durations and statuses
 * - Top-level `rootAttributes` for the request context
 * - An identified `bottleneck` if one span dominates the duration
 * - An `errorChain` listing every ERROR-status span and its exception type
 *
 * The output is structured JSON, so an agent can parse it directly
 * without writing OTel-specific code.
 */

import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { SpanStatusCode } from '@opentelemetry/api'
import {
  isRootSpan,
  spanDurationMs,
  spanStatusText,
  compareByStartTime,
  type StatusText,
} from '../util/span.js'

/** Canon-signal-internal attributes excluded from narrative root attributes. */
const INTERNAL_ATTRS = new Set(['app.schema.version', 'app.debug', 'app.request.id'])

/**
 * The structured narrative output. All fields are JSON-serializable.
 */
export interface TraceNarrative {
  summary: string
  timeline: Array<{
    span: string
    duration: number
    status: StatusText
    error?: { type?: string; message?: string }
  }>
  rootAttributes: Record<string, unknown>
  bottleneck?: string
  errorChain: string[]
}

/**
 * Generates a `TraceNarrative` from a collection of spans belonging
 * to a single trace.
 *
 * @param spans - All spans for a single trace
 */
export function narrateTrace(spans: ReadableSpan[]): TraceNarrative {
  const root = spans.find(isRootSpan)

  if (!root) {
    return {
      summary: 'No root span found',
      timeline: [],
      rootAttributes: {},
      errorChain: [],
    }
  }

  const totalMs = spanDurationMs(root)
  const userId = root.attributes['app.user.id'] ?? 'unknown'
  const tier = root.attributes['app.customer.tier'] ?? ''
  const statusCode = root.attributes['http.response.status_code'] ?? ''

  const tierStr = tier ? ` (${tier})` : ''
  const summary = `${root.name} for user ${userId}${tierStr} returned ${statusCode} in ${Math.round(totalMs)}ms`

  // Build timeline of child spans, sorted chronologically
  const children = spans
    .filter((s) => s.spanContext().spanId !== root.spanContext().spanId)
    .sort(compareByStartTime)

  const timeline = children.map((span) => {
    const entry: TraceNarrative['timeline'][number] = {
      span: span.name,
      duration: Math.round(spanDurationMs(span)),
      status: spanStatusText(span),
    }
    if (span.status.code === SpanStatusCode.ERROR) {
      const exception = span.events.find((e) => e.name === 'exception')
      if (exception) {
        entry.error = {
          type: exception.attributes?.['exception.type'] as string | undefined,
          message: exception.attributes?.['exception.message'] as string | undefined,
        }
      }
    }
    return entry
  })

  // Find bottleneck (slowest child that dominates >50% of total duration)
  let bottleneck: string | undefined
  if (children.length > 0) {
    const slowest = children.reduce((a, b) =>
      spanDurationMs(a) > spanDurationMs(b) ? a : b,
    )
    const pct = Math.round((spanDurationMs(slowest) / totalMs) * 100)
    if (pct > 50) {
      bottleneck = `${slowest.name} (${pct}% of total duration)`
    }
  }

  // Build error chain — list every ERROR span with its exception type
  const errorChain: string[] = []
  for (const span of spans) {
    if (span.status.code === SpanStatusCode.ERROR) {
      const exception = span.events.find((e) => e.name === 'exception')
      const errType = exception?.attributes?.['exception.type'] ?? 'Error'
      errorChain.push(`${errType} in ${span.name}`)
    }
  }

  // Extract root attributes (app.* only, excluding canon-signal-internal ones)
  const rootAttributes: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(root.attributes)) {
    if (key.startsWith('app.') && !INTERNAL_ATTRS.has(key)) {
      rootAttributes[key] = value
    }
  }

  return { summary, timeline, rootAttributes, bottleneck, errorChain }
}
