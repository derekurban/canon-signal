# canon-signal

> An opinionated OpenTelemetry toolkit for Node.js/TypeScript that implements the trace-first observability model.

`canon-signal` is a single-package, type-safe layer on top of `@opentelemetry/*` that makes the right instrumentation patterns easy and the wrong patterns awkward. It treats traces as the backbone of observability — your root span is the canonical event, your interface is the schema, and your AsyncLocalStorage context flows everywhere automatically.

```bash
npm install canon-signal
```

One install. No OTel dependency puzzle. Dual ESM/CJS. Node.js 18+.

---

## Why canon-signal

Traditional OpenTelemetry setup looks like this:

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/sdk-trace-base \
  @opentelemetry/sdk-trace-node @opentelemetry/exporter-trace-otlp-proto \
  @opentelemetry/resources @opentelemetry/semantic-conventions \
  @opentelemetry/auto-instrumentations-node @opentelemetry/sdk-metrics \
  @opentelemetry/exporter-metrics-otlp-proto @opentelemetry/sdk-logs \
  @opentelemetry/api-logs @opentelemetry/exporter-logs-otlp-proto
```

Then 100+ lines of provider wiring, processor configuration, and resource setup before you can call `tracer.startActiveSpan()`. And nothing in that setup tells you *how* to instrument — what attributes to use, where to put context, or how to keep your telemetry queryable.

`canon-signal` ships **all of that** behind one factory call:

```typescript
import { createSignal, type SignalAttributes } from 'canon-signal'

interface AppAttributes extends SignalAttributes {
  'app.user.id'?: string
  'app.customer.tier'?: 'free' | 'pro' | 'enterprise'
  'app.transaction.type'?: 'checkout' | 'refund' | 'subscription_renewal'
}

export const signal = createSignal<AppAttributes>({
  service: { name: 'checkout', version: '1.0.0', environment: 'production' },
  schema: { version: '1.0.0' },
})
```

That's the entire setup. You now have:

- A typed `signal.attr()` that won't compile if you misspell an attribute name
- AsyncLocalStorage-based request scoping with **zero ceremony** (no logger threading, no context arguments)
- Auto-instrumentation for HTTP, databases, Redis, gRPC, and messaging (37 instrumentations)
- A custom tail-sampling processor that always keeps errors and slow requests
- A test harness with typed assertions
- Pretty waterfall rendering in dev, OTLP export in production
- A custom `SpanProcessor` that automatically computes `app.db.total_duration_ms` and `app.db.query_count` on every root span

---

## Core principles

1. **The interface is the source of truth.** Your TypeScript interface defines every canonical attribute. The compiler enforces the contract — if it's not in the interface, it doesn't exist.

2. **Traces are the backbone.** The root span is your canonical event. `signal.attr()` enriches it. Logs and metrics are explicitly secondary signals with narrow use cases.

3. **Context is ambient.** AsyncLocalStorage propagates the request scope through every async call. You never pass loggers, never thread span objects, never deal with context arguments.

4. **Make the right thing easy, make the wrong thing awkward.** `signal.log` auto-attaches trace context. `signal.systemLog` exists as a separate API to make you think about whether you really need a non-correlated log.

5. **One factory, one instance.** No global state, no module-level singletons. Each `createSignal()` call returns a fully encapsulated signal object you import everywhere.

The full philosophy lives in [`resources/CONSTITUTION.md`](./resources/CONSTITUTION.md).

---

## Quick start

### 1. Install

```bash
npm install canon-signal
```

### 2. Define your schema

Create a setup file with your typed attribute interface:

```typescript
// src/signal.ts
import { createSignal, type SignalAttributes } from 'canon-signal'

interface AppAttributes extends SignalAttributes {
  // --- Request identity (set automatically by middleware) ---
  'app.request.id': string

  // --- User & auth context ---
  'app.user.id'?: string
  'app.auth.method'?: 'api_key' | 'oauth' | 'session' | 'anonymous'
  'app.customer.tier'?: 'free' | 'pro' | 'enterprise'

  // --- Business context ---
  'app.transaction.type'?: 'checkout' | 'refund' | 'subscription_renewal'
  'app.feature_flags'?: string

  // --- Outcome ---
  'app.error.code'?: string
  'app.error.retriable'?: boolean
}

export const signal = createSignal<AppAttributes>({
  service: {
    name: 'checkout-service',
    version: '1.0.0',
    environment: process.env.NODE_ENV ?? 'development',
  },
  schema: {
    version: '1.0.0',
    required: ['app.request.id'],
    meta: {
      'app.user.id': { sensitivity: 'internal', description: 'Authenticated user ID' },
    },
  },
  sampling: {
    alwaysKeep: {
      errors: true,
      slowerThanMs: 2000,
      routes: ['/checkout', '/auth/login'],
    },
    defaultRate: 0.1,
  },
  export: {
    traces: [{ type: 'otlp', endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }],
  },
})
```

> Don't want to write this by hand? Run `npx canon-signal create` and it will generate the file for you, detecting your framework and pulling the service name/version from `package.json`.

### 3. Register middleware

```typescript
// src/server.ts
import { Hono } from 'hono'
import { signal } from './signal'

const app = new Hono()
app.use('*', signal.middleware())

app.post('/checkout', async (c) => {
  signal.attr('app.user.id', 'usr_123')
  signal.attr('app.customer.tier', 'enterprise')
  signal.attr('app.transaction.type', 'checkout')

  const order = await signal.span('order.create', async () => {
    return await db.orders.insert({ /* ... */ })
  })

  return c.json({ orderId: order.id })
})
```

### 4. Test it

```typescript
import { describe, it, expect } from 'vitest'
import { signal } from './signal'
import { app } from './server'

