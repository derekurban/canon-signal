# canon-signal Anti-Patterns

Things that look reasonable but violate canon-signal's principles. Each entry shows the bad code, the good code, and the reason.

When reviewing PRs or refactoring existing code, this document is your checklist.

---

## A1. Using `console.log` in request handlers

```typescript
// ❌ BAD
app.post('/checkout', (c) => {
  const userId = c.req.header('x-user-id')
  console.log('Checkout started for user', userId)
  console.log('Cart total:', body.total)
  // ...
  console.log('Checkout completed')
  return c.json({ ok: true })
})
```

```typescript
// ✅ GOOD
app.post('/checkout', (c) => {
  const userId = c.req.header('x-user-id')

  signal.attr('app.user.id', userId)
  signal.attr('app.cart.total', body.total)

  // No log line for "completed" — the root span's end time and OK status
  // already record that.

  return c.json({ ok: true })
})
```

**Why**: `console.log` produces unstructured output scattered across stdout with no trace correlation. The same data as span attributes is queryable, structured, and bound to the request. The "completed" log line is redundant — the root span's duration and status already convey it.

---

## A2. High-cardinality span names

```typescript
// ❌ BAD
await signal.span(`db.query.SELECT_FROM_users_WHERE_id_${userId}`, async () => {
  return db.users.findById(userId)
})

await signal.span(`payment.process.${customerId}`, async () => {
  return processPayment(customerId)
})
```

```typescript
// ✅ GOOD
await signal.span('db.query.users.find_by_id', async (span) => {
  span.setAttribute('app.user.id', userId)  // user ID goes in attribute
  return db.users.findById(userId)
})

await signal.span('payment.process', async (span) => {
  span.setAttribute('app.customer.id', customerId)
  return processPayment(customerId)
})
```

**Why**: Span names are indexed by trace backends. High-cardinality names (one unique value per request) blow up the index and break the backend. Variable data goes in attributes, which are columnar-stored and handle high cardinality fine.

The rule of thumb: if your span name contains a `${variable}`, you're probably doing it wrong.

---

## A3. Calling `signal.log` for things that should be attributes

```typescript
// ❌ BAD
app.post('/checkout', (c) => {
  signal.log.info('user checkout', { userId: 'usr_123', tier: 'enterprise' })
  return c.json({ ok: true })
})
```

```typescript
// ✅ GOOD
app.post('/checkout', (c) => {
  signal.attr('app.user.id', 'usr_123')
  signal.attr('app.customer.tier', 'enterprise')
  return c.json({ ok: true })
})
```

**Why**: Logs are a *secondary* signal in canon-signal. The attributes you pass to `signal.log` aren't queryable as efficiently as span attributes. The trace already records the request — adding a log line that says "this request happened" duplicates information.

