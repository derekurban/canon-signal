# canon-signal Patterns

Complete, working code examples for common scenarios. Each pattern includes the *why* alongside the *what*. When you need to implement a pattern, copy the relevant section, adapt the attribute names to your schema, and you're done.

---

## Pattern 1: HTTP handler with request context

The most common pattern. Set request-level attributes on the root span as soon as you have them.

```typescript
import { Hono } from 'hono'
import { signal } from './signal'

const app = new Hono()
app.use('*', signal.middleware())

app.post('/checkout', async (c) => {
  const body = await c.req.json()

  // Step 1: Set request-level context as early as possible.
  // These attributes land on the root span and are queryable later.
  signal.attr('app.user.id', body.userId)
  signal.attr('app.customer.tier', body.tier)
  signal.attr('app.transaction.type', 'checkout')

  // Step 2: Do the work
  const order = await createOrder(body)

  // Step 3: Return response. Middleware sets http.response.status_code automatically.
  return c.json({ orderId: order.id })
})
```

**Why**: The root span is your canonical event. Anything you might want to query later (`"show me all enterprise checkouts that returned 500"`) needs to be an attribute on the root. Set them as soon as you know them, not at the end of the handler.

---

## Pattern 2: Child span for a sub-operation

When part of a request has meaningful duration and you'd want to see it as a distinct block in the trace waterfall.

```typescript
app.post('/checkout', async (c) => {
  signal.attr('app.user.id', 'usr_123')

  // Wrap the slow operation in a child span
  const charge = await signal.span('payment.process', async (span) => {
    // Operation-specific attributes go on the child span via setAttribute
    span.setAttribute('payment.provider', 'stripe')
    span.setAttribute('payment.amount_cents', 4999)

    // Auto-instrumented HTTP call to Stripe — appears as a nested span automatically
    const result = await stripe.charges.create({ amount: 4999 })

    span.setAttribute('payment.charge_id', result.id)
    return result
  })

  return c.json({ chargeId: charge.id })
})
```

**Trace shape**:

```
POST /checkout  847ms
├─ payment.process  780ms
│  └─ HTTPS POST stripe.com/v1/charges  750ms  (auto-instrumented)
└─ user.id=usr_123
```

**Why**:
- The child span gives you a duration breakdown — at a glance you see that `payment.process` accounts for 780ms of the 847ms total.
- Operation-specific attributes (`payment.provider`, `payment.charge_id`) go on the child via `span.setAttribute()` because they don't belong on the canonical schema.
- `signal.attr('app.user.id', ...)` still targets the root span, even when called inside the callback.

---

## Pattern 3: Error handling with active span vs root span

When something fails, record the exception on the active span and the error metadata on the root span.

```typescript
app.post('/checkout', async (c) => {
  signal.attr('app.user.id', 'usr_123')

  try {
    const charge = await signal.span('payment.process', async (span) => {
      span.setAttribute('payment.provider', 'stripe')
      const result = await stripe.charges.create({ amount: 4999 })
      return result
    })

    return c.json({ chargeId: charge.id })
  } catch (err) {
    // signal.error targets the active span — but at this point we're back
    // outside the signal.span() callback, so the active span is the root.
    // The exception was already recorded on the child span when it threw
    // (signal.span auto-handles its own errors).

    // What we add here is request-level error metadata on the root.
    signal.attr('app.error.code', 'PAYMENT_DECLINED')
    signal.attr('app.error.retriable', false)

    return c.json({ error: 'payment declined' }, 402)
  }
})
```

**Inside the `signal.span()` callback**, if you catch an error and want to annotate the *child* span:

```typescript
await signal.span('payment.process', async (span) => {
  try {
    return await riskyOperation()
  } catch (err) {
    signal.error(err)  // Records on the child span (the active one)
    signal.attr('app.error.code', 'OPERATION_FAILED')  // Still targets root
    throw err
  }
})
```

**Why**:
- The child span records *where* the failure occurred. The root span records the *outcome of the request*.
- Both annotations are preserved. When debugging, you start at the root (looking at error code) and drill into the child (looking at the exception details).

---

## Pattern 4: Background job with `signal.trace()`