describe('POST /checkout', () => {
  const harness = signal.test.harness()

  it('emits a canonical root span', async () => {
    await app.request('/checkout', { method: 'POST' })

    const root = harness.rootSpan()
    harness.assertAttr(root!, 'app.user.id', 'usr_123')
    harness.assertAttr(root!, 'app.customer.tier', 'enterprise')
    harness.assertStatus(root!, 'OK')
    harness.assertRequired(root!)

    harness.reset()
  })
})
```

---

## The `signal.*` API

Every canon-signal feature lives on the typed `Signal<T>` instance returned by `createSignal<T>()`.

### Lifecycle

| Method | Description |
|---|---|
| `signal.shutdown()` | Flushes pending spans, logs, and metrics, then shuts down providers. Call on `SIGTERM`. |

### Middleware

| Method | Description |
|---|---|
| `signal.middleware(options?)` | Returns framework middleware. Auto-detects Hono by default; pass `{ framework: 'express' \| 'fastify' \| 'next' }` to override. |

### Root span enrichment

These functions target the **root span** and only work inside a request scope (created by middleware or `signal.trace()`).

| Method | Description |
|---|---|
| `signal.attr(key, value)` | Set a single attribute. `key` is constrained to your interface; `value` is narrowed to the declared type. **Compile error** if either is wrong. |
| `signal.attrs({ ... })` | Set multiple attributes in one call. Same type safety. |
| `signal.getAttr(key)` | Read an attribute back. Returns `T[key] \| undefined`. |
| `signal.traceId()` | Returns the current trace ID, or `undefined` outside a request scope. **Does not throw**. |

### Spans and traces

| Method | Description |
|---|---|
| `signal.span(name, fn)` | Create a child span of the current active span. Inside the callback, `signal.attr()` still targets the root, but the child becomes the active span for nesting. Auto handles error → status mapping. |
| `signal.trace(name, fn, options?)` | Create a brand new trace with its own root span — for background jobs, queue consumers, cron tasks. Inside the callback, the full request scope works as if it were an HTTP request. |
| `signal.link(traceparent)` | Create a `SpanLink` from a W3C `traceparent` string or `{traceId, spanId}` object. Pass to `signal.trace()` options to connect causally related but separate traces. |

### Events and errors

| Method | Description |
|---|---|
| `signal.event(name, data?)` | Record a timestamped event on the **active** span (cache misses, retries, state transitions). |
| `signal.error(err)` | Record an exception on the **active** span and set its status to ERROR. Pairs naturally with `signal.attr('app.error.code', ...)` which targets the **root**. |

### Sampling

| Method | Description |
|---|---|
| `signal.keep()` | Mark the current trace for guaranteed export, overriding all sampling rules. Sets `app.debug = true` on the root span. |

### Logging

| Method | Description |
|---|---|
| `signal.log.{trace,debug,info,warn,error,fatal}(msg, data?)` | **Context-aware** structured logger. Auto-attaches `trace_id` and `span_id` when called inside a request scope. Outside scope, emits a plain log record. |
| `signal.systemLog.{trace,debug,info,warn,error,fatal}(msg, data?)` | **Process-scoped** logger. **Never** attaches trace context, even inside a request scope. For startup, shutdown, config events. |

### Metrics

| Method | Description |
|---|---|
| `signal.meter(instruments)` | Define `counter`, `gauge`, and `histogram` instruments. Returns a typed instrument map with `.add()`, `.set()`, and `.record()` methods. |

### Introspection & testing

| Method | Description |
|---|---|
| `signal.schema()` | Returns the active schema as a runtime object — `{ version, meta }`. Used by agent tooling. |
| `signal.loggerProvider` | The OTel `LoggerProvider` this signal owns. Pass to bridges (Pino, Winston) when binding to a specific signal instance. |
| `signal.test.harness()` | Returns a `TestHarness<T>` with typed assertions. Reads from in-memory exporters automatically wired into every signal instance. |

---

## End-to-end example

```typescript
import { Hono } from 'hono'
import { signal } from './signal'

const app = new Hono()
app.use('*', signal.middleware())

app.post('/checkout', async (c) => {
  // 1. Set request-level context on the root span (typed against AppAttributes)
  signal.attr('app.user.id', 'usr_123')
  signal.attr('app.customer.tier', 'enterprise')
  signal.attr('app.transaction.type', 'checkout')

  // 2. Conditionally guarantee this trace is exported
  if (c.req.query('debug') === 'true') {
    signal.keep()
  }

  // 3. Create a child span for a meaningful operation
  const charge = await signal.span('payment.process', async (span) => {
    span.setAttribute('payment.provider', 'stripe')
    span.setAttribute('payment.amount_cents', 4999)

    try {
      // Auto-instrumented HTTP call to Stripe — appears as a nested span automatically
      const result = await fetch('https://api.stripe.com/v1/charges', { /* ... */ })
      const charge = await result.json()

      // Annotate the child span with the result
      span.setAttribute('payment.charge_id', charge.id)

      // Note significant point-in-time events
      signal.event('payment_authorized', { amount: 4999 })

      return charge
    } catch (err) {
      // signal.error annotates the active span (the child)
      signal.error(err)
      // signal.attr always targets the root — both annotations are preserved
      signal.attr('app.error.code', 'PAYMENT_DECLINED')
      signal.attr('app.error.retriable', false)
      throw err
    }
  })

  // 4. Audit log — auto-correlated with the trace
  signal.log.info('Order placed', { chargeId: charge.id })

  return c.json({ orderId: 'ord_456', chargeId: charge.id })
})

