/**
 * @module canon-signal/factory/instrumentation
 *
 * Wires up `@opentelemetry/auto-instrumentations-node` against the
 * tracer/logger/meter providers created by the factory.
 *
 * The user-facing `instrumentation` config exposes five categories
 * (http, database, redis, grpc, messaging). Each category maps to one
 * or more concrete OTel instrumentation packages, which we toggle
 * via the per-instrumentation `enabled` flag.
 *
 * **Why categories instead of per-instrumentation toggles**: most users
 * don't care which specific Postgres or Redis library is in use; they
 * care about whether database operations and Redis operations are being
 * traced. Categories give them a coarse-grained dial without having to
 * know the OTel package names.
 *
 * Defaults: HTTP/database/redis are on; gRPC and messaging are off
 * (gRPC because most apps don't use it, messaging because the patterns
 * are noisier and benefit from explicit opt-in).
 */

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import type { TracerProvider } from '@opentelemetry/api'
import type { LoggerProvider } from '@opentelemetry/api-logs'
import type { MeterProvider } from '@opentelemetry/api'
import type { InstrumentationConfig } from '../types/config.js'

/**
 * Maps the user-facing five-category instrumentation config to the
 * per-instrumentation `enabled` flag map that
 * `@opentelemetry/auto-instrumentations-node` accepts.
 *
 * Categories not specified by the user fall back to canon-signal's
 * defaults: http/database/redis enabled, grpc/messaging disabled.
 */
function buildInstrumentationConfig(config: InstrumentationConfig) {
  const enabled = (flag: boolean | undefined, defaultValue = true) =>
    flag === undefined ? defaultValue : flag

  const httpEnabled = enabled(config.http)
  const dbEnabled = enabled(config.database)
  const redisEnabled = enabled(config.redis)
  const grpcEnabled = enabled(config.grpc, false)
  const messagingEnabled = enabled(config.messaging, false)

  return {
    // HTTP servers and clients
    '@opentelemetry/instrumentation-http': { enabled: httpEnabled },
    '@opentelemetry/instrumentation-undici': { enabled: httpEnabled },

    // Database instrumentations
    '@opentelemetry/instrumentation-pg': { enabled: dbEnabled },
    '@opentelemetry/instrumentation-mysql': { enabled: dbEnabled },
    '@opentelemetry/instrumentation-mysql2': { enabled: dbEnabled },
    '@opentelemetry/instrumentation-mongodb': { enabled: dbEnabled },
    '@opentelemetry/instrumentation-mongoose': { enabled: dbEnabled },
    '@opentelemetry/instrumentation-cassandra-driver': { enabled: dbEnabled },
    '@opentelemetry/instrumentation-tedious': { enabled: dbEnabled },

    // Redis
    '@opentelemetry/instrumentation-redis': { enabled: redisEnabled },
    '@opentelemetry/instrumentation-redis-4': { enabled: redisEnabled },
    '@opentelemetry/instrumentation-ioredis': { enabled: redisEnabled },

    // gRPC
    '@opentelemetry/instrumentation-grpc': { enabled: grpcEnabled },

    // Messaging
    '@opentelemetry/instrumentation-amqplib': { enabled: messagingEnabled },
    '@opentelemetry/instrumentation-kafkajs': { enabled: messagingEnabled },
    '@opentelemetry/instrumentation-aws-sdk': { enabled: messagingEnabled },
  } as Record<string, { enabled: boolean }>
}

/**
 * Registers all configured auto-instrumentations against the supplied
 * providers. Side effect: monkey-patches the targeted libraries (e.g.
 * `pg`, `redis`) when they're loaded.
 *
 * Returns a disable function that can be called to unregister the
 * instrumentations later (rarely needed in practice — instrumentations
 * normally live for the lifetime of the process).
 *
 * @param tracerProvider - The tracer provider for instrumentation-generated spans
 * @param loggerProvider - The logger provider for instrumentation-generated log records
 * @param meterProvider - The meter provider for instrumentation-generated metrics
 * @param config - User-supplied instrumentation toggles, or undefined for defaults
 * @returns A function that disables the registered instrumentations
 */
export function registerAutoInstrumentation(
  tracerProvider: TracerProvider,
  loggerProvider: LoggerProvider,
  meterProvider: MeterProvider,
  config: InstrumentationConfig | undefined,
): () => void {
  const instrumentationConfig = buildInstrumentationConfig(config ?? {})
  const instrumentations = getNodeAutoInstrumentations(instrumentationConfig)

  return registerInstrumentations({
    instrumentations,
    tracerProvider,
    loggerProvider,
    meterProvider,
  })
}