Use `signal.log` only for things that:
- Need to exist as a separate, correlated record (audit trails)
- Don't fit the canonical span schema (free-form messages with high variance)
- Need to survive sampling decisions (logs aren't sampled)

For everything else: `signal.attr()`.

---

## A4. Using `signal.systemLog` inside a request handler

```typescript
// ❌ BAD
app.post('/checkout', (c) => {
  signal.systemLog.info('processing checkout request', { userId: 'usr_123' })
  return c.json({ ok: true })
})
```

```typescript
// ✅ GOOD — option A: use signal.attr for queryable data
app.post('/checkout', (c) => {
  signal.attr('app.user.id', 'usr_123')
  return c.json({ ok: true })
})

// ✅ GOOD — option B: use signal.log if you need a correlated log record
app.post('/checkout', (c) => {
  signal.log.info('checkout requested', { userId: 'usr_123' })
  return c.json({ ok: true })
})
```

**Why**: `signal.systemLog` is for events about the *system*, not the *request*. If you call it inside a handler, you lose the trace context (no `trace_id`/`span_id` attached) and you've made the log harder to debug. The split between `signal.log` and `signal.systemLog` exists specifically to force this distinction.

---

## A5. Creating a span for every function call

```typescript
// ❌ BAD
async function getUserById(id: string) {
  return await signal.span('getUserById', async () => {
    return db.users.findById(id)
  })
}

async function formatUser(user: User) {
  return await signal.span('formatUser', async () => {
    return { id: user.id, name: user.name }
  })
}

async function lookupAndFormat(id: string) {
  return await signal.span('lookupAndFormat', async () => {
    const user = await getUserById(id)
    return formatUser(user)
  })
}
```

```typescript
// ✅ GOOD
async function lookupAndFormat(id: string) {
  // The auto-instrumented db query already creates a span — we don't need to wrap it.
  const user = await db.users.findById(id)
  // Trivial in-memory transformation — no span needed.
  return { id: user.id, name: user.name }
}
```

**Why**: Spans have overhead. Hundreds of trivial spans clutter the trace, hurt readability, and inflate storage costs. Spans are for operations with meaningful duration that you'd actually want to see as separate blocks in a waterfall.

Auto-instrumentation already covers HTTP calls, database queries, Redis operations, and message queues. You almost never need to wrap them manually.

---

## A6. Catching an error without recording it

```typescript
// ❌ BAD
app.post('/checkout', async (c) => {
  try {
    await processPayment()
  } catch (err) {
    return c.json({ error: 'failed' }, 500)
  }
  return c.json({ ok: true })
})
```

```typescript
// ✅ GOOD
app.post('/checkout', async (c) => {
  try {
    await processPayment()
  } catch (err) {
    signal.error(err)
    signal.attr('app.error.code', 'PAYMENT_FAILED')
    signal.attr('app.error.retriable', false)
    return c.json({ error: 'failed' }, 500)
  }
  return c.json({ ok: true })
})
```

**Why**: When you catch an error and return a 500, the trace will show `http.response.status_code = 500` but nothing about *what* went wrong or *why*. `signal.error(err)` records the exception (type, message, stack) on the active span. `signal.attr('app.error.code', ...)` adds queryable error metadata to the root span so you can later filter on it (`"show me all PAYMENT_FAILED errors in the last hour"`).

The middleware records *uncaught* errors automatically. Caught-and-handled errors need explicit recording.

---

## A7. Generating attribute keys dynamically

```typescript
// ❌ BAD
for (const flag of activeFlags) {
  signal.attr(`app.feature.${flag}`, true)  // unbounded attribute keys
}

// ❌ ALSO BAD — even worse
signal.attr(`app.user_${userId}.last_action`, action)
```

```typescript
// ✅ GOOD — single attribute with delimited value
signal.attr('app.feature_flags', activeFlags.join(','))

// ✅ ALSO GOOD — known, enumerated attribute names
if (activeFlags.includes('checkout_v2')) {
  signal.attr('app.flag.checkout_v2', true)
}
```

**Why**: Dynamic attribute keys create unbounded cardinality on the *schema itself*, not just the attribute values. Storage backends index attribute keys, and unbounded keys break that indexing catastrophically.

Also: dynamic keys can't be type-checked. canon-signal's compile-time enforcement only works if every key is a literal you've declared in the interface.

---

## A8. Bypassing the schema with `as any`

```typescript
// ❌ BAD
;(signal as any).attr('app.bogus_field', 'whatever')

// ❌ ALSO BAD
signal.attr('app.user.id' as any, { complex: 'object' } as any)
```

```typescript
// ✅ GOOD — add the attribute to the interface first
// In src/signal.ts:
interface AppAttributes extends SignalAttributes {
  'app.bogus_field'?: string  // ← add it here, with a sensible name
  // ...
}

// Then use it normally:
signal.attr('app.bogus_field', 'whatever')
```

**Why**: The schema is the contract. `as any` defeats the entire point of canon-signal's type safety. If you need a new attribute, the cost of adding it to the interface is one line of code — there's no excuse for skipping it. If you need a complex object, flatten it into multiple attributes (or store it as a JSON string if you really must).

---

## A9. Putting large payloads in attributes

```typescript
// ❌ BAD
signal.attr('app.request.body', JSON.stringify(req.body))           // could be 50kb
signal.attr('app.error.stack', err.stack)                            // huge string
signal.attr('app.db.query', 'SELECT * FROM users WHERE ...')         // long
```

```typescript
// ✅ GOOD
// Stack traces are already recorded by signal.error() as a span event
signal.error(err)

// SQL queries — let auto-instrumentation handle them, or sanitize/truncate
signal.attr('app.db.operation', 'select')
signal.attr('app.db.table', 'users')

// Request bodies — don't put them in attributes. If you really need them,
// use a log record (and redact PII first).
signal.log.info('request received', { bodyHash: hash(req.body) })
```

**Why**:
- The default attribute value limit is 2048 bytes. Larger values are truncated by the OTel SDK.
- Stack traces belong on span events (`signal.error()` puts them there automatically) — they're not queryable dimensions.
- HTTP bodies often contain PII and are too large for attributes. If you absolutely need them, log records are the right surface (with redaction).
- Span attributes are for *queryable dimensions*, not arbitrary data dumps.

---

## A10. Multiple `createSignal()` calls

```typescript
// ❌ BAD — one signal per file
// src/api.ts
export const apiSignal = createSignal({ service: { name: 'api', ... } })

// src/worker.ts
export const workerSignal = createSignal({ service: { name: 'worker', ... } })
```

```typescript
// ✅ GOOD — one signal per service
// src/signal.ts
export const signal = createSignal({ service: { name: 'my-service', ... } })

// Everywhere else
import { signal } from './signal'
```

**Why**: A signal instance owns OTel providers, an AsyncLocalStorage store, and exporter pipelines. Multiple instances mean multiple sets of all of those, which is wasteful and produces fragmented telemetry. One signal per service. Always.

The exception: you may legitimately want a separate signal in tests for isolation. That's fine — the test harness creates its own. Production code has exactly one.

---

## A11. Forgetting `signal.middleware()`

```typescript
// ❌ BAD
const app = new Hono()
// No middleware registered

app.get('/users/:id', (c) => {
  signal.attr('app.user.id', c.req.param('id'))  // ← throws at runtime!
  return c.json({})
})
```

```typescript
// ✅ GOOD
const app = new Hono()
app.use('*', signal.middleware())  // ← register first

app.get('/users/:id', (c) => {
  signal.attr('app.user.id', c.req.param('id'))  // ← works
  return c.json({})
})
```

**Why**: The middleware is what creates the request scope. Without it, there's no AsyncLocalStorage context, and `signal.attr()` throws with `"Called outside a request scope"`. The middleware must be registered *before* any route handlers — middleware runs in registration order.

---

## A12. Manually wrapping auto-instrumented operations

```typescript
// ❌ BAD — duplicates the auto-instrumented span
await signal.span('db.query.users', async () => {
  return db.users.findById(id)
})

await signal.span('http.fetch', async () => {
  return fetch('https://api.stripe.com/v1/charges')
})
```

```typescript
// ✅ GOOD — let auto-instrumentation handle it
const user = await db.users.findById(id)
const response = await fetch('https://api.stripe.com/v1/charges')
```

**Why**: canon-signal's `createSignal()` registers `@opentelemetry/auto-instrumentations-node` which already creates spans for database queries, HTTP client calls, Redis operations, and message queue interactions. Wrapping them in `signal.span()` produces *two* spans for the same operation — one from auto-instrumentation and one from your wrapper.

Use `signal.span()` for business operations *not* covered by auto-instrumentation (`payment.process`, `order.create`, etc.), not for primitives that already have instrumentation.

---

## A13. Using telemetry as application state

```typescript
// ❌ BAD
app.post('/checkout', (c) => {
  signal.attr('app.user.id', 'usr_123')

  // ... later in some service function
  const userId = signal.getAttr('app.user.id')  // ← treating telemetry as state
  if (!userId) throw new Error('Missing user ID')
  return processOrder(userId)
})
```

```typescript
// ✅ GOOD — pass state through application channels
app.post('/checkout', (c) => {
  const userId = c.req.header('x-user-id') ?? throw new Error('Missing user ID')

  // Telemetry: record the value for debugging visibility
  signal.attr('app.user.id', userId)

  // Application logic: pass the value as a normal argument
  return processOrder(userId)
})
```

**Why**: Telemetry records what happened. Application state drives what should happen. They're different things. If your business logic depends on a value, pass it through normal channels (function arguments, request context). Use `signal.attr()` to *record* it for observability, not as a *transport* for the value.

`signal.getAttr()` exists for instrumentation libraries that legitimately need to read what was set elsewhere — not for general application logic.

---

## A14. Skipping tests for instrumentation

```typescript
// ❌ BAD — handler with rich instrumentation but no test
app.post('/checkout', async (c) => {
  signal.attr('app.user.id', 'usr_123')
  signal.attr('app.transaction.type', 'checkout')
  signal.attr('app.cart.total', body.total)
  // ... 50 more lines
})
```

```typescript
// ✅ GOOD — assert the instrumentation in a test
import { createHonoTestApp } from '../helpers/setup'

it('checkout sets canonical attributes', async () => {
  const { signal, harness, app } = createHonoTestApp()

  app.post('/checkout', async (c) => {
    signal.attr('app.user.id', 'usr_123')
    signal.attr('app.transaction.type', 'checkout')
    return c.json({ ok: true })
  })

  await app.request('/checkout', { method: 'POST' })

  const root = harness.rootSpan()
  harness.assertAttr(root!, 'app.user.id', 'usr_123')
  harness.assertAttr(root!, 'app.transaction.type', 'checkout')
  harness.reset()
})
```

**Why**: Without a test, the instrumentation can silently break during a refactor. Six months from now someone will reorganize the handler and forget to call `signal.attr('app.user.id', ...)`, and nobody will notice until there's an incident and the trace is missing the data you needed.

The test harness is purpose-built for this. Use it.

---

## A15. Using vague or non-namespaced attribute names

```typescript
// ❌ BAD
signal.attr('userId', 'usr_123')         // no namespace
signal.attr('tier', 'enterprise')         // ambiguous
signal.attr('http.user_id', 'usr_123')   // wrong namespace
```

```typescript
// ✅ GOOD
signal.attr('app.user.id', 'usr_123')
signal.attr('app.customer.tier', 'enterprise')
```

**Why**:
- `app.*` is the conventional namespace for business attributes. Standard OTel conventions (`http.*`, `db.*`, `service.*`, `error.*`) are reserved for those domains.
- Without namespacing, your business attributes can collide with auto-instrumentation attributes, and queries get confused.
- Dotted hierarchies (`app.user.id`, `app.customer.tier`) make backend filtering and grouping easier.

---

## A16. Mutating telemetry data after the fact

```typescript
// ❌ BAD
const root = signal.test.harness().rootSpan()
;(root!.attributes as any)['app.user.id'] = 'modified'
```

```typescript
// ✅ GOOD — set it correctly the first time
signal.attr('app.user.id', 'usr_123')
```

**Why**: `ReadableSpan.attributes` is read-only by interface and shouldn't be mutated by user code. The DB summary processor is the *only* place in canon-signal that mutates a finished span's attributes, and it does so as a documented exception. User code that mutates spans after capture produces inconsistent telemetry that doesn't match what was actually exported.

---

## A17. Calling `signal.shutdown()` mid-request

```typescript
// ❌ BAD
process.on('SIGTERM', () => {
  signal.shutdown()  // doesn't await — orphaned spans
})
```

```typescript
// ✅ GOOD
process.on('SIGTERM', async () => {
  await signal.shutdown()  // wait for flush
  process.exit(0)
})
```

**Why**: `signal.shutdown()` is async and flushes pending spans/logs/metrics before terminating providers. Not awaiting it can drop in-flight telemetry. Always await it before `process.exit()`.

---

## A18. Forgetting to reset the test harness between tests

```typescript
// ❌ BAD
describe('handlers', () => {
  const harness = signal.test.harness()

  it('test 1', async () => {
    await app.request('/a')
    expect(harness.allSpans().length).toBe(1)
  })

  it('test 2', async () => {
    await app.request('/b')
    expect(harness.allSpans().length).toBe(1)  // ← fails! contains span from test 1
  })
})
```

```typescript
// ✅ GOOD
describe('handlers', () => {
  const harness = signal.test.harness()

  it('test 1', async () => {
    await app.request('/a')
    expect(harness.allSpans().length).toBe(1)
    harness.reset()  // ← clean up
  })

  it('test 2', async () => {
    await app.request('/b')
    expect(harness.allSpans().length).toBe(1)  // ← passes
    harness.reset()
  })
})
```

**Why**: The harness reads from in-memory exporters that accumulate spans across the test file. Without `reset()`, captured state bleeds into subsequent tests and produces flaky failures.

You can also use `afterEach(() => harness.reset())` if every test needs the same cleanup.

---

## A19. Using `String(err)` instead of passing the error directly

```typescript
// ❌ BAD
catch (err) {
  signal.error(String(err))  // loses stack, type information
  signal.log.error(`error: ${err}`)
}
```

```typescript
// ✅ GOOD
catch (err) {
  signal.error(err)  // preserves type, message, stack
  signal.log.error('operation failed', { errorType: (err as Error).name })
}
```

**Why**: `signal.error(err)` calls `span.recordException(err)` which extracts `exception.type`, `exception.message`, and `exception.stacktrace` from the error. Passing a string instead loses all that structure. The exception event in the trace will only have a generic message instead of a proper stack trace.

---

## A20. Treating canon-signal like raw OpenTelemetry

```typescript
// ❌ BAD — using OTel directly
import { trace } from '@opentelemetry/api'

app.post('/checkout', (c) => {
  const tracer = trace.getTracer('checkout-handler')
  tracer.startActiveSpan('manual.checkout', (span) => {
    span.setAttribute('user.id', 'usr_123')
    // ... handler logic
    span.end()
  })
})
```

```typescript
// ✅ GOOD — using canon-signal
app.post('/checkout', (c) => {
  signal.attr('app.user.id', 'usr_123')  // adds to root span automatically
  // ... handler logic
  return c.json({ ok: true })
})
```

**Why**: canon-signal is an opinionated layer *above* raw OTel. Using OTel directly bypasses:
- The schema enforcement
- The ambient context propagation
- The middleware that auto-creates the request scope
- The test harness's typed assertions
- The sampling rules

If you find yourself reaching for `@opentelemetry/api` directly inside a handler, you're working against canon-signal's grain. The exception is when you're inside a `signal.span()` callback and want to set child-specific attributes via the `span` parameter — that's valid because the span is canon-signal-managed.

---

## The meta-pattern

Most anti-patterns in this document boil down to one of three root causes:

1. **Treating logs as the primary signal** instead of traces → use `signal.attr()` for queryable data, not `signal.log`
2. **Bypassing the schema** → if you need a new attribute, edit the interface; never `as any`
3. **Reinventing what canon-signal already provides** → use middleware, auto-instrumentation, and the harness instead of building your own

If you catch yourself doing any of these, stop and re-read `CONSTITUTION.md`. The principles will tell you which pattern to use instead.