// Background job — same APIs work via signal.trace()
async function processRefundJob(refundId: string) {
  await signal.trace('job.refund', async () => {
    signal.attr('app.transaction.type', 'refund')
    await processRefund(refundId)
  }, { kind: 'consumer' })
}

// System-level events — never get trace context
signal.systemLog.info('Service started', { port: 3000 })

// Graceful shutdown
process.on('SIGTERM', async () => {
  await signal.shutdown()
  process.exit(0)
})
```

---

## Type safety

The whole value proposition depends on this. Your interface flows through every API:

```typescript
interface AppAttributes extends SignalAttributes {
  'app.user.id'?: string
  'app.customer.tier'?: 'free' | 'pro' | 'enterprise'
  'app.cache.hit'?: boolean
}

const signal = createSignal<AppAttributes>({ /* ... */ })

signal.attr('app.user.id', 'usr_123')           // OK
signal.attr('app.customer.tier', 'enterprise')   // OK
signal.attr('app.cache.hit', true)               // OK

signal.attr('app.user.id', 123)                  // COMPILE ERROR: number not assignable to string
signal.attr('app.bogus', 'whatever')             // COMPILE ERROR: key not in AppAttributes
signal.attr('app.customer.tier', 'platinum')     // COMPILE ERROR: not in union
```

The same constraint applies to `signal.attrs({...})`, `signal.getAttr()`, `signal.middleware({ defaultAttributes: {...} })`, and the test harness's `assertAttr()`.

### Optional vs required

TypeScript's `?` modifier does double duty:

- **At compile time:** optional properties don't have to be set
- **At test time:** the harness's `assertRequired()` checks that every key listed in `schema.required` is present on the root span

```typescript
interface AppAttributes extends SignalAttributes {
  'app.request.id': string         // required
  'app.user.id'?: string           // optional
}

const signal = createSignal<AppAttributes>({
  service: { /* ... */ },
  schema: {
    version: '1.0.0',
    required: ['app.request.id'],  // explicit runtime list
  },
})
```

### Sensitivity classification

Optional metadata you can attach to any attribute:

```typescript
schema: {
  version: '1.0.0',
  meta: {
    'app.user.id': { sensitivity: 'internal', description: 'Authenticated user ID' },
    'app.email': { sensitivity: 'sensitive', description: 'Hashed only' },
  },
}
```

| Classification | Meaning |
|---|---|
| `'public'` | No restrictions. Default for attributes without explicit metadata. |
| `'internal'` | Safe for telemetry storage; do not propagate via baggage to external services. |
| `'sensitive'` | PII — consider hashing. Document the privacy implications. |
| `'prohibited'` | **`createSignal()` throws at startup.** Never appears in telemetry. |

---

## Sampling

Sampling is **tail-based** — every span runs to completion, then the processor decides whether to export based on outcome.

```typescript
sampling: {
  alwaysKeep: {
    errors: true,                // keep every ERROR span
    slowerThanMs: 2000,          // keep spans exceeding this duration
    routes: ['/checkout', '/auth/login'],
    attributes: {
      'app.customer.tier': ['enterprise'],   // typed to your interface
    },
  },
  defaultRate: 0.1,              // 10% of everything else
}
```

**Evaluation order** (first match wins):

1. `app.debug === true` (set by `signal.keep()`) → **export**
2. Span status is ERROR (when `alwaysKeep.errors` is true) → **export**
3. Duration exceeds `alwaysKeep.slowerThanMs` → **export**
4. `http.route` matches `alwaysKeep.routes` → **export**
5. Any attribute matches `alwaysKeep.attributes` → **export**
6. `hash(traceId) % 10000 < (defaultRate * 10000)` → **export** or **drop**

The hash is **deterministic** on the trace ID — the same trace always produces the same decision across services and restarts. No partial traces from rate disagreement.

---

## Auto-instrumentation

When you call `createSignal()`, canon-signal registers `@opentelemetry/auto-instrumentations-node` against the tracer/logger/meter providers it just created. By default:

- **HTTP** (server + client) — `@opentelemetry/instrumentation-http`, `instrumentation-undici`
- **Database** — pg, mysql, mysql2, mongodb, mongoose, cassandra-driver, tedious
- **Redis** — redis, redis-4, ioredis
- **gRPC** — disabled by default
- **Messaging** (amqplib, kafkajs, aws-sdk) — disabled by default

Override per-category:

```typescript
instrumentation: {
  http: true,      // default
  database: true,  // default
  redis: true,     // default
  grpc: false,     // default
  messaging: false, // default
}
```

When auto-instrumentation creates an HTTP server span, canon-signal's middleware **detects** it (via `trace.getActiveSpan()`) and uses it as the root span instead of creating a new one. This means you get a single, unified trace per request without double-spanning.

---

## Performance summary attributes

Two attributes are computed automatically by a custom `SpanProcessor` (`src/sampling/db-summary.ts`):

| Attribute | Computed how |
|---|---|
| `app.db.total_duration_ms` | Sum of `db.system`-tagged child span durations per trace |
| `app.db.query_count` | Count of `db.system`-tagged child spans per trace |

The processor accumulates per-trace stats as DB child spans complete, then writes the totals onto the root span when it ends. No instrumentation needed in user code — these attributes appear automatically on every root span whose request touched a database.

---

## Export configuration

Each signal type accepts an array of export destinations. Multiple destinations run in parallel.

`export.all` is a shared baseline applied to traces, logs, and metrics. Signal-specific lists are appended after it with order preserved and no deduplication.

```typescript
export: {
  all: [
    { type: 'otlp', endpoint: 'https://otlp-gateway.example.com' },
  ],
  traces: [
    { type: 'pretty-console' },                         // rich dev waterfall
    { type: 'file', path: './telemetry.jsonl' },        // JSONL output (signal-tagged)
  ],
  logs: [
    { type: 'pretty-console' },                         // colored log lines
  ],
  metrics: [
    { type: 'console' },                                // raw metric batch dump
  ],
}
```

| Destination type | Traces | Logs | Metrics | Use case |
|---|---|---|---|---|
| `'otlp'` | yes | yes | yes | Production export to any OTLP-compatible backend |
| `'pretty-console'` | yes | yes | yes | Human-friendly local stdout; traces get the richest formatting |
| `'console'` | yes | yes | yes | Raw SDK-style console output for diagnostics |
| `'file'` | yes | yes | yes | JSONL output to disk; trace files remain readable by `npx canon-signal inspect` |

Notes:

- `pretty-console` is signal-specific under the hood: traces render as a waterfall, logs as colored lines, and metrics as compact per-batch summaries.
- `file` output includes a `signal` field on every JSONL line (`'trace'`, `'log'`, `'metric'`) so a shared `export.all` file path remains intelligible.
- Metrics are wired through `MetricReader`s internally, but they intentionally share the same destination names as traces/logs in the public config.
- OTLP `endpoint` is treated as a base collector URL by default. canon-signal appends `/v1/traces`, `/v1/logs`, or `/v1/metrics` automatically so one OTLP config can be shared across all signals.
- If you need an exact custom OTLP request URL for a proxy or nonstandard collector route, set `appendSignalPath: false`.

```typescript
export: {
  all: [
    { type: 'otlp', endpoint: 'https://otlp-gateway.example.com/otlp' },
  ],
  traces: [
    {
      type: 'otlp',
      endpoint: 'https://proxy.example.com/custom-trace-intake',
      appendSignalPath: false,
    },
  ],
}
```

An in-memory exporter is **always** present so the test harness has something to read from.

---

## Testing

Every signal instance carries a lazy-loaded test harness that reads from in-memory exporters baked into the factory.

```typescript
import { signal } from './signal'

