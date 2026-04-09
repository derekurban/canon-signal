/**
 * @module canon-signal/factory/create
 *
 * The heart of canon-signal: `createSignal<T>()`.
 *
 * This is the only function that wires the entire system together. It
 * runs schema validation, normalizes options, creates the AsyncLocalStorage
 * store, builds the OTel providers (tracer, logger, meter), wires the
 * configured exporters with the DB summary processor and tail-sampling
 * processor, registers auto-instrumentation, and returns a fully-typed
 * `Signal<T>` object.
 *
 * Every method on the returned signal is a closure over the captured
 * state — there are no module-level singletons, so multiple `createSignal()`
 * calls produce independent signal instances. This is essential for
 * test isolation.
 *
 * The provider creation order matters:
 * 1. Tracer provider with DB summary processor first, then tail sampling
 *    + exporters
 * 2. Logger provider, registered globally so bridges (Pino, Winston) and
 *    auto-instrumentation forwarders flow through it
 * 3. Meter provider, registered globally for the same reason
 * 4. Auto-instrumentation registered against all three providers
 */

import { Resource } from '@opentelemetry/resources'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'
import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { logs } from '@opentelemetry/api-logs'
import { metrics } from '@opentelemetry/api'
import { MeterProvider } from '@opentelemetry/sdk-metrics'

/**
 * The `deployment.environment.name` semantic convention attribute key.
 * Hard-coded as a string because some `@opentelemetry/semantic-conventions`
 * versions don't export this constant.
 */
const ATTR_DEPLOYMENT_ENVIRONMENT = 'deployment.environment.name'

import type { SignalAttributes } from '../types/attributes.js'
import type { CreateSignalOptions } from '../types/config.js'
import type { Signal, TestHarness } from '../types/signal.js'

import { createStore } from '../context/store.js'
import { normalizeConfig } from './config.js'
import { validateSchema } from './validate.js'
import { createShutdownFn } from './shutdown.js'
import { resolveExporters } from '../export/resolve.js'
import { registerAutoInstrumentation } from './instrumentation.js'

import { createAttrInstrumentation } from '../instrumentation/attr.js'
import { createKeepFn } from '../instrumentation/keep.js'
import { createSpanFn } from '../instrumentation/span.js'
import { createErrorFn } from '../instrumentation/error.js'
import { createEventFn } from '../instrumentation/event.js'
import { createTraceFn } from '../instrumentation/trace.js'
import { parseTraceparent } from '../instrumentation/link.js'
import { createMiddlewareFn } from '../middleware/loader.js'
import { createTestHarness } from '../testing/harness.js'
import { createContextAwareLogger, createSystemLogger } from '../logging/logger.js'
import { TailSamplingProcessor } from '../sampling/processor.js'
import { DbSummaryProcessor } from '../sampling/db-summary.js'
import { createMeterFn } from '../metrics/meter.js'

/**
 * Creates and initializes a fully-typed signal instance.
 *
 * Call this once at application startup, typically in a dedicated
 * `src/signal.ts` file that exports the result. Other modules import
 * the exported `signal` from there.
 *
 * @param options - Service identity, schema, sampling, exporters, instrumentation toggles, SDK limits.
 * @returns A `Signal<T>` instance whose methods are closed over the captured OTel providers and AsyncLocalStorage store.
 *
 * @throws {Error} If any attribute in `schema.meta` has `sensitivity: 'prohibited'`.
 *
 * @example
 * ```ts
 * interface AppAttributes extends SignalAttributes {
 *   'app.user.id'?: string
 * }
 *
 * export const signal = createSignal<AppAttributes>({
 *   service: { name: 'my-app', version: '1.0.0', environment: 'production' },
 *   schema: { version: '1.0.0' },
 * })
 * ```
 */