For non-HTTP work that doesn't go through middleware. The `signal.trace()` function creates a brand new trace with a new root span.

```typescript
import { signal } from './signal'

interface EmailJob {
  id: string
  to: string
  subject: string
}

export async function processEmailJob(job: EmailJob): Promise<void> {
  await signal.trace('job.send_email', async () => {
    // Inside this callback, all signal.* APIs work as if you're in HTTP middleware
    signal.attr('app.job.id', job.id)
    signal.attr('app.job.type', 'email')

    await signal.span('email.render', async () => {
      // ... render the template
    })

    await signal.span('email.send', async (span) => {
      span.setAttribute('email.recipient_domain', job.to.split('@')[1])
      await sendEmail(job)
    })

    signal.log.info('email job completed', { jobId: job.id })
  }, { kind: 'internal' })
}
```

**Why**:
- HTTP middleware creates the request scope automatically. Background jobs need to create it explicitly via `signal.trace()`.
- The `kind` option matters: use `'consumer'` for queue handlers, `'producer'` for outbound message producers, `'internal'` for everything else.
- Inside the callback, the full request scope is active — you can use all the same instrumentation APIs.

---

## Pattern 5: Message consumer with span links

When processing a message from a queue, link the consumer trace back to the producer trace so you can navigate causally.

```typescript
import { signal } from './signal'

interface KafkaMessage {
  topic: string
  partition: number
  offset: number
  headers: { traceparent?: string }
  value: Buffer
}

export async function onMessage(message: KafkaMessage): Promise<void> {
  const links = message.headers.traceparent
    ? [signal.link(message.headers.traceparent)]
    : []

  await signal.trace('message.consume', async () => {
    signal.attr('app.queue.topic', message.topic)
    signal.attr('app.queue.partition', message.partition)
    signal.attr('app.queue.offset', message.offset)

    await processMessage(message)
  }, {
    links,
    kind: 'consumer',
  })
}
```

**Why**:
- The consumer trace is its own trace (its own root span, its own trace ID). It doesn't share a tree with the producer.
- The link preserves the causal relationship: in your trace backend, you can navigate from the consumer trace to the producer trace and vice versa.
- Don't try to nest the consumer under the producer as a child span — they have independent lifecycles, often hours or days apart.

---

## Pattern 6: Schema evolution

Adding a new attribute to your schema. The TypeScript interface is the source of truth.

**Step 1**: Edit `src/signal.ts` and add the new attribute to the interface.

```typescript
interface AppAttributes extends SignalAttributes {
  'app.user.id'?: string
  'app.customer.tier'?: 'free' | 'pro' | 'enterprise'
  'app.referral.source'?: 'organic' | 'paid' | 'partner'  // ← new
}
```

**Step 2**: Optionally add metadata in the `schema.meta` config:

```typescript
schema: {
  version: '1.1.0',  // bump the version when you add attributes
  meta: {
    'app.referral.source': {
      sensitivity: 'public',
      description: 'How the user arrived (acquisition channel)',
    },
  },
},
```

**Step 3**: Use the new attribute in your handlers. TypeScript will autocomplete it.

```typescript
signal.attr('app.referral.source', 'organic')
```

**Step 4**: If the attribute is required, add it to the `required` array and update tests.

```typescript
schema: {
  version: '1.1.0',
  required: ['app.request.id', 'app.referral.source'] as const,
}
```

**Why**: The interface is the contract. Editing it is the *only* way to introduce a new attribute. Drift is impossible because anything not in the interface is a compile error.

---

## Pattern 7: Testing instrumentation

Use the test harness to verify your handler emits the right trace.