const harness = signal.test.harness()

afterEach(() => harness.reset())

test('checkout sets canonical attributes', async () => {
  await app.request('/checkout', { method: 'POST' })

  const root = harness.rootSpan()
  expect(root).toBeDefined()

  harness.assertAttr(root!, 'app.user.id', 'usr_123')
  harness.assertAttr(root!, 'app.transaction.type', 'checkout')
  harness.assertName(root!, 'POST /checkout')
  harness.assertStatus(root!, 'OK')
  harness.assertRequired(root!)
  harness.assertNoErrors()

  // Child span assertions
  const payment = harness.findSpan('payment.process')
  expect(payment).toBeDefined()
  harness.assertException(payment!, 'PaymentDeclinedError')

  // Log records
  const logs = harness.logRecords()
  expect(logs).toHaveLength(1)
})
```

| Method | Description |
|---|---|
| `harness.rootSpan()` | Returns the most recent root span (no parent) |
| `harness.allSpans()` | Returns all captured spans |
| `harness.findSpan(name)` | Finds a span by name |
| `harness.findSpans(name)` | Finds all spans matching a name |
| `harness.assertAttr(span, key, expected)` | Asserts an attribute value (key typed to schema for root spans) |
| `harness.assertName(span, expected)` | Asserts span name |
| `harness.assertStatus(span, expected)` | `'OK' \| 'ERROR' \| 'UNSET'` |
| `harness.assertException(span, type?)` | Asserts an exception event exists, optionally with a specific type |
| `harness.assertEvent(span, name)` | Asserts a named event exists |
| `harness.assertRequired(span)` | Asserts every key in `schema.required` is present |
| `harness.assertNoErrors()` | Asserts no captured span has ERROR status |
| `harness.logRecords()` | Returns captured log records |
| `harness.reset()` | Clears all captured spans and log records |

---

## Logger bridges (migration path)

Already using Pino or Winston? Bridges convert their output into OTel `LogRecord`s and route them through canon-signal's `LoggerProvider` — including auto-injecting `trace_id` and `span_id` when called inside a request scope.

### Pino

```typescript
import pino from 'pino'
import { signal } from './signal'
import { createPinoTransport } from 'canon-signal/bridges/pino'

const logger = pino({}, createPinoTransport({ loggerProvider: signal.loggerProvider }))

logger.info({ userId: 'usr_1' }, 'user logged in')
// → emits an OTel LogRecord with severity=INFO, trace_id, span_id, userId
```

### Winston

```typescript
import winston from 'winston'
import { signal } from './signal'
import { createWinstonTransport } from 'canon-signal/bridges/winston'

const logger = winston.createLogger({
  transports: [createWinstonTransport({ loggerProvider: signal.loggerProvider })],
})
```

The `loggerProvider` option binds the bridge to a specific signal instance. If omitted, the bridge uses the **global** OTel `LoggerProvider` (which `createSignal()` registers automatically).

Bridges are a migration tool — the recommended steady-state is `signal.log` and `signal.systemLog` directly.

---

## Zero-config quick start

For evaluation, demos, or trying canon-signal in 10 seconds:

```typescript
import { signal } from 'canon-signal/auto'

