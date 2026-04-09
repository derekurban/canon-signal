# canon-signal — Agent Documentation

You are reading this because you are an AI agent working in a TypeScript project that uses `canon-signal`. This directory contains everything you need to write code that follows canon-signal's principles, debug issues, and avoid common mistakes.

## Where to start

Read these in order on your first pass:

1. **[`CONSTITUTION.md`](./CONSTITUTION.md)** — The philosophy. Why traces are the backbone of observability, what makes a canonical event, when to use each signal type. This is the *worldview*. Everything else flows from it.

2. **[`PLAYBOOK.md`](./PLAYBOOK.md)** — The rules. Explicit do's and don'ts for working with canon-signal. Read this before writing instrumentation code.

3. **[`API.md`](./API.md)** — Function-by-function reference for every public `signal.*` method. Use this when you need to look up a signature or behavior.

4. **[`PATTERNS.md`](./PATTERNS.md)** — Complete code examples for common scenarios. HTTP handlers, background jobs, error handling, testing, schema evolution.

5. **[`ANTI_PATTERNS.md`](./ANTI_PATTERNS.md)** — Things that look right but violate canon-signal's principles. Read this so you can recognize and avoid them.

6. **[`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)** — Common errors and their fixes. Reference when something goes wrong.

## How to use these docs

**When writing new instrumentation code**: Check `PATTERNS.md` for the right shape, then `PLAYBOOK.md` for the rules, then `API.md` for the exact signatures.

**When debugging**: Start with `TROUBLESHOOTING.md`. If your error isn't there, fall back to `PLAYBOOK.md` to check whether you're violating an invariant.

**When reviewing or refactoring code**: `ANTI_PATTERNS.md` is your checklist. Anything in there should be flagged.

**When making architectural decisions**: `CONSTITUTION.md` is the source of truth. If you're proposing a change that contradicts it, the change needs explicit human approval.

## Core principles in one paragraph

canon-signal treats traces as the primary signal. The root span of every request is the canonical event — a wide, structured record carrying every dimension you might want to query during debugging. Attributes are declared in a TypeScript interface and the compiler enforces that nothing outside the interface can be set. Context propagates ambiently via `AsyncLocalStorage` so you never pass loggers or trace objects through function signatures. Logs and metrics are explicitly secondary signals with narrow, well-defined uses. The schema is the contract; the type system enforces it; the test harness verifies it.

If that paragraph doesn't yet make sense, read `CONSTITUTION.md` first.

## Project context

The project you're working in has canon-signal installed and is using it for observability. You should expect to find:

- A `src/signal.ts` file (or similar) that calls `createSignal<AppAttributes>({...})` and exports a `signal` instance
- Middleware registered on the application's HTTP framework (Hono, Express, Fastify, or Next.js)
- An `AppAttributes` interface extending `SignalAttributes` that defines every attribute the service emits
- Tests using the `signal.test.harness()` to verify instrumentation

Your job when writing code in this project:

- **Never bypass the schema.** If you need a new attribute, add it to `AppAttributes` first, then use it.
- **Never use `console.log` in request handlers.** Use `signal.attr()`, `signal.event()`, or `signal.log` depending on the shape of the data (see `PLAYBOOK.md`).
- **Always run tests after instrumentation changes.** The test harness catches drift.
- **Keep span names low-cardinality.** `payment.process` is valid; `payment.process.${userId}` is not.

The full set of rules is in `PLAYBOOK.md`. Read it.