```typescript
import { describe, it, expect } from 'vitest'
import { createHonoTestApp } from '../helpers/setup'

describe('POST /checkout', () => {
  it('emits a canonical root span with required attributes', async () => {
    const { signal, harness, app } = createHonoTestApp({
      schema: {
        version: '1.0.0',
        required: ['app.request.id'] as const,
      },
    })

    app.post('/checkout', async (c) => {
      signal.attr('app.user.id', 'usr_123')
      signal.attr('app.customer.tier', 'enterprise')
      signal.attr('app.transaction.type', 'checkout')
      return c.json({ orderId: 'ord_456' })
    })

    await app.request('/checkout', { method: 'POST' })

    const root = harness.rootSpan()
    expect(root).toBeDefined()

    // Typed assertions — keys are constrained to the schema
    harness.assertAttr(root!, 'app.user.id', 'usr_123')
    harness.assertAttr(root!, 'app.customer.tier', 'enterprise')
    harness.assertAttr(root!, 'app.transaction.type', 'checkout')

    // Structural assertions
    harness.assertName(root!, 'POST /checkout')
    harness.assertStatus(root!, 'OK')

    // Required attributes from schema.required must all be present
    harness.assertRequired(root!)

    // Cleanup
    harness.reset()
  })
})
```

**Why**:
- The test catches drift. If a future refactor accidentally removes a `signal.attr` call, this test fails before the regression ships.
- The typed assertions catch typos at compile time. `harness.assertAttr(root!, 'app.bogus', 'x')` is a compile error.
- Required attributes are enforced via `harness.assertRequired()`, so you can't ship a handler that's missing them.

---

## Pattern 8: Testing error paths

```typescript
it('records exception when payment fails', async () => {
  const { signal, harness, app } = createHonoTestApp()

  app.post('/checkout', async (c) => {
    try {
      await signal.span('payment.process', async () => {
        throw new Error('Card declined')
      })
    } catch {
      signal.attr('app.error.code', 'CARD_DECLINED')
      return c.json({ error: 'declined' }, 402)
    }
    return c.json({ ok: true })
  })

  await app.request('/checkout', { method: 'POST' })

  // The child span should have the exception
  const payment = harness.findSpan('payment.process')
  expect(payment).toBeDefined()
  harness.assertStatus(payment!, 'ERROR')
  harness.assertException(payment!)

  // The root span should have the error code (signal.attr always targets root)
  const root = harness.rootSpan()
  harness.assertAttr(root!, 'app.error.code', 'CARD_DECLINED')

  harness.reset()
})
```

---

## Pattern 9: Defining and using metrics

Metrics are for things you want to track over time but don't belong on individual traces.

```typescript
import { signal } from './signal'

// Define instruments once at module level
export const meters = signal.meter({
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
  'app.connections.active': {
    type: 'gauge',
    unit: 'connections',
    description: 'Active database connections',
  },
})

// Use them anywhere — they're typed
meters['app.orders.completed'].add(1, { region: 'us-east' })

const start = Date.now()
await processPayment()
meters['app.payment.duration'].record(Date.now() - start)

meters['app.connections.active'].set(pool.activeCount)
```

**Why metrics instead of attributes**:
- Use a metric for something you'll aggregate over time at low cost (counters, histograms).
- Use a span attribute for something you'll filter individual records by (user ID, customer tier).
- Most application telemetry should be span attributes. Metrics are for infrastructure-style time series.

**Cardinality warning**: metric labels create separate time series per unique value. Keep label dimensions to under ~20 unique values each. Don't put `userId` in a metric label.

---

## Pattern 10: Forcing a trace to be exported (`signal.keep`)

For one-off debugging when sampling would otherwise drop the trace.

```typescript
app.post('/checkout', async (c) => {
  const userId = c.req.header('x-user-id')

  // Investigation: this user reported a bug, force-keep their traces
  if (userId === 'usr_problematic') {
    signal.keep()
  }

  // Or: keep on a query parameter for debug requests
  if (c.req.query('debug') === 'true') {
    signal.keep()
  }

  // Normal handler logic...
  signal.attr('app.user.id', userId!)
  return c.json({ ok: true })
})
```

**Why**: Sampling drops most traces in production to save cost. `signal.keep()` overrides the sampling decision for the current trace. The `app.debug = true` attribute is also visible in the exported trace, so you can later filter on it to find your debug sessions.

---

## Pattern 11: Reading attributes back

Sometimes downstream code needs to react to an attribute set earlier in the request.

```typescript
async function fetchPersonalizedContent() {
  const tier = signal.getAttr('app.customer.tier')

  if (tier === 'enterprise') {
    return fetchPremiumContent()
  }
  return fetchStandardContent()
}
```

