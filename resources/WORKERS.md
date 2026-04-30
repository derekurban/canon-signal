# Cloudflare Workers

Use `canon-signal/worker` in Cloudflare Worker-based environments. Do not import from `canon-signal` in a Worker bundle; the root entrypoint is for Node.js and loads Node OpenTelemetry SDKs.

## Requirements

- Enable Cloudflare `nodejs_als` or `nodejs_compat`.
- Use a compatibility date of `2024-09-23` or later.
- Use Hono middleware for HTTP request scopes.

Example `wrangler.toml`:

```toml
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_als"]
```

## Setup

```ts
import { Hono } from 'hono'
import { createWorkerSignal, type SignalAttributes, type WorkerSignal } from 'canon-signal/worker'

interface Env {
  NODE_ENV?: string
  OTEL_EXPORTER_OTLP_ENDPOINT?: string
  OTEL_EXPORTER_OTLP_HEADERS?: string
}

interface AppAttributes extends SignalAttributes {
  'app.user.id'?: string
}

let signal: WorkerSignal<AppAttributes> | undefined

function getSignal(env: Env) {
  signal ??= createWorkerSignal<AppAttributes>({
    env,
    service: {
      name: 'my-worker',
      version: '1.0.0',
      environment: env.NODE_ENV ?? 'production',
    },
    schema: { version: '1.0.0' },
    export: {
      traces: env.OTEL_EXPORTER_OTLP_ENDPOINT
        ? [{ type: 'otlp', endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT }]
        : [],
      logs: env.OTEL_EXPORTER_OTLP_ENDPOINT
        ? [{ type: 'otlp', endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT }]
        : [],
    },
  })
  return signal
}

const app = new Hono<{ Bindings: Env }>()
app.use('*', (c, next) => getSignal(c.env).middleware()(c, next))
```

The Worker middleware flushes trace and log exporters through `executionCtx.waitUntil()` when Hono exposes it. In tests or non-Worker runtimes it awaits the flush directly.

## Supported in Worker v1

- Hono request middleware
- `signal.attr()`, `signal.attrs()`, `signal.getAttr()`, and `signal.traceId()`
- `signal.span()`, `signal.trace()`, `signal.event()`, `signal.error()`, and `signal.keep()`
- `signal.log` and `signal.systemLog`
- OTLP trace and log export over `fetch`
- `console` and `pretty-console` trace/log exporters
- `signal.test.harness()`

## Node-only features

- `canon-signal` root import
- `canon-signal/auto`
- Express, Fastify, and Next middleware adapters
- Node auto-instrumentation
- File exporters
- Metrics via `signal.meter()`
- Pino and Winston bridges

Agents working in a Worker project should preserve the `canon-signal/worker` import and should not add Node-only exporters, bridges, or auto-instrumentation.
