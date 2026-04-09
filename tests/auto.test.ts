import { describe, it, expect } from 'vitest'

// The auto entry point loads @opentelemetry/auto-instrumentations-node which
// pulls in 37 instrumentation packages. Cold-start on slower machines can
// exceed the default 5s vitest timeout, so we give this test more headroom.
const AUTO_TEST_TIMEOUT = 30_000

describe('canon-signal/auto', () => {
  it(
    'exports a signal instance',
    async () => {
      const { signal } = await import('../src/auto')

      expect(signal).toBeDefined()
      expect(signal.attr).toBeTypeOf('function')
      expect(signal.middleware).toBeTypeOf('function')
      expect(signal.shutdown).toBeTypeOf('function')
      expect(signal.log).toBeDefined()
    },
    AUTO_TEST_TIMEOUT,
  )

  it(
    'schema version is 0.0.0 (auto default)',
    async () => {
      const { signal } = await import('../src/auto')
      const schema = signal.schema()
      expect(schema.version).toBe('0.0.0')
    },
    AUTO_TEST_TIMEOUT,
  )
})