// signal is pre-configured with:
// - service.name from OTEL_SERVICE_NAME or package.json
// - service.version from package.json
// - environment from NODE_ENV
// - all auto-instrumentation enabled
// - schema version '0.0.0' (no custom attributes)

app.use('*', signal.middleware())
```

Use this to confirm the package works, then graduate to a typed schema by running `npx canon-signal create`.

---

## CLI

After installing canon-signal, the `canon-signal` CLI is available via `npx`. Run `npx canon-signal` with no arguments to see the full command list.

### `npx canon-signal create`

Generates `src/signal.ts` in your project. Detects:

- Service name and version from `package.json`
- Framework from your dependencies (`hono`, `express`, `fastify`, `next`)

Outputs a starter file with the typed `AppAttributes` interface and `createSignal()` call ready to extend.

### `npx canon-signal install-docs`

Copies the agent documentation suite (constitution, playbook, API reference, patterns, anti-patterns, troubleshooting) into a `.canon-signal/` directory at the root of your repo. Also writes a top-level `AGENTS.md` that points agents into the installed docs.

```bash
# Standard install
npx canon-signal install-docs

# Overwrite an existing .canon-signal/ directory
npx canon-signal install-docs --force

# Skip writing the root-level AGENTS.md
npx canon-signal install-docs --no-agents-md
```

The intent: AI agents working in your codebase can read documentation from `.canon-signal/` without having to dig into `node_modules`. Each installed file has a version header so you know which canon-signal version it corresponds to. Re-run with `--force` after upgrading canon-signal to refresh the docs.

### `npx canon-signal tutorial`

Prints the path to the bundled HTML tutorial, or copies it to your project for offline access.

```bash
# Print the path so you can open it in your browser
npx canon-signal tutorial

# Copy the HTML file to ./canon-signal-tutorial.html
npx canon-signal tutorial --copy

# Copy to a specific location
npx canon-signal tutorial --copy --out docs/canon-signal-tutorial.html
```

The tutorial is a self-contained HTML file (no build, no dependencies) covering the philosophy, the practitioners whose ideas shaped canon-signal, and an end-to-end walkthrough.

### `npx canon-signal inspect --file traces.jsonl`

Reads spans from a JSONL trace file (produced by the trace `file` exporter) and renders them as a tree with attributes.

```bash
# Last 5 traces
npx canon-signal inspect --file traces.jsonl --last 5

# Only error traces
npx canon-signal inspect --file traces.jsonl --errors

# A specific trace by ID
npx canon-signal inspect --file traces.jsonl --trace 4bf92f3577b34da6a3ce929d0e0e4736

# Machine-readable JSON output
npx canon-signal inspect --file traces.jsonl --last 20 --format json > recent.json
```

### `npx canon-signal report-issue`

Opens a pre-filled GitHub issue in your browser with diagnostic information automatically gathered (canon-signal version, Node version, OS, module format). No GitHub authentication required — your browser handles it via your existing session.

```bash
# Generic bug report (default)
npx canon-signal report-issue

# With a title
npx canon-signal report-issue "Pretty-console renders weird in CI"

# Feature request (uses 'enhancement' label)
npx canon-signal report-issue "Add Koa middleware" --type feature

# Question (uses 'question' label)
npx canon-signal report-issue "How do I sample by user?" --type question

# Print the URL without trying to open the browser
npx canon-signal report-issue "Bug" --print-only
```

The command builds a GitHub "new issue" URL with title, labels, and a pre-filled body containing diagnostic info. Your browser opens it; you fill in the description on GitHub. Cross-platform: macOS uses `open`, Windows uses `start`, Linux uses `xdg-open`. Falls back to printing the URL if the browser can't be auto-opened.

---

## Trace narratives (agent debugging)

`canon-signal` ships a `narrateTrace()` utility that turns raw spans into a structured summary — designed for AI agents that need to debug telemetry programmatically.

```typescript
import { narrateTrace } from 'canon-signal/inspect/narrate'

const narrative = narrateTrace(harness.allSpans())
// {
//   summary: "POST /checkout for user usr_123 (enterprise) returned 500 in 847ms",
//   timeline: [
//     { span: "auth.verify", duration: 12, status: "OK" },
//     { span: "payment.process", duration: 780, status: "ERROR",
//       error: { type: "PaymentDeclinedError", message: "Card declined" } },
//   ],
//   rootAttributes: { 'app.user.id': 'usr_123', 'app.customer.tier': 'enterprise' },
//   bottleneck: "payment.process (92% of total duration)",
//   errorChain: ["PaymentDeclinedError in payment.process"]
// }
```

Pair this with the inspect CLI and the test harness, and an agent can read the schema, query recent traces, identify bottlenecks, and verify its own instrumentation — all without leaving the terminal.

---

## Environment variables

Standard OTel variables (canon-signal honors these):

| Variable | Description |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base OTLP collector endpoint URL; canon-signal appends the signal path by default |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` or `grpc` |
| `OTEL_EXPORTER_OTLP_HEADERS` | Comma-separated key=value pairs |
| `OTEL_SERVICE_NAME` | Overrides `service.name` |
| `OTEL_RESOURCE_ATTRIBUTES` | Additional resource attributes |

Canon Signal-specific:

| Variable | Description |
|---|---|
| `CANON_SIGNAL_SAMPLE_RATE` | Override `sampling.defaultRate` (0.0–1.0) |
| `CANON_SIGNAL_DEBUG` | Force-keep all traces, verbose console output |
---

## Architecture

