/**
 * @module canon-signal/inspect/query
 *
 * In-memory span filtering helpers. Used by the inspect CLI and the
 * (future) MCP debugging tool surface.
 *
 * These functions operate on `ReadableSpan[]` arrays — typically pulled
 * from the ring buffer exporter or the test harness — and return
 * filtered subsets. They never touch disk or external services.
 */

import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { SpanStatusCode } from '@opentelemetry/api'

/**
 * Returns only spans with ERROR status. Useful for surfacing failed
 * operations from a larger captured set.
 */
export function filterByErrors(spans: ReadableSpan[]): ReadableSpan[] {
  return spans.filter((s) => s.status.code === SpanStatusCode.ERROR)
}

/**
 * Returns only spans matching a specific HTTP route (the `http.route`
 * attribute set by canon-signal middleware).
 */
export function filterByRoute(spans: ReadableSpan[], route: string): ReadableSpan[] {
  return spans.filter((s) => s.attributes['http.route'] === route)
}

/**
 * Generic attribute filter. Returns spans where the given attribute
 * key exactly matches the given value.
 */
export function filterByAttribute(
  spans: ReadableSpan[],
  key: string,
  value: unknown,
): ReadableSpan[] {
  return spans.filter((s) => s.attributes[key] === value)
}

/**
 * Groups a flat span array into a map keyed by trace ID. Each entry
 * is the array of spans belonging to that trace, in insertion order.
 */
export function groupByTraceId(spans: ReadableSpan[]): Map<string, ReadableSpan[]> {
  const map = new Map<string, ReadableSpan[]>()
  for (const span of spans) {
    const tid = span.spanContext().traceId
    if (!map.has(tid)) map.set(tid, [])
    map.get(tid)!.push(span)
  }
  return map
}
