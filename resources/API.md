# canon-signal API Reference

Complete reference for every public method on the `signal` instance returned by `createSignal<T>()`. For each method: signature, parameters, return type, behavior, and what it throws.

The generic parameter `T extends SignalAttributes` is your project's attribute interface. It flows through every method that touches attributes, providing compile-time type safety.

---

## Setup

### `createSignal<T>(options): Signal<T>`

Creates and initializes a fully-typed signal instance. Call once at application startup, in a dedicated `src/signal.ts` file.

**Signature**:

```typescript
function createSignal<T extends SignalAttributes>(
  options: CreateSignalOptions<T>,
): Signal<T>
```

**Required options**:

| Field | Type | Description |
|---|---|---|
| `service.name` | `string` | Service name. Maps to OTel `service.name`. Overridable via `OTEL_SERVICE_NAME`. |
| `service.version` | `string` | Deployed version or build SHA. Maps to `service.version`. |
| `service.environment` | `string` | `'production'`, `'staging'`, `'development'`. Maps to `deployment.environment.name`. |
| `schema.version` | `string` | Schema version, set on every root span as `app.schema.version`. |

**Optional options**:

| Field | Type | Default | Description |
|---|---|---|---|
| `service.team` | `string` | — | Owning team identifier. |
| `schema.required` | `(keyof T)[]` | `[]` | Attribute keys that must be present on every root span. Checked by `harness.assertRequired()`. |
| `schema.meta` | `Partial<Record<keyof T, AttributeMeta>>` | — | Per-attribute metadata: `sensitivity` and `description`. |
| `sampling.alwaysKeep.errors` | `boolean` | `true` | Keep all ERROR-status spans. |
| `sampling.alwaysKeep.slowerThanMs` | `number` | — | Keep spans exceeding this duration. |
| `sampling.alwaysKeep.routes` | `string[]` | — | Keep spans matching these `http.route` values. |
| `sampling.alwaysKeep.attributes` | `Partial<Record<keyof T, unknown[]>>` | — | Keep spans where the named attribute matches any value in the array. |
| `sampling.defaultRate` | `number` | `1.0` | Probability (0.0–1.0) for spans not matching always-keep rules. |
| `export.all` | `AllExporterConfig[]` | `[]` | Shared baseline destinations applied to traces, logs, and metrics. |
| `export.traces` | `TraceExporterConfig[]` | `[]` | Trace destinations appended after `export.all`. |
| `export.logs` | `LogExporterConfig[]` | `[]` | Log destinations appended after `export.all`. |
| `export.metrics` | `MetricExporterConfig[]` | `[]` | Metric destinations appended after `export.all`. |
| `instrumentation.http` | `boolean` | `true` | Enable HTTP auto-instrumentation. |
| `instrumentation.database` | `boolean` | `true` | Enable database auto-instrumentation. |
| `instrumentation.redis` | `boolean` | `true` | Enable Redis auto-instrumentation. |
| `instrumentation.grpc` | `boolean` | `false` | Enable gRPC auto-instrumentation. |
| `instrumentation.messaging` | `boolean` | `false` | Enable messaging auto-instrumentation. |
| `limits.maxAttributesPerSpan` | `number` | `200` | Max attributes per span. |
| `limits.maxAttributeValueLength` | `number` | `2048` | Max bytes per attribute value. |

**Throws**: If any attribute in `schema.meta` has `sensitivity: 'prohibited'`.

**Returns**: A `Signal<T>` instance.

**Supported destination types** for `export.all` and each per-signal list:

- `'otlp'`
- `'console'`
- `'pretty-console'`
- `'file'`

These names are intentionally shared across all three signals even though canon-signal resolves them through signal-specific implementations internally. Metrics, for example, are wired through `MetricReader`s rather than span/log exporters.

For OTLP destinations, `endpoint` is treated as a base collector URL by default and canon-signal appends `/v1/traces`, `/v1/logs`, or `/v1/metrics` automatically. Set `appendSignalPath: false` when you need to use the configured endpoint exactly as provided.

**Environment variable overrides applied at construction time**:

| Variable | Effect |
|---|---|
| `OTEL_SERVICE_NAME` | Overrides `service.name` |
| `OTEL_RESOURCE_ATTRIBUTES` | Parsed as `key=value,key2=value2` and merged into resource attributes |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Default base `endpoint` for OTLP exporters that didn't specify one |
| `OTEL_EXPORTER_OTLP_HEADERS` | Parsed and merged into OTLP exporter headers |
| `CANON_SIGNAL_SAMPLE_RATE` | Overrides `sampling.defaultRate` (parsed as float) |
| `CANON_SIGNAL_DEBUG` | Forces `defaultRate` to `1.0` (keep everything). Truthy values: `1`, `true`, `yes`. |

**Example**:

```typescript
import { createSignal, type SignalAttributes } from 'canon-signal'

interface AppAttributes extends SignalAttributes {
  'app.user.id'?: string
  'app.customer.tier'?: 'free' | 'pro' | 'enterprise'
}

export const signal = createSignal<AppAttributes>({
  service: {
    name: 'checkout-service',
    version: '1.0.0',
    environment: process.env.NODE_ENV ?? 'development',
    team: 'payments',
  },
  schema: {
    version: '1.0.0',
    required: ['app.request.id'],
    meta: {
      'app.user.id': { sensitivity: 'internal', description: 'Authenticated user ID' },
    },
  },
  sampling: {
    alwaysKeep: { errors: true, slowerThanMs: 2000 },
    defaultRate: 0.1,
  },
  export: {
    all: [{ type: 'otlp', endpoint: 'https://otlp-gateway.example.com' }],
    traces: [{ type: 'pretty-console' }],
    logs: [{ type: 'pretty-console' }],
  },
})
```

---

### `signal.shutdown(): Promise<void>`

Flushes pending spans, logs, and metrics, then shuts down all OTel providers in parallel. Idempotent — calling it multiple times is safe.

**Throws**: Never (errors during shutdown are caught internally by the OTel SDK).

**Example**:

```typescript
process.on('SIGTERM', async () => {
  await signal.shutdown()
  process.exit(0)
})
```

---

### `signal.middleware(options?): Middleware`

Returns framework-appropriate middleware that creates the request scope. Defaults to Hono.

**Signature**:

```typescript
middleware(options?: MiddlewareOptions<T>): Middleware
```

**Options**:

| Field | Type | Default | Description |
|---|---|---|---|
| `framework` | `'hono' \| 'express' \| 'fastify' \| 'next'` | `'hono'` | Which framework adapter to use. |
| `requestIdHeader` | `string` | `'x-request-id'` | Header to read request ID from. |
| `generateRequestId` | `() => string` | `crypto.randomUUID` | Generates request ID when header is absent. |
| `defaultAttributes` | `Partial<T>` | — | Static attributes set on every root span. Typed against your interface. |

**What the middleware does on every request**:

1. Detects existing auto-instrumented HTTP span via `trace.getActiveSpan()`. Uses it if present; creates a new one otherwise.
2. Creates a `SignalContext` and runs the handler chain inside `store.run(ctx, ...)`.
3. Sets automatic attributes: `http.request.method`, `http.route`, `app.request.id`, `app.schema.version`, plus any `defaultAttributes`.
4. In the finally block: sets `http.response.status_code` from the response.
5. On uncaught error: records the exception, sets ERROR status, sets the status code to 500 if no response.

**Returns**: A middleware function with the right signature for the chosen framework.

---

## Root span enrichment

These methods target the **root span** of the current request. They throw if called outside a request scope.

### `signal.attr<K>(key, value): void`

Sets a single attribute on the root span. Type-safe.

**Signature**:

```typescript
attr<K extends keyof T & string>(key: K, value: T[K]): void
```

**Throws**: `Error` if called outside a request scope.

**Example**:

```typescript
signal.attr('app.user.id', 'usr_123')
signal.attr('app.customer.tier', 'enterprise')
```

**Compile errors** (caught by TypeScript):

```typescript
signal.attr('app.bogus', 'value')          // Key not in schema
signal.attr('app.user.id', 123)            // Wrong type for key
signal.attr('app.customer.tier', 'platinum') // Not in union
```

---

### `signal.attrs(attributes): void`

Sets multiple attributes on the root span in one call. Same type safety as `attr`.

**Signature**:

```typescript
attrs(attributes: Partial<T>): void
```

**Throws**: `Error` if called outside a request scope.

**Example**:

```typescript
signal.attrs({
  'app.user.id': user.id,
  'app.customer.tier': user.tier,
  'app.auth.method': 'oauth',
})
```

---

### `signal.getAttr<K>(key): T[K] | undefined`

