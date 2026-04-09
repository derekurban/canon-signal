# canon-signal Troubleshooting

Common errors and their fixes. Search for the error message you're seeing.

---

## Runtime errors

### `canon-signal: Called outside a request scope. Wrap your code in signal.middleware() or signal.trace().`

**What it means**: You called `signal.attr`, `signal.attrs`, `signal.getAttr`, `signal.span`, `signal.event`, `signal.error`, or `signal.keep` from a code path that isn't inside a request scope.

**Where it happens**:
- Module-level code (running at import time, before any request)
- Setup/teardown code
- Background jobs that aren't wrapped in `signal.trace()`
- HTTP handlers when middleware isn't registered
- Code running after the request has already finished

**Fixes**:

1. **For HTTP handlers**: Make sure `signal.middleware()` is registered *before* any route handlers.

   ```typescript
   const app = new Hono()
   app.use('*', signal.middleware())  // ← FIRST
   app.get('/users/:id', handler)     // ← THEN routes
   ```

2. **For background jobs**: Wrap the work in `signal.trace()`.

   ```typescript
   async function processJob(job: Job) {
     await signal.trace('job.process', async () => {
       signal.attr('app.job.id', job.id)  // ← now works
       await doWork(job)
     })
   }
   ```

3. **For code that runs in both contexts**: Use `signal.traceId()` first to check if you're in a scope. It returns `undefined` outside a scope rather than throwing.

   ```typescript
   if (signal.traceId()) {
     signal.attr('app.user.id', userId)
   }
   ```

   Or use `signal.log` instead — it gracefully degrades when outside a scope.

---

### `canon-signal: Attribute "X" has sensitivity "prohibited" and cannot be used.`

**What it means**: Your `createSignal()` config has an attribute marked with `sensitivity: 'prohibited'` in `schema.meta`. Prohibited attributes are not allowed — they exist in the type system to express "this kind of data should never appear in telemetry."

**Fix**: Remove the attribute from your schema entirely. If you need to record the data for non-telemetry purposes, use a different system (audit log, secure store) — telemetry is the wrong place.

```typescript
// ❌ Will throw at startup
schema: {
  version: '1.0.0',
  meta: {
    'app.user.password': { sensitivity: 'prohibited' },
  },
}

// ✅ Just don't include it
schema: {
  version: '1.0.0',
}
```

---

### `canon-signal: Invalid traceparent format: <string>`

**What it means**: You called `signal.link(traceparent)` with a string that doesn't match the W3C traceparent format (`<version>-<traceId>-<spanId>-<flags>`). The string had fewer than 4 dash-separated parts.

**Fix**: Make sure the string is a valid W3C traceparent. If you're reading it from a header, check that the header exists first:

```typescript
// ❌ Throws if the header is missing
const link = signal.link(message.headers.traceparent)

// ✅ Guard against missing header
if (message.headers.traceparent) {
  const link = signal.link(message.headers.traceparent)
}

// ✅ Or use the explicit object form
const link = signal.link({ traceId: 'abc', spanId: 'def' })
```

---

### `canon-signal: Framework "X" is not supported.`

**What it means**: You passed `framework: 'X'` to `signal.middleware()` and `'X'` isn't one of the supported values.

**Fix**: Use one of `'hono'`, `'express'`, `'fastify'`, or `'next'`. If you don't pass a framework, the default is `'hono'`.

---

### `canon-signal: file exporter requires a "path" option`

**What it means**: This error shouldn't appear in normal use — `ExporterConfig` is a discriminated union that requires `path` for `{ type: 'file' }`. If you're seeing this, you're constructing an `ExporterConfig` object dynamically and bypassing TypeScript's type checking.

**Fix**: Construct exporter configs as object literals so TypeScript catches missing fields:

```typescript
// ✅ TypeScript catches missing path at compile time
export: {
  traces: [{ type: 'file', path: './traces.jsonl' }],
}
```

---

## Compile-time errors

### `Argument of type '"app.X"' is not assignable to parameter of type ...`

**What it means**: You're calling `signal.attr('app.X', value)` but `'app.X'` is not declared in your `AppAttributes` interface.

**Fix**: Add the attribute to your interface in `src/signal.ts` (or wherever your schema is defined):

```typescript
interface AppAttributes extends SignalAttributes {
  'app.X'?: string  // ← add it here
  // ... existing attributes
}
```

If you already added it, make sure you bumped the schema version and re-imported.

---

### `Type '<value>' is not assignable to type '<expected>'`

**What it means**: You called `signal.attr(key, value)` with a value that doesn't match the type declared for that key in your interface.

**Example**:

