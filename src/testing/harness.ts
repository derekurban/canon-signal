/**
 * @module canon-signal/testing/harness
 *
 * Implements `createTestHarness` — a typed test harness that reads
 * from in-memory exporters wired into the factory.
 *
 * The harness lets test code:
 * - Find spans by name or by parent relationship
 * - Assert attribute values, span names, statuses, exception events
 * - Verify that all required schema attributes are present
 * - Read captured log records (from `signal.log` and `signal.systemLog`)
 * - Reset state between tests
 *
 * Type safety: `assertAttr<K>(span, key, expected)` constrains `key`
 * to `keyof T` and `expected` to `T[K]`, so misspelled attribute names
 * and wrong value types are compile errors in test code.
 */

import type { InMemorySpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base'
import type { InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs'
import { SpanStatusCode } from '@opentelemetry/api'
import type { SignalAttributes } from '../types/attributes.js'
import type { TestHarness } from '../types/signal.js'
import { isRootSpan, statusTextToCode, spanStatusText } from '../util/span.js'

/**
 * Creates a test harness bound to a specific signal instance's
 * in-memory exporters.
 *
 * Called internally by `signal.test.harness()` — users don't typically
 * call this directly. The `inMemorySpanExporter` and `inMemoryLogExporter`
 * are pulled from the factory's `resolveExporters()` result.
 *
 * @param exporter - In-memory span exporter (always present in every signal)
 * @param requiredKeys - Schema-declared required attribute keys (used by `assertRequired`)
 * @param logExporter - Optional in-memory log exporter for `logRecords()` and `reset()`
 */
export function createTestHarness<T extends SignalAttributes>(
  exporter: InMemorySpanExporter,
  requiredKeys?: readonly string[],
  logExporter?: InMemoryLogRecordExporter,
): TestHarness<T> {
  return {
    /**
     * Returns the most recent root span (a span with no parent).
     * If multiple traces have completed, returns the first matching
     * root in the exporter's order.
     */
    rootSpan(): ReadableSpan | undefined {
      return exporter.getFinishedSpans().find(isRootSpan)
    },

    /** Returns a copy of every captured span (root and children). */
    allSpans(): ReadableSpan[] {
      return [...exporter.getFinishedSpans()]
    },

    /** Finds the first span matching a name. Returns undefined if no match. */
    findSpan(name: string): ReadableSpan | undefined {
      return exporter.getFinishedSpans().find((s) => s.name === name)
    },

    /** Finds every span matching a name (e.g. multiple `db.query` spans). */
    findSpans(name: string): ReadableSpan[] {
      return exporter.getFinishedSpans().filter((s) => s.name === name)
    },

    /**
     * Asserts that a span has the expected attribute value. The `key`
     * parameter is constrained to `keyof T` so misspelled attribute
     * names are compile errors. The `expected` value is narrowed to
     * the type declared at that key.
     *
     * @throws {Error} If the attribute value doesn't match.
     */
    assertAttr<K extends keyof T & string>(
      span: ReadableSpan,
      key: K,
      expected: T[K],
    ): void {
      const actual = span.attributes[key]
      if (actual !== expected) {
        throw new Error(
          `canon-signal assertion failed: attribute "${key}" expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        )
      }
    },

    /** @throws {Error} If the span name doesn't match. */
    assertName(span: ReadableSpan, expected: string): void {
      if (span.name !== expected) {
        throw new Error(
          `canon-signal assertion failed: span name expected "${expected}", got "${span.name}"`,
        )
      }
    },

    /**
     * Asserts a span's status. Accepts user-facing names (`'OK'`,
     * `'ERROR'`, `'UNSET'`) so tests don't have to import the OTel
     * enum.
     *
     * @throws {Error} If the status doesn't match.
     */
    assertStatus(span: ReadableSpan, expected: 'OK' | 'ERROR' | 'UNSET'): void {
      const expectedCode = statusTextToCode(expected)
      if (span.status.code !== expectedCode) {
        throw new Error(
          `canon-signal assertion failed: span status expected "${expected}", got "${spanStatusText(span)}"`,
        )
      }
    },

    /**
     * Asserts that a span has at least one `exception` event. With the
     * optional `type` parameter, asserts the exception type matches
     * (read from `exception.type` event attribute).
     *
     * @throws {Error} If no exception event exists, or if `type` is supplied and doesn't match.
     */
    assertException(span: ReadableSpan, type?: string): void {
      const exceptionEvent = span.events.find((e) => e.name === 'exception')
      if (!exceptionEvent) {
        throw new Error('canon-signal assertion failed: no exception event found on span')
      }
      if (type && exceptionEvent.attributes?.['exception.type'] !== type) {
        throw new Error(
          `canon-signal assertion failed: exception type expected "${type}", got "${exceptionEvent.attributes?.['exception.type']}"`,
        )
      }
    },

    /**
     * Asserts that a span has a named event. The error message lists
     * all events on the span for easier debugging.
     *
     * @throws {Error} If no event with the given name exists.
     */
    assertEvent(span: ReadableSpan, name: string): void {
      const found = span.events.find((e) => e.name === name)
      if (!found) {
        throw new Error(
          `canon-signal assertion failed: no event named "${name}" found on span. Events: ${span.events.map((e) => e.name).join(', ') || '(none)'}`,
        )
      }
    },

    /**
     * Asserts that every key listed in `schema.required` is present
     * on the span. No-op if no required keys are configured.
     *
     * @throws {Error} If any required key is missing. Error message lists all missing keys.
     */
    assertRequired(span: ReadableSpan): void {
      if (!requiredKeys || requiredKeys.length === 0) return
      const missing = requiredKeys.filter((key) => !(key in span.attributes))
      if (missing.length > 0) {
        throw new Error(
          `canon-signal assertion failed: required attributes missing: ${missing.join(', ')}`,
        )
      }
    },

    /**
     * Asserts that no captured span has ERROR status.
     *
     * @throws {Error} If any span has ERROR status. Error message lists their names.
     */
    assertNoErrors(): void {
      const errorSpans = exporter
        .getFinishedSpans()
        .filter((s) => s.status.code === SpanStatusCode.ERROR)
      if (errorSpans.length > 0) {
        throw new Error(
          `canon-signal assertion failed: ${errorSpans.length} span(s) have ERROR status: ${errorSpans.map((s) => s.name).join(', ')}`,
        )
      }
    },

    /**
     * Returns captured log records (from `signal.log` or `signal.systemLog`).
     * Returns an empty array if no log exporter is provided. The actual
     * shape is OTel's `LogRecord` but typed as `unknown[]` here for API
     * stability.
     */
    logRecords(): unknown[] {
      return logExporter ? logExporter.getFinishedLogRecords() : []
    },

    /**
     * Clears all captured spans and log records. Call in `afterEach`
     * to ensure tests are isolated.
     */
    reset(): void {
      exporter.reset()
      logExporter?.reset()
    },
  }
}