Reads an attribute back from the root span. Returns the typed value or `undefined` if not set.

**Signature**:

```typescript
getAttr<K extends keyof T & string>(key: K): T[K] | undefined
```

**Throws**: `Error` if called outside a request scope.

**Example**:

```typescript
const tier = signal.getAttr('app.customer.tier')
// tier: 'free' | 'pro' | 'enterprise' | undefined
```

---

### `signal.traceId(): string | undefined`

Returns the current trace ID, or `undefined` if outside a request scope. **Does not throw.**

**Signature**:

```typescript
traceId(): string | undefined
```

**Example**:

```typescript
const tid = signal.traceId()
if (tid) {
  errorResponse.traceId = tid  // Surface to support
}
```

---

## Spans and traces

### `signal.span<R>(name, fn): Promise<R>`

Creates a child span of the current active span. The callback runs inside a context where the child is the active span.

**Signature**:

```typescript
span<R>(name: string, fn: (span: Span) => R | Promise<R>): Promise<R>
```

**Behavior**:
- Inside the callback, `signal.attr()` still targets the **root** span.
- Inside the callback, `signal.error()` and `signal.event()` target the **child** span (the new active span).
- If the callback throws: child span status set to ERROR, exception recorded, span ended, error re-thrown.
- The callback receives the OTel `Span` object directly so you can call `span.setAttribute()` for child-specific attributes that don't belong on the canonical schema.

**Span name must be low-cardinality.**

**Throws**: `Error` if called outside a request scope.

**Returns**: Whatever the callback returns.

**Example**:

```typescript
const charge = await signal.span('payment.process', async (span) => {
  span.setAttribute('payment.provider', 'stripe')
  span.setAttribute('payment.amount_cents', 4999)

  const result = await stripe.charges.create({ amount: 4999 })

  span.setAttribute('payment.charge_id', result.id)
  return result
})
```

---

### `signal.trace<R>(name, fn, options?): Promise<R>`

Creates a brand new trace with a new root span. For non-HTTP units of work — background jobs, queue consumers, scheduled tasks, CLI commands.

**Signature**:

```typescript
trace<R>(
  name: string,
  fn: () => R | Promise<R>,
  options?: TraceOptions,
): Promise<R>
```

**Options**:

| Field | Type | Default | Description |
|---|---|---|---|
| `links` | `SpanLink[]` | — | Links to causally related traces. |
| `kind` | `'internal' \| 'consumer' \| 'producer'` | `'internal'` | OTel span kind. |

**Behavior**:
- Creates a new root span with no parent (`root: true`).
- Establishes a full request scope inside the callback. All `signal.*` methods work as if you're inside HTTP middleware.
- Automatically sets `app.schema.version` on the root span.
- Error handling: same as `signal.span()` — records, sets ERROR, ends, re-throws.

**Returns**: Whatever the callback returns.

**Example**:

```typescript
async function processJob(job: Job) {
  await signal.trace('job.process', async () => {
    signal.attr('app.job.id', job.id)
    signal.attr('app.job.type', job.type)
    await doWork(job)
  }, { kind: 'consumer' })
}
```

---

### `signal.link(traceparent): SpanLink`

Creates a `SpanLink` for connecting causally related but separate traces. Used with `signal.trace()` options.

**Signature**:

```typescript
link(traceparent: string | { traceId: string; spanId: string }): SpanLink
```

**Accepts**:
- A W3C `traceparent` header string: `'00-<traceId>-<spanId>-<flags>'`
- An object with explicit IDs: `{ traceId, spanId }`

**Throws**: `Error` if the traceparent string has fewer than 4 dash-separated parts.

**Example**:

```typescript
await signal.trace('message.consume', async () => {
  await processMessage(message)
}, {
  links: [signal.link(message.headers.traceparent)],
  kind: 'consumer',
})
```

---

## Events and errors

### `signal.event(name, data?): void`

Records a timestamped event on the **active** span. Use for cache misses, retries, state transitions, feature flag evaluations.

**Signature**:

```typescript
event(name: string, data?: Record<string, AttributeValue>): void
```

**Throws**: `Error` if called outside a request scope.

**Example**:

```typescript
signal.event('cache_miss', { key: 'user:123', fallback: 'database' })
signal.event('retry', { attempt: 2, backoff_ms: 200 })
```

---

### `signal.error(err): void`