```typescript
interface AppAttributes extends SignalAttributes {
  'app.customer.tier'?: 'free' | 'pro' | 'enterprise'
}

signal.attr('app.customer.tier', 'platinum')
// ❌ Type '"platinum"' is not assignable to type '"free" | "pro" | "enterprise"'
```

**Fix**: Either fix the value to match the declared type, or update the interface to include the new value.

```typescript
// Option 1: fix the value
signal.attr('app.customer.tier', 'enterprise')

// Option 2: extend the union
interface AppAttributes extends SignalAttributes {
  'app.customer.tier'?: 'free' | 'pro' | 'enterprise' | 'platinum'
}
```

---

### `Property 'X' does not exist on type 'Signal<T>'`

**What it means**: You're trying to call a method on the signal instance that doesn't exist. Most likely a typo or you're trying to use a method from a different version of canon-signal.

**Fix**: Check the API reference (`API.md`) for the actual method names. Common confusions:
- It's `signal.attr` (singular), not `signal.attribute`
- It's `signal.span` (verb), not `signal.startSpan`
- It's `signal.trace` (creates a new trace), not `signal.startTrace`

---

## Test failures

### Test harness has spans from a previous test

**Symptom**: Your test asserts `harness.allSpans().length === 1` but gets a higher number.

**Cause**: A previous test didn't call `harness.reset()`, and the spans accumulated.

**Fix**: Call `harness.reset()` at the end of every test, or use a global `afterEach`:

```typescript
afterEach(() => harness.reset())
```

---

### `harness.rootSpan()` returns `undefined` after a request

**Symptom**: You made a request via `app.request()`, but `harness.rootSpan()` returns nothing.

**Possible causes**:

1. **Middleware isn't registered**. Check that `app.use('*', signal.middleware())` is called before route registration.

2. **The request didn't complete**. `app.request()` is async — make sure you're awaiting it.

   ```typescript
   await app.request('/test')  // ← await
   ```

3. **The request errored before reaching the handler**. If the route doesn't exist, the handler never runs and no span is created.

4. **You're checking the harness from a different signal instance**. Each `createSignal()` call creates its own in-memory exporter. The harness is bound to one instance.

---

### `harness.assertAttr()` complains about attribute key

**Symptom**: TypeScript complains that the key argument doesn't match the schema.

**Example**:

```typescript
harness.assertAttr(root!, 'app.bogus', 'value')
// ❌ Argument of type '"app.bogus"' is not assignable to ...
```

**Fix**: This is the harness enforcing type safety. Either fix the key to match a real attribute in your interface, or add the attribute to your interface. The harness is intentionally generic over your schema for exactly this reason.

---

### Test is slow or hangs

**Symptom**: A test takes 3+ seconds even though the code under test is fast.

**Cause**: You're using `canon-signal/auto`, which loads all 37 OTel auto-instrumentations at import time. The first import is slow (~3 seconds). Subsequent imports are cached.

**Fix**: For non-auto tests, use `createSignal()` directly with explicit config (or the test helpers) instead of importing from `canon-signal/auto`. The auto entry point is for evaluation, not test infrastructure.

---

## Trace data issues

### Spans show no `app.db.*` attributes even though the request used a database

**Cause**: The DB summary processor relies on `db.system` being set on child spans. If you're using a database client that isn't covered by `@opentelemetry/auto-instrumentations-node`, those spans won't have `db.system` and won't be counted.

**Supported clients (auto-instrumented)**:
- pg, mysql, mysql2, mongodb, mongoose, cassandra-driver, tedious

**Fix**: If you're using an unsupported client, manually set `db.system` on the child span:

```typescript
await signal.span('db.query.users', async (span) => {
  span.setAttribute('db.system', 'sqlite')
  return mySqliteClient.query(...)
})
```

---

### Pretty-console exporter doesn't show all my child spans

**Symptom**: You see the root span and a couple children but not all of them.

**Cause**: The pretty-console exporter buffers spans by trace ID and renders the tree when the **root** span arrives. If a child span is finalized *after* the root span (rare but possible with async operations that outlive the request), it won't be in the rendered tree.

**Fix**: This is usually a sign that something is leaking past the request lifecycle. Make sure all `signal.span()` callbacks are awaited inside the handler, so they complete before the response is returned.

---

### Trace IDs in logs don't match the trace ID in my error response

**Cause**: You're calling `signal.traceId()` in two different async contexts. AsyncLocalStorage propagates within a chain, but if you've broken out of the chain (e.g. with `setImmediate` without preserving context), the IDs won't match.

**Fix**: Make sure you're capturing the trace ID once at the top of the handler:

```typescript
app.onError((err, c) => {
  const traceId = signal.traceId()
  signal.log.error('request failed', { error: err.message })
  return c.json({ traceId }, 500)
})
```