export function createSignal<T extends SignalAttributes>(
  options: CreateSignalOptions<T>,
): Signal<T> {
  // Validate the schema before doing anything else — fail fast on
  // prohibited sensitivity rather than after expensive provider setup.
  validateSchema(options.schema)

  // Normalize options (apply env var overrides: OTEL_SERVICE_NAME,
  // OTEL_EXPORTER_OTLP_*, CANON_SIGNAL_SAMPLE_RATE, CANON_SIGNAL_DEBUG).
  const config = normalizeConfig(options)
  const effectiveOptions = config.options

  // Create the AsyncLocalStorage store for this signal instance.
  // Per-instance, not global — each createSignal() call gets its own.
  const store = createStore()

  // Build the OTel resource. Starts with service identity attributes,
  // adds the optional team identifier, and merges in any extras parsed
  // from OTEL_RESOURCE_ATTRIBUTES.
  const resourceAttrs: Record<string, any> = {
    [ATTR_SERVICE_NAME]: config.service.name,
    [ATTR_SERVICE_VERSION]: config.service.version,
    [ATTR_DEPLOYMENT_ENVIRONMENT]: config.service.environment,
    ...config.extraResourceAttributes,
  }
  if (config.service.team) {
    resourceAttrs['app.service.team'] = config.service.team
  }
  const resource = new Resource(resourceAttrs)

  // Resolve the configured exporters into concrete instances. Always
  // includes in-memory exporters at the front so the test harness has
  // something to read from.
  const { spanExporters, logExporters, inMemorySpanExporter, inMemoryLogExporter } =
    resolveExporters(effectiveOptions.export)

  // ─── Tracer provider setup ───────────────────────────────────────

  // Apply SDK limits from user config (or OTel defaults).
  const spanLimits: Record<string, number> = {}
  if (effectiveOptions.limits?.maxAttributesPerSpan !== undefined) {
    spanLimits.attributeCountLimit = effectiveOptions.limits.maxAttributesPerSpan
  }
  if (effectiveOptions.limits?.maxAttributeValueLength !== undefined) {
    spanLimits.attributeValueLengthLimit = effectiveOptions.limits.maxAttributeValueLength
  }

  const tracerProvider = new NodeTracerProvider({
    resource,
    spanLimits: Object.keys(spanLimits).length > 0 ? spanLimits : undefined,
  })

  // The DB summary processor must run BEFORE export processors so it
  // can write app.db.* attributes onto the root span before they're
  // serialized to the wire.
  tracerProvider.addSpanProcessor(new DbSummaryProcessor())

  // For each configured exporter, attach a SimpleSpanProcessor (synchronous
  // for test predictability). If sampling is configured, wrap each one
  // in a TailSamplingProcessor.
  for (const exporter of spanExporters) {
    const processor = new SimpleSpanProcessor(exporter)
    if (effectiveOptions.sampling) {
      tracerProvider.addSpanProcessor(
        new TailSamplingProcessor<T>(processor, effectiveOptions.sampling),
      )
    } else {
      tracerProvider.addSpanProcessor(processor)
    }
  }
  tracerProvider.register()

  const tracer = tracerProvider.getTracer('canon-signal', options.schema.version)

  // ─── Logger provider setup ───────────────────────────────────────

  const loggerProvider = new LoggerProvider({ resource })
  for (const exporter of logExporters) {
    loggerProvider.addLogRecordProcessor(new SimpleLogRecordProcessor(exporter))
  }
  // Register globally so bridges (pino, winston) and auto-instrumentation
  // log forwarders use the same provider as signal.log / signal.systemLog.
  // Note: OTel's setGlobalLoggerProvider is no-op after the first call,
  // so the test harness uses signal.loggerProvider explicitly to bind
  // bridges to specific signal instances.
  logs.setGlobalLoggerProvider(loggerProvider)
  const otelLogger = loggerProvider.getLogger('canon-signal')

  // ─── Meter provider setup ────────────────────────────────────────

  const meterProvider = new MeterProvider({ resource })
  // Register globally so auto-instrumentation metrics flow through
  // the same provider as signal.meter() instruments.
  metrics.setGlobalMeterProvider(meterProvider)

  // ─── Auto-instrumentation ────────────────────────────────────────

  // Register all configured auto-instrumentations against the providers
  // we just built. Side effect: monkey-patches required modules.
  registerAutoInstrumentation(
    tracerProvider,
    loggerProvider,
    meterProvider,
    effectiveOptions.instrumentation,
  )

  // ─── Build the signal instance ───────────────────────────────────

  // Every method below is a closure over the captured providers, store,
  // and config. The returned object is the public API.
  const signal: Signal<T> = {
    shutdown: createShutdownFn({ tracerProvider, loggerProvider, meterProvider }),

    middleware: createMiddlewareFn<T>(store, tracer, config.schemaVersion),

    // Spreads attr, attrs, getAttr, traceId from the consolidated builder.
    ...createAttrInstrumentation<T>(store),

    span: createSpanFn(store, tracer),
    trace: createTraceFn(store, tracer, config.schemaVersion),
    link: parseTraceparent,

    event: createEventFn(store),
    error: createErrorFn(store),

    keep: createKeepFn(store),

    log: createContextAwareLogger(store, otelLogger),
    systemLog: createSystemLogger(otelLogger),
    loggerProvider,

    meter: createMeterFn(meterProvider),

    schema: () => ({
      version: config.schemaVersion,
      meta: options.schema.meta,
    }),

    test: {
      harness(): TestHarness<T> {
        return createTestHarness<T>(inMemorySpanExporter, options.schema.required, inMemoryLogExporter)
      },
    },
  }

  return signal
}
