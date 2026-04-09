/**
 * @module canon-signal/types/signal
 *
 * The public `Signal<T>` interface — the shape of the object returned
 * by `createSignal<T>()`. Every method on a signal instance is declared
 * here, with the generic parameter `T` flowing through to constrain
 * attribute keys and values at compile time.
 *
 * The factory function in `factory/create.ts` is the only place that
 * implements this interface; everywhere else (instrumentation, middleware,
 * tests, bridges) consumes it as a contract.
 */

import type { LoggerProvider } from '@opentelemetry/api-logs'
import type { SignalAttributes } from './attributes.js'
import type { AttributeValue, ReadableSpan, Span, SpanLink } from './otel.js'
import type { LoggerInterface, MeterInstrumentDef, MiddlewareOptions, SchemaConfig } from './config.js'
import type { InstrumentMap } from '../metrics/meter.js'

/**
 * Options for `signal.trace()` — used when creating a new root trace
 * for non-HTTP units of work (background jobs, message consumers, cron).
 *
 * @property links - Causal links to other traces (e.g. linking a consumer trace to its producer).
 * @property kind - OTel span kind. `'consumer'` for queue/message handlers, `'producer'` for outbound producers, `'internal'` for everything else (default).
 */
export interface TraceOptions {
  links?: SpanLink[]
  kind?: 'internal' | 'consumer' | 'producer'
}

/**
 * Test harness returned by `signal.test.harness()`. Reads spans and log
 * records from the in-memory exporters that every signal instance wires
 * in by default. Provides typed assertions where the key parameter is
 * constrained to `keyof T`.
 */
export interface TestHarness<T extends SignalAttributes> {
  /** Returns the most recent root span (a span with no parent), or undefined if none captured. */
  rootSpan(): ReadableSpan | undefined

  /** Returns every captured span (root and children) in completion order. */
  allSpans(): ReadableSpan[]

  /** Finds a single span by name, or undefined if no match. */
  findSpan(name: string): ReadableSpan | undefined

  /** Finds every span matching a name (e.g. multiple `db.query` spans in one trace). */
  findSpans(name: string): ReadableSpan[]

  /**
   * Asserts that a span has the expected attribute value. The `key`
   * parameter is constrained to `keyof T` for root spans (so typos are
   * compile errors), and the `expected` value is narrowed to `T[K]`.
   */
  assertAttr<K extends keyof T & string>(span: ReadableSpan, key: K, expected: T[K]): void

  /** Asserts a span's name matches exactly. */
  assertName(span: ReadableSpan, expected: string): void

  /** Asserts a span has the expected status code. */
  assertStatus(span: ReadableSpan, expected: 'OK' | 'ERROR' | 'UNSET'): void

  /** Asserts a span has an `exception` event, optionally with a specific exception type. */
  assertException(span: ReadableSpan, type?: string): void

  /** Asserts a span has a named event. */
  assertEvent(span: ReadableSpan, name: string): void

  /** Asserts every key listed in `schema.required` is present on the span. */
  assertRequired(span: ReadableSpan): void

  /** Asserts no captured span has ERROR status. */
  assertNoErrors(): void

  /** Returns captured log records emitted via `signal.log` or `signal.systemLog`. */
  logRecords(): unknown[]

  /** Clears all captured spans and log records. Call in `afterEach` to isolate tests. */
  reset(): void
}

/**
 * The fully-typed signal instance returned by `createSignal<T>()`.
 *
 * Every method that touches attributes is generic over `T`, so wrong
 * keys and wrong value types are compile errors. Methods that mutate
 * the active span (`attr`, `event`, `error`, `keep`) throw at runtime
 * if called outside a request scope.
 *
 * The `loggerProvider` field is exposed so logger bridges (Pino, Winston)
 * can be bound to this specific instance instead of the global provider
 * — useful for test isolation when multiple `createSignal()` calls happen.
 */
export interface Signal<T extends SignalAttributes> {
  // ─── Lifecycle ───────────────────────────────────────────────────

  /** Flushes pending spans, logs, and metrics, then shuts down all providers. */
  shutdown(): Promise<void>

  // ─── Middleware ──────────────────────────────────────────────────

