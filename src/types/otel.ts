/**
 * @module canon-signal/types/otel
 *
 * Re-exports of OpenTelemetry types that user code may need to reference
 * directly (typically when setting attributes on child spans inside
 * `signal.span()` callbacks).
 *
 * Re-exporting these means consumers don't have to install
 * `@opentelemetry/api` themselves — canon-signal already does so as a
 * regular dependency, and these types ride along.
 */

/** OTel `Span` — passed to `signal.span()` callbacks for setting child attributes. */
export type {
  Span,
  SpanContext,
  Link as SpanLink,
  SpanKind,
} from '@opentelemetry/api'

/** Status codes used by `harness.assertStatus()` and exception handling. */
export { SpanStatusCode } from '@opentelemetry/api'

/** Read-only span shape returned by the test harness and inspect tooling. */
export type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

/** The set of values an attribute can hold (`string | number | boolean | string[] | number[] | boolean[]`). */
export type { AttributeValue } from '@opentelemetry/api'
