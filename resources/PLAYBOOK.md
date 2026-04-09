# canon-signal Playbook

The rules. Every entry is a specific, enforceable directive. When in doubt about how to use canon-signal in code, this is the document to consult.

The rules are grouped by concern. Within each group, every rule has a one-line statement, a brief explanation, and a "why" tied back to the constitution.

---

## Schema rules

### S1. The schema is the contract.

Every attribute your code sets must be declared in the `AppAttributes` interface that extends `SignalAttributes`. The TypeScript compiler enforces this — `signal.attr('app.bogus', 'value')` is a compile error if `'app.bogus'` is not in the interface.

**Why**: The interface is the single source of truth for what the service emits. It prevents drift, documents intent, and gives both humans and agents a queryable contract. *(Constitution §3, §6.1)*

### S2. Adding a new attribute means editing the interface first.

If you need to set a new attribute, you must add it to the `AppAttributes` interface in `src/signal.ts` (or wherever the project's signal setup file lives). The change is reviewable. The change is typed.

**Don't**: monkey-patch the interface, use `as any`, or call `setAttribute()` on raw spans to bypass the schema.

### S3. Required attributes go in the interface without `?`.

Optional attributes use `?`. Required attributes don't. The non-optional properties are the ones that must be present on every root span — and `harness.assertRequired()` enforces this in tests when paired with the `schema.required` array.

```typescript
interface AppAttributes extends SignalAttributes {
  'app.request.id': string         // required, no ?
  'app.user.id'?: string           // optional
  'app.customer.tier'?: 'free' | 'pro' | 'enterprise'  // optional with constrained values
}
```

### S4. Use the `app.*` namespace for business attributes.

Standard OTel semantic conventions (`http.*`, `db.*`, `service.*`, `error.*`) are reserved for those concepts. Anything specific to your business logic goes under `app.*`. This convention prevents collisions with auto-instrumentation and matches OTel norms.

### S5. Never declare a `prohibited` sensitivity attribute.

If you mark an attribute with `sensitivity: 'prohibited'` in the `schema.meta` config, `createSignal()` throws at startup. This is enforced — there's no override flag. Prohibited means prohibited (passwords, tokens, raw card numbers, session secrets).

---

## Instrumentation rules

### I1. `signal.attr()` always targets the root span.

It does not matter where in the call stack you call it from — inside a `signal.span()` callback, inside a service function, inside a utility module — `signal.attr()` writes to the root span of the current request.

**Why**: The root span is the canonical event. Request-level attributes (user ID, customer tier, transaction type) belong on it regardless of where in the code they're discovered. *(Constitution §3.1)*

### I2. `signal.error()` and `signal.event()` target the *active* span.

Inside a `signal.span()` callback, the child is the active span. `signal.error(err)` annotates the child (where the failure occurred). `signal.event(name)` adds an event to the child.

**The pairing pattern**:

```typescript
try {
  await signal.span('payment.process', async () => {
    await stripe.charges.create(...)
  })
} catch (err) {
  signal.error(err)                          // → annotates child (where it broke)
  signal.attr('app.error.code', 'PAYMENT')   // → annotates root (request outcome)
  throw err
}
```

Both annotations are preserved. The child records the location of the failure; the root records the request-level outcome.

### I3. `signal.attr`, `signal.attrs`, `signal.getAttr`, `signal.event`, `signal.error`, `signal.keep` all throw outside a request scope.

If you call them outside `signal.middleware()` (HTTP) or `signal.trace()` (background), they throw with a clear error message. This is intentional — these methods only make sense inside a request.

### I4. `signal.traceId()` and `signal.log` do *not* throw outside a scope.

They gracefully degrade. `signal.traceId()` returns `undefined`. `signal.log` emits a plain log record without trace context. This is intentional — they're meant to be safe to call from anywhere.

### I5. Use `signal.span()` only for operations with meaningful duration that cross a boundary.

Database calls and HTTP client calls are already auto-instrumented — you do *not* need to wrap them in `signal.span()`. Use `signal.span()` for:

- Business operations like `payment.process`, `order.create`, `user.authenticate`
- Complex computations with measurable cost
- File processing or batch operations
- External API calls not covered by auto-instrumentation

**Don't** use it for:

- Trivial operations (< 1ms)
- Every function call
- Anything inside a tight loop
- Operations already captured by auto-instrumentation

### I6. Span names must be low-cardinality.

Span names are indexed by the trace backend. High-cardinality names break that indexing. Use templates:

```typescript
// ✅ Good
signal.span('payment.process', ...)
signal.span('db.query.users.find', ...)

// ❌ Bad
signal.span(`payment.process.${userId}`, ...)
signal.span(`db.query.SELECT_FROM_users_WHERE_id_eq_${id}`, ...)
```

The user ID, query text, and other variable data go into **attributes**, never the span name. *(Constitution §3.5)*

### I7. Use `signal.event()` for point-in-time occurrences during a span.

Cache misses, retry attempts, state transitions, feature flag evaluations. These are timestamped annotations on the span — they appear in the trace waterfall as discrete events.

**Don't** use events for:

- High-frequency occurrences (every loop iteration)
- Large payloads (full HTTP bodies)
- Things that should be queryable as dimensions (use `signal.attr()` instead)

### I8. Use `signal.trace()` for non-HTTP units of work.

Background jobs, queue consumers, scheduled tasks, CLI commands, anything that isn't an HTTP request. Inside the callback, all the request-scope APIs work identically:

```typescript
async function processJob(job: Job) {
  await signal.trace('job.process', async () => {
    signal.attr('app.job.id', job.id)
    signal.attr('app.job.type', job.type)
    await doWork(job)
  }, { kind: 'consumer' })
}
```

The `kind` option matters: `'consumer'` for queue/message handlers, `'producer'` for outbound producers, `'internal'` (default) for everything else.

### I9. Use `signal.link()` to connect a new trace to a producer trace.

When a queue consumer processes a message, the new trace should link to the trace that produced the message:

```typescript
await signal.trace('message.consume', async () => {
  await processMessage(message)
}, {
  links: [signal.link(message.headers.traceparent)],
  kind: 'consumer',
})
```

This preserves causal relationships across asynchronous boundaries without nesting them in a single trace.

---

## Logging rules

### L1. Never use `console.log` in request handlers.

Anything you would have logged is probably a span attribute. The exceptions:

- A queryable dimension → `signal.attr()`
- A point-in-time event → `signal.event()`
- A rare audit-level event that needs trace correlation → `signal.log.info()`
- A system event unrelated to any request → `signal.systemLog.info()`

`console.log` outputs are unstructured, scattered, and unsearchable. There is no good reason to use them in instrumented code.

### L2. `signal.log` is context-aware.

When called inside a request scope, it auto-attaches `trace_id` and `span_id` to the log record so you can navigate from a log line to its trace. Outside a request scope, it emits a plain log record with no trace context.

```typescript
signal.log.info('audit event', { resource: 'patients', count: 47 })
```

### L3. `signal.systemLog` is process-scoped.

It **never** attaches trace context, even when called inside a request scope. Use it for events about the system, not the request:

- Service startup/shutdown
- Configuration loading
- Connection pool changes
- Health status changes
- Periodic background heartbeats

```typescript
signal.systemLog.info('Service started', { port: 3000 })
```

The split between `signal.log` and `signal.systemLog` is deliberate UX — it forces you to think about whether you're logging about the request or the system.

### L4. Logs are a secondary signal.

Most things you would have logged should be attributes or events on a span. Logs are for the rare cases where you need a separate, correlated record outside the trace structure: audit trails, compliance records, supplementary error surfaces.

**Don't** treat `signal.log` as a drop-in replacement for `console.log`. The default answer to "should I log this?" is "no — set it as an attribute."

---

## Sampling rules

### SA1. Sampling is configured once in `createSignal()`.

Don't try to make per-request sampling decisions in user code. Configure the rules at startup and let the `TailSamplingProcessor` evaluate them automatically.

### SA2. Always keep errors and slow requests.

```typescript
sampling: {
  alwaysKeep: {
    errors: true,
    slowerThanMs: 2000,
  },
  defaultRate: 0.1,
}
```

Sampling at 10% saves cost but you must always keep failures and slow paths — they're the most valuable traces for debugging.

### SA3. Use `signal.keep()` to guarantee a specific trace is exported.

For one-off debugging — investigating a specific user, a specific feature flag, a specific session — call `signal.keep()` inside the handler. It sets `app.debug = true` on the root span, which the sampling processor always honors.

```typescript
if (userId === 'usr_problematic') {
  signal.keep()
}
```

The kept trace is also queryable later by filtering on `app.debug = true`.

---

## Error handling rules

### E1. Catching an error means recording it.

If you catch an error, you almost always want to call `signal.error(err)` to record it on the active span. The middleware records uncaught errors automatically, but caught-and-handled errors need explicit recording.

```typescript
try {
  await riskyOperation()
} catch (err) {
  signal.error(err)
  signal.attr('app.error.code', 'OPERATION_FAILED')
  signal.attr('app.error.retriable', true)
  // ... handle the error
}
```

### E2. Set error metadata as root span attributes.

Error type, error code, retriable flag, severity — these go on the root span via `signal.attr()`, not on individual child spans. The root span is the queryable canonical event; that's where someone will look first.

### E3. Re-throw or return — both are fine.

`signal.error()` doesn't change control flow. After recording the error, you can re-throw it (and let the middleware finish marking the request as failed), or you can handle it gracefully and return a response. Both patterns are valid.

---

## Testing rules

### T1. Every handler with non-trivial instrumentation needs a test.

Use `signal.test.harness()` to verify the instrumentation. Tests catch drift: if a refactor accidentally drops a `signal.attr` call, the test fails before it ships.

### T2. Use the test helpers.

The project provides `tests/helpers/setup.ts` with `createTestSignal()` and `createHonoTestApp()`. Use them. Don't reimplement signal/harness setup in every test file.

```typescript
import { createHonoTestApp } from '../helpers/setup'

const { signal, harness, app } = createHonoTestApp()
```

### T3. Always call `harness.reset()` between assertions on different traces.

Each test should clean up after itself. If you don't reset, captured spans bleed into the next test.

### T4. Use typed assertions, not raw attribute access.

```typescript
// ✅ Good — typed against your schema
harness.assertAttr(root!, 'app.user.id', 'usr_123')

// ❌ Bad — bypasses type safety
expect(root!.attributes['app.user.id']).toBe('usr_123')
```

The typed assertion catches typos at compile time. The raw access doesn't.

### T5. Assert required attributes.

For handlers where the schema declares `required: ['app.request.id', ...]`, call `harness.assertRequired(root!)` to verify every required attribute is present.

---

## Code organization rules

### O1. The signal instance is created once.

Exactly one `createSignal()` call per project, in a dedicated setup file (typically `src/signal.ts`). Every other file imports the exported instance. No multiple signals, no global mutation.

```typescript
// src/signal.ts
export const signal = createSignal<AppAttributes>({ ... })

// Everywhere else
import { signal } from './signal'  // or '@/signal' with path aliases
```

### O2. The schema lives next to the signal instance.

The `AppAttributes` interface is defined in the same file as the `createSignal()` call. They're conceptually inseparable — the interface IS the schema.

### O3. Auto-instrumentation does the work for HTTP/DB/Redis/queues.

You do not need to manually wrap database queries, HTTP client calls, Redis operations, or message queue interactions in `signal.span()`. The auto-instrumentation registered by `createSignal()` creates child spans automatically. Trying to wrap them yourself produces duplicate spans.

### O4. Middleware is registered before any route handlers.

```typescript
app.use('*', signal.middleware())  // FIRST
app.get('/users/:id', handler)     // THEN routes
```

Middleware that runs after the route handler can't establish the request scope before the handler executes. The order matters.

---

## Performance and cardinality rules

### P1. Span attributes can be high cardinality. Span names cannot.

Attributes like `app.user.id`, `app.request.id`, `app.deploy.sha` are fine on individual spans — columnar trace stores handle high-cardinality attributes well. Span *names* must be low-cardinality (under ~100 unique values per service) because backend indexing depends on it.

### P2. Metric labels must be low cardinality.

Unlike span attributes, metric labels create separate time series per unique value. Putting `userId` in a metric label creates millions of time series and crashes Prometheus. Keep label dimensions to under ~20 unique values each.

### P3. Don't put large payloads in attributes.

Stack traces go in span events (use `signal.error()`). Full HTTP request/response bodies go in log records if captured at all (and rarely — they often contain PII). SQL query text goes in sanitized form, or is omitted entirely. The default attribute value limit is 2048 bytes; respect it.

### P4. Don't generate attribute keys dynamically.

```typescript
// ❌ Bad — creates unbounded attribute keys
signal.attr(`app.feature.${featureName}`, true)

// ✅ Good — single attribute with delimited value
signal.attr('app.feature_flags', activeFlags.join(','))

// ✅ Also good — known, enumerated attribute names
signal.attr('app.flag.checkout_v2', true)
```

Dynamic attribute keys create unbounded cardinality on the *schema* itself, which is catastrophic for storage backends.

---

## When in doubt

- If you're unsure whether to use `signal.attr()` or `signal.event()`: ask "would I want to filter or GROUP BY this?" If yes, attribute. If no, event.
- If you're unsure whether to use `signal.log` or `signal.attr`: default to attribute. Reach for log only if the data is request-related but doesn't fit the canonical span schema (audit trails, compliance records).
- If you're unsure whether to use `signal.log` or `signal.systemLog`: ask "is this about the request or the system?" If you can't decide, it's probably an attribute.
- If you're unsure whether to create a child span: ask "would I want to see this as a distinct block in the waterfall with its own duration?" If yes, span. If no, don't.
- If you're unsure whether something is a violation of the principles: re-read `CONSTITUTION.md`. The answer is almost always there.

---

## The shortest version

1. Define your schema in a TypeScript interface.
2. Set attributes via `signal.attr()`. The compiler enforces the schema.
3. Use `signal.span()` for sub-operations with meaningful duration.
4. Use `signal.error()` to record exceptions on the active span.
5. Use `signal.log` rarely; default to attributes.
6. Use `signal.trace()` for background jobs.
7. Test with `signal.test.harness()`.
8. Keep span names low-cardinality.
9. Never bypass the schema.
10. Read the constitution.