**Why**:
- `signal.getAttr()` reads from the parallel attributes Map maintained by canon-signal.
- The return type is properly narrowed: `getAttr('app.customer.tier')` returns `'free' | 'pro' | 'enterprise' | undefined`.
- Throws if called outside a request scope, like `signal.attr()`.

**Caveat**: don't use telemetry as application state. If business logic depends on a value, pass it through normal application channels (function arguments, request context). `getAttr` is for cases where the attribute *is* the source of truth (e.g. instrumentation libraries that need to read what was already set).

---

## Pattern 12: Including trace ID in error responses

When an error reaches the client, include the trace ID so support can find the trace.

```typescript
app.onError((err, c) => {
  const traceId = signal.traceId()  // Returns undefined if not in scope

  return c.json(
    {
      error: 'Internal server error',
      ...(traceId && { traceId }),  // Only include if we have one
    },
    500,
  )
})
```

**Why**:
- `signal.traceId()` is safe to call anywhere — it returns `undefined` outside a scope rather than throwing.
- Surfacing the trace ID in error responses lets support staff jump directly to the trace in your backend instead of searching by user/timestamp.

---

## Pattern 13: Adding default attributes via middleware

If you have attributes that should be set on every root span (deployment SHA, region, etc.), pass them via `defaultAttributes` instead of calling `signal.attr` in every handler.

```typescript
app.use('*', signal.middleware({
  defaultAttributes: {
    'app.deploy.sha': process.env.GIT_SHA ?? 'unknown',
    'app.deploy.id': process.env.DEPLOY_ID ?? 'unknown',
    'app.region': process.env.AWS_REGION ?? 'local',
  },
}))
```

**Why**: These values don't change per-request. Setting them in middleware once means handlers don't have to remember to set them. They're typed against your interface — `'app.bogus': 'value'` is a compile error.

---

## Pattern 14: Sampling configuration for production

Default config for a production service that wants to keep all errors and slow requests but sample everything else.

```typescript
sampling: {
  alwaysKeep: {
    errors: true,                              // every ERROR span
    slowerThanMs: 2000,                         // anything > 2s
    routes: ['/checkout', '/auth/login'],      // critical business paths
    attributes: {
      'app.customer.tier': ['enterprise'],     // VIP customers
    },
  },
  defaultRate: 0.1,                             // 10% of everything else
}
```

**Why**:
- You always want to see failures and slow requests — they're the highest-value traces.
- Critical business paths (`/checkout`) should be 100% retained even on success, because you'll want them for incident review.
- Enterprise customers get full retention because their traces matter most for debugging.
- Everything else samples at 10% to control cost.

---

## Pattern 15: Multiple exporters in parallel

You can configure multiple exporters per signal type. They all run simultaneously.

```typescript
export: {
  traces: [
    // OTLP to your production backend
    { type: 'otlp', endpoint: 'https://tempo.grafana.net/otlp' },

    // Pretty-printed waterfall to stdout for local dev
    { type: 'pretty-console' },

    // JSONL file for offline analysis
    { type: 'file', path: './traces.jsonl' },
  ],
  logs: [
    { type: 'otlp', endpoint: 'https://loki.grafana.net/otlp' },
  ],
}
```

**Why**: In development you want both remote export *and* terminal output. In CI you want file output for artifact upload. Multiple exporters cost almost nothing and unblock these workflows.

---

## Pattern 16: Bridging an existing logger

If your project already uses Pino or Winston, the bridge converts their output into OTel LogRecords with auto-attached trace context.

```typescript
import pino from 'pino'
import { signal } from './signal'
import { createPinoTransport } from 'canon-signal/bridges/pino'

const logger = pino({}, createPinoTransport({
  loggerProvider: signal.loggerProvider,
}))

// Existing pino calls now flow through canon-signal's LoggerProvider
logger.info({ userId: 'usr_1' }, 'user authenticated')
```

**Why**:
- Migrating to `signal.log` directly is the recommended steady state, but bridges let you ship trace correlation today without rewriting every log call.
- Pass `loggerProvider: signal.loggerProvider` explicitly to bind the bridge to a specific signal instance — this matters for test isolation.