canon-signal is a closure-based factory: `createSignal<T>()` initializes the OTel SDK, creates an `AsyncLocalStorage` instance, and returns a `Signal<T>` object whose methods all close over the same state. There are no module-level singletons.

### Source tree

```
src/
├── index.ts                          # Main public exports
├── auto.ts                           # Zero-config entry: import { signal } from 'canon-signal/auto'
│
├── types/
│   ├── attributes.ts                 # SignalAttributes base interface
│   ├── otel.ts                       # Re-exported OTel types (Span, AttributeValue, etc.)
│   ├── config.ts                     # CreateSignalOptions<T>, SchemaConfig, SamplingConfig, etc.
│   └── signal.ts                     # Signal<T> public interface
│
├── factory/
│   ├── create.ts                     # createSignal<T>() — wires everything together
│   ├── config.ts                     # Options normalization, env var resolution
│   ├── validate.ts                   # Throws on prohibited sensitivity
│   ├── shutdown.ts                   # Multi-provider graceful shutdown
│   └── instrumentation.ts            # @opentelemetry/auto-instrumentations-node registration
│
├── context/
│   ├── store.ts                      # AsyncLocalStorage<SignalContext> factory
│   ├── scope.ts                      # getContext() (throws) / getContextSafe() (returns undefined)
│   └── detection.ts                  # isInRequestScope() guard
│
├── instrumentation/
│   ├── attr.ts                       # signal.attr / signal.attrs / signal.getAttr / signal.traceId
│   ├── span.ts                       # signal.span — child span with auto error handling
│   ├── trace.ts                      # signal.trace — new root trace for background work
│   ├── event.ts                      # signal.event — span events on active span
│   ├── error.ts                      # signal.error — recordException + ERROR status
│   ├── link.ts                       # signal.link — W3C traceparent parsing
│   └── keep.ts                       # signal.keep — sets app.debug for guaranteed export
│
├── sampling/
│   ├── processor.ts                  # TailSamplingProcessor — outcome-aware sampling
│   └── db-summary.ts                 # DbSummaryProcessor — auto-computed app.db.* attributes
│
├── logging/
│   ├── log.ts                        # signal.log — context-aware (auto trace_id/span_id)
│   └── system-log.ts                 # signal.systemLog — process-scoped (never auto-correlates)
│
├── metrics/
│   └── meter.ts                      # signal.meter — counter/gauge/histogram with typed instruments
│
├── export/
│   ├── resolve.ts                    # export config → trace/log exporters + metric readers
│   ├── otlp.ts                       # OTLP exporters (traces, logs, metrics)
│   ├── console.ts                    # OTel ConsoleSpanExporter wrapper
│   ├── pretty-console.ts             # Human-friendly console exporters for traces/logs/metrics
│   ├── file.ts                       # JSONL file exporters for traces/logs/metrics
│   └── ring-buffer.ts                # In-memory ring buffer for inspect CLI
│
├── middleware/
│   ├── common.ts                     # Shared scope creation, auto-attribute injection,
│   │                                 # auto-instrumented span detection, error mapping
│   ├── loader.ts                     # Framework dispatch (signal.middleware() entry)
│   ├── hono.ts                       # Hono middleware
│   ├── express.ts                    # Express middleware
│   ├── fastify.ts                    # Fastify plugin
│   └── next.ts                       # Next.js middleware (App Router + Pages Router)
│
├── bridges/
│   ├── pino.ts                       # createPinoTransport — Pino → OTel LogRecords
│   └── winston.ts                    # createWinstonTransport — Winston → OTel LogRecords
│
├── testing/
│   ├── index.ts                      # canon-signal/testing entry point
│   └── harness.ts                    # createTestHarness — typed assertions, in-memory readers
│
├── inspect/
│   ├── cli.ts                        # canon-signal inspect — trace JSONL file → tree renderer
│   ├── query.ts                      # Trace filtering helpers (errors, route, attribute)
│   └── narrate.ts                    # narrateTrace — structured summary for agents
│
└── cli/
    └── create.ts                     # canon-signal create — generates src/signal.ts template
```

### File responsibilities

**`src/index.ts`** — The public surface. Re-exports `createSignal`, the `Signal<T>` type, `SignalAttributes`, and `CreateSignalOptions<T>`. Nothing else.

**`src/factory/create.ts`** — The heart. `createSignal<T>()` runs schema validation, normalizes config, creates the AsyncLocalStorage store, builds OTel providers (tracer, logger, meter), wires the DB summary processor + tail sampling processor + configured exporters, registers auto-instrumentation, and returns a `Signal<T>` object whose methods all close over the captured state. No globals — every signal instance is independently encapsulated.

**`src/types/`** — Pure types, no runtime behavior. `attributes.ts` defines the `SignalAttributes` base interface (just three optional well-known keys); user interfaces extend it. `signal.ts` defines `Signal<T>` with the generic flowing through `attr<K extends keyof T>`. `config.ts` defines every options shape. `otel.ts` re-exports the few OTel types user code sees so they don't have to install `@opentelemetry/api` themselves.

**`src/context/`** — The AsyncLocalStorage layer. `store.ts` defines the `SignalContext` shape (`{ rootSpan, activeSpan, traceId, attributes }`) and the `createStore()` factory. `scope.ts` exposes `getContext()` (throws with a clear error if outside scope) and `getContextSafe()` (returns undefined — used by `signal.traceId()` and `signal.log` for soft fallback). The `attributes` map is canon-signal's solution to OTel's lack of a public `Span.getAttribute()` reader: we maintain a parallel cache so `signal.getAttr()` works.

