import { logs } from '@opentelemetry/api-logs'
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { Resource } from '@opentelemetry/resources'
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'
import type { SignalAttributes } from '../types/attributes.js'
import type { TestHarness } from '../types/signal.js'
import type { WorkerCreateSignalOptions, WorkerSignal } from '../types/worker.js'
import { createStore } from '../context/store.js'
import { createAttrInstrumentation } from '../instrumentation/attr.js'
import { createErrorFn } from '../instrumentation/error.js'
import { createEventFn } from '../instrumentation/event.js'
import { createKeepFn } from '../instrumentation/keep.js'
import { parseTraceparent } from '../instrumentation/link.js'
import { createSpanFn } from '../instrumentation/span.js'
import { createTraceFn } from '../instrumentation/trace.js'
import { createContextAwareLogger, createSystemLogger } from '../logging/logger.js'
import { TailSamplingProcessor } from '../sampling/processor.js'
import { DbSummaryProcessor } from '../sampling/db-summary.js'
import { createShutdownFn } from '../factory/shutdown.js'
import { validateSchema } from '../factory/validate.js'
import { createTestHarness } from '../testing/harness.js'
import { normalizeWorkerConfig } from './config.js'
import { resolveWorkerExporters } from './exporters.js'
import { createWorkerMiddlewareFn } from './middleware.js'

const ATTR_DEPLOYMENT_ENVIRONMENT = 'deployment.environment.name'

function generateRequestId(): string {
  const randomUUID = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID
  if (randomUUID) return randomUUID.call(globalThis.crypto)
  return `req_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`
}

export function createWorkerSignal<T extends SignalAttributes>(
  options: WorkerCreateSignalOptions<T>,
): WorkerSignal<T> {
  validateSchema(options.schema)

  const config = normalizeWorkerConfig(options)
  const effectiveOptions = config.options
  const store = createStore()

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
  const {
    spanExporters,
    logExporters,
    inMemorySpanExporter,
    inMemoryLogExporter,
  } = resolveWorkerExporters(effectiveOptions.export)

  const spanLimits: Record<string, number> = {}
  if (effectiveOptions.limits?.maxAttributesPerSpan !== undefined) {
    spanLimits.attributeCountLimit = effectiveOptions.limits.maxAttributesPerSpan
  }
  if (effectiveOptions.limits?.maxAttributeValueLength !== undefined) {
    spanLimits.attributeValueLengthLimit = effectiveOptions.limits.maxAttributeValueLength
  }

  const tracerProvider = new BasicTracerProvider({
    resource,
    spanLimits: Object.keys(spanLimits).length > 0 ? spanLimits : undefined,
  })

  tracerProvider.addSpanProcessor(new DbSummaryProcessor())
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

  const loggerProvider = new LoggerProvider({ resource })
  for (const exporter of logExporters) {
    loggerProvider.addLogRecordProcessor(new SimpleLogRecordProcessor(exporter))
  }
  logs.setGlobalLoggerProvider(loggerProvider)
  const otelLogger = loggerProvider.getLogger('canon-signal')

  const flush = async () => {
    await Promise.all([tracerProvider.forceFlush(), loggerProvider.forceFlush()])
  }

  const signal: WorkerSignal<T> = {
    shutdown: createShutdownFn({ tracerProvider, loggerProvider }),
    flush,

    middleware: createWorkerMiddlewareFn<T>(
      store,
      tracer,
      config.schemaVersion,
      generateRequestId,
      flush,
    ),

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