  /**
   * Returns framework-appropriate middleware that creates the request
   * scope. Auto-detects Hono by default; pass `{ framework: ... }` to
   * override.
   */
  middleware(options?: MiddlewareOptions<T>): any

  // ─── Root span enrichment ────────────────────────────────────────

  /**
   * Sets a single attribute on the root span. Throws if called outside
   * a request scope. Both key and value are typed against `T`.
   */
  attr<K extends keyof T & string>(key: K, value: T[K]): void

  /** Sets multiple attributes on the root span in one call. */
  attrs(attributes: Partial<T>): void

  /** Reads an attribute back from the root span. Returns undefined if not set. */
  getAttr<K extends keyof T & string>(key: K): T[K] | undefined

  /** Returns the current trace ID, or `undefined` outside a request scope. Does not throw. */
  traceId(): string | undefined

  // ─── Spans and traces ────────────────────────────────────────────

  /**
   * Creates a child span of the current active span. Inside the callback,
   * the child becomes the active span (so nested spans nest correctly),
   * but `signal.attr()` still targets the root.
   */
  span<R>(name: string, fn: (span: Span) => R | Promise<R>): Promise<R>

  /**
   * Creates a brand new trace with its own root span. Used for non-HTTP
   * units of work — background jobs, queue consumers, scheduled tasks.
   * Inside the callback, the full request scope is active.
   */
  trace<R>(name: string, fn: () => R | Promise<R>, options?: TraceOptions): Promise<R>

  /**
   * Creates a `SpanLink` from a W3C `traceparent` string or explicit
   * `{traceId, spanId}` object. Pass to `signal.trace()` options to
   * connect causally related but separate traces.
   */
  link(traceparent: string | { traceId: string; spanId: string }): SpanLink

  // ─── Events and errors ───────────────────────────────────────────

  /**
   * Records a timestamped event on the active span (cache miss, retry,
   * state transition). Use for point-in-time occurrences during a span.
   */
  event(name: string, data?: Record<string, AttributeValue>): void

  /**
   * Records an exception on the active span and sets its status to
   * ERROR. Pairs with `signal.attr('app.error.code', ...)` (which
   * targets the root span) for full error context.
   */
  error(err: Error | unknown): void

  // ─── Sampling ────────────────────────────────────────────────────

  /**
   * Marks the current trace for guaranteed export, overriding all
   * sampling rules. Sets `app.debug = true` on the root span.
   */
  keep(): void

  // ─── Logging ─────────────────────────────────────────────────────

  /**
   * Context-aware structured logger. When called inside a request scope,
   * automatically attaches `trace_id` and `span_id` to the log record.
   * Outside a scope, emits a plain log record.
   */
  log: LoggerInterface

  /**
   * Process-scoped structured logger. Never attaches trace context, even
   * inside a request scope. For startup, shutdown, configuration events.
   */
  systemLog: LoggerInterface

  /**
   * The OTel `LoggerProvider` this signal owns. Pass to logger bridges
   * (`createPinoTransport({ loggerProvider: signal.loggerProvider })`)
   * when you need them bound to a specific signal instance instead of
   * the global provider.
   */
  loggerProvider: LoggerProvider

  // ─── Metrics ─────────────────────────────────────────────────────

  /**
   * Defines metric instruments. Returns a typed instrument map where
   * each entry has the right method (`.add`, `.set`, `.record`) for
   * its declared type. The conditional return type ensures users get
   * autocompletion on the returned map — e.g. `meters['app.orders'].add()`
   * works for counters, `.record()` for histograms, etc.
   */
  meter<D extends Record<string, MeterInstrumentDef>>(instruments: D): InstrumentMap<D>

  // ─── Introspection ───────────────────────────────────────────────

  /** Returns the active schema as a runtime object — `{ version, meta }`. */
  schema(): { version: string; meta?: SchemaConfig<T>['meta'] }

  // ─── Testing ─────────────────────────────────────────────────────

  /**
   * Lazy-loaded test harness. Accessing `signal.test.harness()` constructs
   * the harness on demand, reading from the in-memory exporters that
   * `createSignal()` always wires in.
   */
  test: {
    harness(): TestHarness<T>
  }
}
