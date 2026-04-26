/**
 * @module tests/helpers/setup
 *
 * Shared test setup helpers. Eliminates the `createSignal` +
 * `signal.test.harness()` + (for HTTP tests) `app.use(middleware)`
 * boilerplate that used to appear in every test file.
 *
 * Two flavors:
 * - `createTestSignal()` for tests that only need the signal and harness
 * - `createHonoTestApp()` for tests that need a full Hono app with middleware
 *
 * Both accept optional overrides so individual tests can customize
 * the schema, sampling, or service config when needed.
 */

import Fastify, { type FastifyInstance } from 'fastify'
import { Hono } from 'hono'
import { createSignal } from '../../src/factory/create.js'
import type { SignalAttributes } from '../../src/types/attributes.js'
import type {
  CreateSignalOptions,
  SchemaConfig,
  SamplingConfig,
} from '../../src/types/config.js'
import type { Signal, TestHarness } from '../../src/types/signal.js'
import type { TestAttrs } from './attrs.js'

/** Default service config used by every test. */
const DEFAULT_SERVICE = {
  name: 'test-service',
  version: '1.0.0',
  environment: 'test',
}

/** Options accepted by `createTestSignal`. Everything is optional. */
export interface TestSignalOptions<T extends SignalAttributes> {
  schema?: Partial<SchemaConfig<T>>
  sampling?: SamplingConfig<T>
  service?: Partial<CreateSignalOptions<T>['service']>
}

/**
 * Creates a signal instance and its associated harness. Applies sensible
 * defaults (schema version 1.0.0, test service config) that can be
 * overridden per-test.
 *
 * @returns Both the signal and harness so tests can destructure what they need.
 */
export function createTestSignal<T extends SignalAttributes = TestAttrs>(
  options: TestSignalOptions<T> = {},
): { signal: Signal<T>; harness: TestHarness<T> } {
  const signal = createSignal<T>({
    service: { ...DEFAULT_SERVICE, ...options.service },
    schema: { version: '1.0.0', ...options.schema } as SchemaConfig<T>,
    sampling: options.sampling,
  })
  const harness = signal.test.harness()
  return { signal, harness }
}

/**
 * Creates a signal, a harness, and a Hono app with the middleware
 * already registered. The most common pattern for HTTP-centric tests.
 *
 * @returns Signal, harness, and a ready-to-use Hono app.
 */
export function createHonoTestApp<T extends SignalAttributes = TestAttrs>(
  options: TestSignalOptions<T> = {},
): { signal: Signal<T>; harness: TestHarness<T>; app: Hono } {
  const { signal, harness } = createTestSignal<T>(options)
  const app = new Hono()
  app.use('*', signal.middleware({ framework: 'hono' }))
  return { signal, harness, app }
}

/**
 * Creates a signal, a harness, and a Fastify app with the middleware
 * already registered. The Fastify equivalent of {@link createHonoTestApp}.
 *
 * Returns an `async` setup because `app.register(...)` is async — call
 * sites should `await` this helper.
 */
export async function createFastifyTestApp<
  T extends SignalAttributes = TestAttrs,
>(
  options: TestSignalOptions<T> = {},
): Promise<{
  signal: Signal<T>
  harness: TestHarness<T>
  app: FastifyInstance
}> {
  const { signal, harness } = createTestSignal<T>(options)
  const app = Fastify({ logger: false })
  await app.register(signal.middleware({ framework: 'fastify' }))
  return { signal, harness, app }
}