**`src/instrumentation/`** — One file per `signal.*` method. Each exports a `createXFn(store, ...)` function that returns the actual method, closed over the context store. They never touch OTel providers directly; they manipulate spans pulled from the active context.

- `attr.ts` writes to both `rootSpan.setAttribute()` AND the parallel `attributes` map (so `getAttr` can read back)
- `span.ts` calls `tracer.startActiveSpan()` and forks a new context where `activeSpan` is the child but `rootSpan` is preserved
- `trace.ts` creates a new root span (no parent) and a fresh context — used for background jobs
- `error.ts` and `event.ts` target `activeSpan` (which may be the root or a child)
- `keep.ts` flips `app.debug = true` so the sampling processor always exports the trace
- `link.ts` parses W3C traceparent strings into OTel `Link` objects

**`src/middleware/`** — `common.ts` is the heart. It tries `trace.getActiveSpan()` first to detect an existing auto-instrumented HTTP span (created by `@opentelemetry/instrumentation-http`); if found, it uses that span as the root and skips ending it (auto-instrumentation will). Otherwise, it creates its own span and ends it. Either way, it sets `http.request.method`, `http.route`, `app.request.id`, `app.schema.version`, runs the handler inside `store.run(ctx, ...)`, and writes `http.response.status_code` in the finally block. Each framework-specific file (`hono.ts`, `express.ts`, `fastify.ts`, `next.ts`) is a thin adapter that pulls method/route/headers from the framework's request object and calls into `common.ts`.

**`src/sampling/processor.ts`** — `TailSamplingProcessor` wraps a delegate `SpanProcessor`. On `onEnd`, it evaluates the rules in order (debug → errors → slow → routes → attributes → probabilistic hash) and only forwards to the delegate if the span should be exported. Deterministic hashing on `traceId` ensures cross-service consistency.

**`src/sampling/db-summary.ts`** — `DbSummaryProcessor` accumulates `db.system`-tagged child span durations per trace ID. When a root span ends (`parentSpanId === undefined`), it writes `app.db.total_duration_ms` and `app.db.query_count` onto the root span before the next processor in the chain sees it.

**`src/export/`** — Each file is a self-contained exporter family. `resolve.ts` expands `export.all`, then resolves traces and logs into exporters and metrics into `MetricReader`s. It always prepends an `InMemorySpanExporter` and `InMemoryLogRecordExporter` so the test harness has something to read from regardless of user config. `pretty-console.ts` is still richest on the trace side — it buffers spans by trace ID and renders a waterfall when the root span arrives — but the module also carries the lighter pretty renderers for logs and metrics.

**`src/logging/log.ts`** — `signal.log.*()` methods. Each method checks `store.getStore()` (soft check, no throw), and if a context exists, attaches `trace_id` and `span_id` to the log attributes before calling `otelLogger.emit()`.

**`src/logging/system-log.ts`** — `signal.systemLog.*()` methods. Identical to `log.ts` but **never** checks the store. Two separate APIs so the developer has to think about whether they're logging about the system or the request.

**`src/metrics/meter.ts`** — `signal.meter()` takes a typed instrument definition map and returns a typed wrapper map where each entry has the right method (`.add()`, `.set()`, `.record()`) for its instrument type. Uses TypeScript conditional types to map `'counter' | 'gauge' | 'histogram'` to the right instrument shape.

**`src/testing/harness.ts`** — `createTestHarness()` returns a `TestHarness<T>` with typed assertions. Reads from the in-memory exporters that `resolve.ts` always wires in. The `assertAttr` method's key parameter is constrained to `keyof T`, so you can't typo a key in a test.

**`src/bridges/pino.ts`** — Returns a `node:stream.Writable` that Pino can write to as a transport target. On every chunk, splits by newline, parses as JSON, maps Pino's numeric levels (10–60) to OTel `SeverityNumber`, auto-injects `trace_id`/`span_id` from the active span if present, and emits via `loggerProvider.getLogger().emit()`. The logger is resolved fresh on every emit (no caching) so test isolation works when multiple `createSignal()` calls happen.

**`src/bridges/winston.ts`** — Same idea, but extends `winston-transport`'s `Transport` class. Strips Winston's internal `Symbol(level)` / `Symbol(message)` / `Symbol(splat)` keys before mapping the rest to OTel attributes.

**`src/auto.ts`** — Reads `package.json` and `OTEL_SERVICE_NAME` / `NODE_ENV`, then exports a `signal` instance created with `SignalAttributes` (the base type, no custom attributes). For evaluation only.

**`src/cli/create.ts`** — Reads the user's `package.json`, detects framework from dependencies, and writes a starter `src/signal.ts` template. Pulls service name and version from `package.json`.

**`src/inspect/cli.ts`** — CLI command that reads a JSONL spans file (produced by the `file` exporter), groups spans by trace ID, and prints either a tree view or JSON output. Supports filtering by `--errors`, `--last N`, `--trace <id>`.

**`src/inspect/narrate.ts`** — `narrateTrace()` takes raw spans and produces a structured `TraceNarrative` object with summary, timeline, root attributes, bottleneck identification, and error chain. Designed for programmatic agent consumption.

**`src/inspect/query.ts`** — Helpers for filtering spans by error status, route, or attribute value. Used by the inspect CLI.

---

## Reference documents

The package ships a `resources/` directory with documentation designed for both human readers and AI agents working in TypeScript projects that use canon-signal:

| Document | What it contains |
|---|---|
| [`resources/CONSTITUTION.md`](./resources/CONSTITUTION.md) | The principles — *why* trace-first observability, what makes a canonical event, when to use each signal. The philosophical foundation. **Read this first.** |
| [`resources/PLAYBOOK.md`](./resources/PLAYBOOK.md) | The rules — explicit do's and don'ts for working with canon-signal in your codebase. |
| [`resources/API.md`](./resources/API.md) | Function-by-function reference for the public `signal.*` API. |
| [`resources/PATTERNS.md`](./resources/PATTERNS.md) | Common patterns with complete code examples. |
| [`resources/ANTI_PATTERNS.md`](./resources/ANTI_PATTERNS.md) | Things that look right but violate the principles, with examples. |
| [`resources/TROUBLESHOOTING.md`](./resources/TROUBLESHOOTING.md) | Common errors and their fixes. |
| [`resources/tutorial/canon-signal-tutorial.html`](./resources/tutorial/canon-signal-tutorial.html) | A self-contained HTML walkthrough for human learners. Open in any browser. |

To install these into your own project so AI agents can read them locally:

```bash
npx canon-signal install-docs
```

This scaffolds a `.canon-signal/` directory at the root of your repo with copies of the agent-facing docs. Agents working in your codebase can then read from `.canon-signal/` without digging into `node_modules`.

---

## Subpath exports

| Import path | Provides |
|---|---|
| `canon-signal` | `createSignal`, `SignalAttributes`, `Signal<T>`, `CreateSignalOptions<T>` — your setup file |
| `canon-signal/testing` | Test harness and assertion helpers — for test files |
| `canon-signal/bridges/pino` | `createPinoTransport()` — for Pino migration |
| `canon-signal/bridges/winston` | `createWinstonTransport()` — for Winston migration |
| `canon-signal/auto` | A pre-configured `signal` instance — for evaluation only |

Each subpath is an independent tree-shaking boundary. If you never import `canon-signal/bridges/pino`, none of that code ends up in your bundle.

---

## Dependencies

**Bundled** (regular `dependencies` — you never install these manually):

```
@opentelemetry/api
@opentelemetry/api-logs
@opentelemetry/auto-instrumentations-node
@opentelemetry/exporter-logs-otlp-proto
@opentelemetry/exporter-metrics-otlp-proto
@opentelemetry/exporter-trace-otlp-proto
@opentelemetry/resources
@opentelemetry/sdk-logs
@opentelemetry/sdk-metrics
@opentelemetry/sdk-node
@opentelemetry/sdk-trace-base
@opentelemetry/sdk-trace-node
@opentelemetry/semantic-conventions
```

**Optional peer dependencies** (only needed if you use them):

- `hono`, `express`, `fastify`, `next` — for `signal.middleware()`
- `pino`, `winston` — for the logger bridges
- `winston-transport` — required by the Winston bridge

---

## Compatibility

- **Node.js:** 18+ (stable `AsyncLocalStorage`, `crypto.randomUUID()`)
- **TypeScript:** 5.0+
- **Module formats:** Dual ESM and CJS

---

## Contributing

### Reporting issues

The fastest way to file a bug, feature request, or question is the built-in CLI:

```bash
npx canon-signal report-issue "Brief description"
```

This opens a pre-filled GitHub issue with diagnostic information already attached. See the [`report-issue` CLI section](#npx-canon-signal-report-issue) above for full options.

You can also file issues manually at the [GitHub issue tracker](https://github.com/derekurban/canon-signal/issues). Issue templates are provided for bugs, features, and questions.

### Local development

```bash
git clone https://github.com/derekurban/canon-signal.git
cd canon-signal
npm install

npm run typecheck    # tsc --noEmit with strict flags
npm run test         # vitest in watch mode
npm run test:run     # single test run
npm run build        # tsup dual ESM/CJS build
```

The repo includes:

- `.design/` (gitignored) — historical design documents from package construction
- `resources/` — agent docs and HTML tutorial that ship with the package
- `src/` — source organized by concern (factory, context, instrumentation, sampling, etc.)
- `tests/` — vitest tests, mirroring `src/` structure

Read `resources/CONSTITUTION.md` before proposing API changes — most design decisions trace back to specific principles documented there.

### CI / CD

Two GitHub Actions workflows ship with the repo:

- **`.github/workflows/ci.yml`** — Runs on every push and PR to `main`. Typecheck, tests, and build across Node 18, 20, and 22.
- **`.github/workflows/publish.yml`** — Runs when a version tag (`v*`) is pushed. Re-runs the full pipeline and publishes to npm with provenance attestations.

### Releasing a new version

The release flow for maintainers:

1. Update the version in `package.json`
2. Add a `## [x.y.z]` section to `CHANGELOG.md` with the changes
3. Commit the changes (`chore(release): vx.y.z`)
4. Tag and push:
   ```bash
   git tag vx.y.z
   git push origin main vx.y.z
   ```
5. The publish workflow runs automatically. Verify the new version appears at `https://www.npmjs.com/package/canon-signal`.

The publish workflow uses `--access public --provenance`. Provenance requires the `id-token: write` permission, which is configured in the workflow file. The `NPM_TOKEN` secret must be set in the repo settings (one-time setup with a granular access token from npmjs.com).

The first publish must be done manually (`npm publish --access public`) to claim the unscoped package name. After that, subsequent publishes use the workflow.

---

## Status

Pre-1.0. The API is settling but breaking changes may still occur between minor versions. Once it hits 1.0, breaking changes will only ship in majors. See `CHANGELOG.md` for the full history.

## License

MIT — see [`LICENSE`](./LICENSE) for the full text.