Records an exception on the **active** span and sets its status to ERROR.

**Signature**:

```typescript
error(err: Error | unknown): void
```

**What it does**:
1. Calls `span.recordException(err)` — creates an `exception` event on the span with `exception.type`, `exception.message`, `exception.stacktrace`.
2. Calls `span.setStatus({ code: SpanStatusCode.ERROR })`.

**Throws**: `Error` if called outside a request scope.

**Example**:

```typescript
try {
  await riskyOperation()
} catch (err) {
  signal.error(err)
  signal.attr('app.error.code', 'OPERATION_FAILED')
  throw err
}
```

---

## Sampling

### `signal.keep(): void`

Marks the current trace for guaranteed export, overriding all sampling rules. Sets `app.debug = true` on the root span.

**Signature**:

```typescript
keep(): void
```

**Throws**: `Error` if called outside a request scope.

**Example**:

```typescript
if (userId === 'usr_problematic') {
  signal.keep()
}
```

The trace is exported regardless of `defaultRate` or `alwaysKeep` rules. The `app.debug` attribute is also visible in the exported trace, so you can later filter on it to find your debug sessions.

---

## Logging

### `signal.log`

Context-aware structured logger. Auto-attaches `trace_id` and `span_id` when called inside a request scope. Outside a scope, emits a plain log record without trace context.

**Methods**:

| Method | Severity |
|---|---|
| `signal.log.trace(msg, data?)` | TRACE |
| `signal.log.debug(msg, data?)` | DEBUG |
| `signal.log.info(msg, data?)` | INFO |
| `signal.log.warn(msg, data?)` | WARN |
| `signal.log.error(msg, data?)` | ERROR |
| `signal.log.fatal(msg, data?)` | FATAL |

**Signature** (all methods):

```typescript
(message: string, data?: Record<string, AttributeValue>): void
```

**Auto-attached fields when inside a request scope**:
- `trace_id`
- `span_id`

**Auto-attached fields always**:
- `service.name`, `service.version`, `deployment.environment.name` (from resource attributes)
- `timestamp`
- `severity` (from method name)

**Example**:

```typescript
signal.log.info('audit event', { resource: 'patients', count: 47 })
```

---

### `signal.systemLog`

Process-scoped structured logger. **Never** attaches trace context, even when called inside a request scope. Use for events about the system rather than the request.

Same methods and signatures as `signal.log`.

**Example**:

```typescript
signal.systemLog.info('Service started', { port: 3000 })
signal.systemLog.warn('Connection pool degraded', { active: 18, max: 20 })
```

---

## Metrics

### `signal.meter(instruments): InstrumentMap<D>`

Defines metric instruments. Returns a typed instrument map.

**Signature**:

```typescript
meter<D extends Record<string, MeterInstrumentDef>>(instruments: D): InstrumentMap<D>
```

**Instrument types**:

| Type | Methods | Description |
|---|---|---|
| `'counter'` | `.add(value, labels?)` | Monotonically increasing values. |
| `'gauge'` | `.set(value, labels?)` | Bidirectional values. (Note: implemented as deltas via UpDownCounter for now.) |
| `'histogram'` | `.record(value, labels?)` | Distributions. Supports `buckets` for explicit boundaries. |

**Definition shape**:

```typescript
{
  type: 'counter' | 'gauge' | 'histogram'
  unit: string
  description: string
  buckets?: number[]   // histogram only
}
```

**Example**:

```typescript
const meters = signal.meter({
  'app.orders.completed': {
    type: 'counter',
    unit: 'orders',
    description: 'Total completed orders',
  },
  'app.payment.duration': {
    type: 'histogram',
    unit: 'ms',
    description: 'Payment processing duration',
    buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
  },
})

meters['app.orders.completed'].add(1, { region: 'us-east' })
meters['app.payment.duration'].record(347)
```

**Cardinality warning**: metric labels create separate time series per unique value. Keep label cardinality below ~20 unique values per dimension. Don't put user IDs or other high-cardinality data in metric labels.

---

## Introspection

### `signal.schema(): { version, meta? }`

Returns the active schema as a runtime object.

**Returns**:

```typescript
{
  version: string
  meta?: Partial<Record<keyof T & string, AttributeMeta>>
}
```

**Example**:

```typescript
const schema = signal.schema()
console.log(schema.version)
console.log(schema.meta?.['app.user.id']?.sensitivity)
```