---

## Configuration issues

### `OTEL_EXPORTER_OTLP_ENDPOINT` env var doesn't override anything

**Cause**: The override only applies to OTLP exporters that didn't specify their own `endpoint`. If you hardcoded an endpoint in `createSignal()`, the env var doesn't override it (the explicit value wins).

**Fix**: Either remove the hardcoded endpoint from your config, or update the config to use the env var directly:

```typescript
export: {
  traces: [{
    type: 'otlp',
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'https://default.example.com',
  }],
}
```

---

### `CANON_SIGNAL_SAMPLE_RATE` doesn't change the sampling

**Cause**: One of two things:
1. The env var contains an unparseable string (anything `parseFloat()` returns `NaN` for is ignored).
2. `CANON_SIGNAL_DEBUG` is also set, which forces the rate to `1.0` regardless of `CANON_SIGNAL_SAMPLE_RATE`.

**Fix**: Make sure `CANON_SIGNAL_SAMPLE_RATE` is a valid number string (`"0.5"`, not `"50%"`) and `CANON_SIGNAL_DEBUG` is unset.

---

### Sampling drops every span (nothing in the harness or backend)

**Cause**: You configured `defaultRate: 0` and your spans aren't matching any `alwaysKeep` rule.

**Fix**: Either increase `defaultRate` or add an `alwaysKeep` rule that matches your test traffic. For development, just leave sampling unconfigured (defaults to keeping everything).

---

## Logger bridge issues

### Pino bridge logs don't show up in my test harness

**Cause**: You created the bridge without passing `loggerProvider: signal.loggerProvider`. The bridge falls back to the global LoggerProvider, which is set by the *first* `createSignal()` call. If your test created a new signal instance, the bridge is still writing to the *previous* instance's exporter.

**Fix**: Pass the loggerProvider explicitly:

```typescript
const transport = createPinoTransport({
  loggerProvider: signal.loggerProvider,  // ← bind to this instance
})
```

---

### Winston transport throws "Cannot find module 'winston-transport'"

**Cause**: `winston-transport` is an optional peer dependency and isn't installed.

**Fix**: Install it.

```bash
npm install winston winston-transport
```

The Winston bridge requires both `winston` and `winston-transport` because it extends the latter's `Transport` class.

---

## Build / packaging issues

### Build fails with `Cannot find module './testing/harness.js'`

**Cause**: You're importing from a path that exists in source but not in the built output. Most likely a relative import that crosses a tsup entry boundary.

**Fix**: Imports inside `src/` should use `.js` extensions even though the source is `.ts` (this is correct ESM behavior). If you're already doing that, check that the file you're importing is actually included in the tsup `entry` config.

---

### `npx canon-signal install-docs` says "no resources directory"

**Cause**: The published package doesn't include the `resources/` directory, so the CLI can't find it.

**Fix**: Make sure `package.json` includes `resources` in its `files` field:

```json
{
  "files": ["dist", "bin", "resources"]
}
```

If you're working in a local checkout, the CLI should still find `resources/` at the package root via `__dirname` traversal.

---

### `npx canon-signal report-issue` says "still contains a placeholder"

**Cause**: canon-signal's own `package.json` has `<OWNER>` in the `repository.url` field, meaning the package hasn't been configured with its real GitHub URL yet. This happens in development checkouts before the repo has been published.

**Fix**: This is a maintainer-side issue. The canon-signal `package.json` needs to be updated with the real GitHub owner/org name. End users running this command against a published version of canon-signal should never see this error.

---

### `npx canon-signal report-issue` doesn't open the browser

**Cause**: The CLI uses platform-specific shell commands to open the URL (`open` on macOS, `start` on Windows, `xdg-open` on Linux). On some headless environments (CI runners, Docker containers, WSL without a display server) the open command exists but does nothing useful.

**Fix**: The CLI prints the URL anyway as a fallback. Copy the URL from the terminal output and paste it into your browser manually. You can also run with `--print-only` to skip the browser-open attempt entirely:

```bash
npx canon-signal report-issue --print-only
```

---

## When all else fails

1. **Re-read `PLAYBOOK.md`**. 80% of "weird behavior" comes from violating one of the rules.
2. **Run the test suite** (`npm run test:run`). If our tests fail, it's a regression in canon-signal itself, not your code.
3. **Check the version** (`npm list canon-signal`). Make sure you're not on an outdated minor version.
4. **Look for related anti-patterns** in `ANTI_PATTERNS.md`. Sometimes the bug isn't an error but a violation of the principles.
5. **Read `CONSTITUTION.md`**. If your mental model of how canon-signal works doesn't match the constitution, the constitution is the source of truth.
