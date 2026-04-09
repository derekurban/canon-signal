/**
 * @module canon-signal/util/span
 *
 * Small, dependency-free helpers for working with OTel `ReadableSpan`
 * objects. These replace inline duplication across the export,
 * sampling, testing, and inspect modules.
 *
 * Every function here is:
 * - Pure (no side effects, no OTel state access)
 * - Takes a `ReadableSpan` or its hr-time tuples
 * - Has no dependencies beyond `@opentelemetry/sdk-trace-base` and
 *   `@opentelemetry/api`
 */

import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { SpanStatusCode } from '@opentelemetry/api'

/** User-facing status text, used in test assertions and narratives. */
export type StatusText = 'OK' | 'ERROR' | 'UNSET'

/**
 * The "all zeros" span ID sentinel that OTel sometimes uses when a
 * span has no parent. Some code paths produce `undefined`, others
 * produce `'0000000000000000'`. Both indicate a root span.
 */
const NULL_SPAN_ID = '0000000000000000'

/**
 * Returns `true` if the given span has no parent — i.e. it's the root
 * span of its trace.
 *
 * Checks both the `undefined` case and the all-zeros sentinel, since
 * OTel is inconsistent about which it uses.
 */
export function isRootSpan(span: Pick<ReadableSpan, 'parentSpanId'>): boolean {
  const parentId = span.parentSpanId
  return !parentId || parentId === NULL_SPAN_ID
}

/**
 * Converts an OTel hr-time tuple (`[seconds, nanoseconds]`) to a
 * floating-point millisecond value. Useful for chronological sorting
 * and duration math.
 */
export function hrTimeToMs(time: readonly [number, number]): number {
  return time[0] * 1000 + time[1] / 1e6
}

/**
 * Computes the duration of a span in milliseconds from its start and
 * end hr-time tuples.
 *
 * Accepts raw hr-time tuples rather than a full span so it can be used
 * with serialized span data (e.g. the inspect CLI's parsed JSONL).
 */
export function hrDurationMs(
  startTime: readonly [number, number],
  endTime: readonly [number, number],
): number {
  return hrTimeToMs(endTime) - hrTimeToMs(startTime)
}

/**
 * Comparator for sorting spans chronologically by start time.
 * Use with `Array.prototype.sort`.
 */
export function compareByStartTime<S extends Pick<ReadableSpan, 'startTime'>>(
  a: S,
  b: S,
): number {
  return hrTimeToMs(a.startTime) - hrTimeToMs(b.startTime)
}

/** Convenience: compute duration in milliseconds for a full span. */
export function spanDurationMs(span: Pick<ReadableSpan, 'startTime' | 'endTime'>): number {
  return hrDurationMs(span.startTime, span.endTime)
}

/**
 * Formats a duration in milliseconds into a human-readable string:
 * - `<1ms` for sub-millisecond
 * - `42ms` for milliseconds (rounded)
 * - `1.23s` for seconds (two decimal places)
 */
export function formatDurationMs(ms: number): string {
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** Convenience: format a span's duration as a human-readable string. */
export function formatSpanDuration(
  span: Pick<ReadableSpan, 'startTime' | 'endTime'>,
): string {
  return formatDurationMs(spanDurationMs(span))
}

/**
 * Maps a span's `SpanStatusCode` to the user-facing status text.
 *
 * - `SpanStatusCode.OK` → `'OK'`
 * - `SpanStatusCode.ERROR` → `'ERROR'`
 * - `SpanStatusCode.UNSET` (or anything else) → `'UNSET'`
 */
export function spanStatusText(
  span: Pick<ReadableSpan, 'status'>,
): StatusText {
  if (span.status.code === SpanStatusCode.ERROR) return 'ERROR'
  if (span.status.code === SpanStatusCode.OK) return 'OK'
  return 'UNSET'
}

/**
 * Inverse of `spanStatusText`: converts user-facing text back to the
 * OTel `SpanStatusCode` enum value. Used by the test harness's
 * `assertStatus()` so consumers can write `'OK' | 'ERROR' | 'UNSET'`
 * instead of importing the OTel enum.
 */
export function statusTextToCode(text: StatusText): SpanStatusCode {
  switch (text) {
    case 'OK':
      return SpanStatusCode.OK
    case 'ERROR':
      return SpanStatusCode.ERROR
    case 'UNSET':
      return SpanStatusCode.UNSET
  }
}