---

### `signal.loggerProvider`

The OTel `LoggerProvider` this signal owns. Pass to logger bridges (Pino, Winston) when binding them to a specific signal instance.

**Type**: `LoggerProvider` (from `@opentelemetry/api-logs`)

**Example**:

```typescript
import { createPinoTransport } from 'canon-signal/bridges/pino'

const logger = pino({}, createPinoTransport({
  loggerProvider: signal.loggerProvider,
}))
```

---

## Testing

### `signal.test.harness(): TestHarness<T>`

Returns a typed test harness for the in-memory exporters automatically wired into every signal instance.

**Lazy-loaded**: accessing `signal.test` for the first time imports the testing module. Production code that never touches `signal.test` never loads the harness.

**Methods**:

| Method | Description |
|---|---|
| `harness.rootSpan()` | Returns the most recent root span (no parent). |
| `harness.allSpans()` | Returns all captured spans. |
| `harness.findSpan(name)` | Finds the first span matching a name. |
| `harness.findSpans(name)` | Finds all spans matching a name. |
| `harness.assertAttr(span, key, expected)` | Asserts an attribute value. Key typed against `T`. |
| `harness.assertName(span, expected)` | Asserts span name. |
| `harness.assertStatus(span, expected)` | Asserts status: `'OK' \| 'ERROR' \| 'UNSET'`. |
| `harness.assertException(span, type?)` | Asserts an exception event exists, optionally with a specific type. |
| `harness.assertEvent(span, name)` | Asserts a named event exists. |
| `harness.assertRequired(span)` | Asserts every key in `schema.required` is present. |
| `harness.assertNoErrors()` | Asserts no captured span has ERROR status. |
| `harness.logRecords()` | Returns captured log records. |
| `harness.reset()` | Clears all captured spans and log records. Call between tests. |

**Example**:

```typescript
const harness = signal.test.harness()

await app.request('/checkout')

const root = harness.rootSpan()
harness.assertAttr(root!, 'app.user.id', 'usr_123')
harness.assertStatus(root!, 'OK')
harness.assertNoErrors()
harness.reset()
```

---

## Bridges (subpath imports)

### `createPinoTransport(options?): Writable`

Pino transport that converts Pino log records into OTel LogRecords. Auto-injects `trace_id`/`span_id` from the active span when called inside a request scope.

**Import**: `canon-signal/bridges/pino`

**Options**:

| Field | Type | Default | Description |
|---|---|---|---|
| `loggerProvider` | `LoggerProvider` | global | Bind to a specific signal instance's provider. |
| `name` | `string` | `'pino'` | Logger name passed to `getLogger(name)`. |

**Example**:

```typescript
import pino from 'pino'
import { signal } from './signal'
import { createPinoTransport } from 'canon-signal/bridges/pino'

const logger = pino({}, createPinoTransport({
  loggerProvider: signal.loggerProvider,
}))
```

---

### `createWinstonTransport(options?): Transport`

Winston transport that converts Winston log records into OTel LogRecords. Same auto-injection behavior as the Pino bridge.

**Import**: `canon-signal/bridges/winston`

**Options**:

| Field | Type | Default | Description |
|---|---|---|---|
| `loggerProvider` | `LoggerProvider` | global | Bind to a specific signal instance's provider. |
| `name` | `string` | `'winston'` | Logger name passed to `getLogger(name)`. |
| `level` | `string` | `'silly'` | Winston level for the transport. |

**Example**:

```typescript
import winston from 'winston'
import { signal } from './signal'
import { createWinstonTransport } from 'canon-signal/bridges/winston'

const logger = winston.createLogger({
  transports: [createWinstonTransport({
    loggerProvider: signal.loggerProvider,
  })],
})
```

---

## CLI

After installing canon-signal, the `canon-signal` command is available via `npx`.

### `npx canon-signal create`

Scaffolds a starter `src/signal.ts` setup file in your project. Reads `package.json` for service name and version, detects framework from dependencies.

### `npx canon-signal install-docs`

Copies the agent documentation suite into `.canon-signal/` at the root of your repo. AI agents working in your codebase can read these references locally.

### `npx canon-signal inspect --file traces.jsonl`

Reads a JSONL trace file (produced by the trace `file` exporter) and renders trace waterfalls. Supports `--last N`, `--errors`, `--trace <id>`, `--format json`.
