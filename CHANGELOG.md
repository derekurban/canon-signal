# Changelog

All notable changes to canon-signal will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-04-09

### Fixed

- **Node.js 18 compatibility**: middleware no longer crashes with `ReferenceError: crypto is not defined` on Node 18 when generating a request ID. The Web Crypto API on `globalThis.crypto` was only unflagged in Node 19+; canon-signal now uses the explicit `node:crypto.randomUUID()` import which works on every supported Node version. This bug affected `signal.middleware()` whenever the inbound request lacked an `x-request-id` header, which is the common case.

### Notes

- v0.1.0 is **broken on Node 18** and is deprecated. Anyone running canon-signal on Node 18 must upgrade to v0.1.1 or later.

## [0.1.0] - 2026-04-09 [DEPRECATED]

> ⚠️ **Deprecated**: This version crashes on Node.js 18 due to a missing `crypto` global. Use v0.1.1 or later.

### Added

- Initial release of canon-signal — opinionated OpenTelemetry toolkit for Node.js/TypeScript
- `createSignal<T>()` factory with closure-based state, fully typed against the user's `AppAttributes` interface
- Full `signal.*` API: `attr`, `attrs`, `getAttr`, `traceId`, `span`, `trace`, `link`, `event`, `error`, `keep`, `log`, `systemLog`, `meter`, `schema`, `shutdown`
- Framework middleware for Hono, Express, Fastify, and Next.js
- Auto-instrumentation via `@opentelemetry/auto-instrumentations-node` (37 instrumentations)
- Custom tail-sampling SpanProcessor with deterministic hashing
- DB summary SpanProcessor that auto-computes `app.db.total_duration_ms` and `app.db.query_count`
- Pretty-console exporter for dev waterfall rendering
- File, console, OTLP, and ring-buffer exporters
- Logger bridges for Pino and Winston
- Test harness with typed assertions
- CLI: `create`, `install-docs`, `tutorial`, `inspect`, `report-issue`
- Single-file HTML tutorial at `resources/tutorial/canon-signal-tutorial.html`
- Agent documentation suite at `resources/` (CONSTITUTION, PLAYBOOK, API, PATTERNS, ANTI_PATTERNS, TROUBLESHOOTING)
- Telemetry constitution documenting trace-first observability principles
- Environment variable overrides: `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `CANON_SIGNAL_SAMPLE_RATE`, `CANON_SIGNAL_DEBUG`
- Discriminated union for `ExporterConfig` so the type system enforces required fields per exporter kind
- 68 unit tests covering the full public API

[Unreleased]: https://github.com/derekurban/canon-signal/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/derekurban/canon-signal/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/derekurban/canon-signal/releases/tag/v0.1.0
