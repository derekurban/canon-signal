import { describe, it, expect } from 'vitest'
import { createTestSignal } from '../helpers/setup'

describe('signal.meter()', () => {
  it('creates counter, gauge, and histogram instruments', () => {
    const { signal } = createTestSignal()

    const meters = signal.meter({
      'app.orders.completed': {
        type: 'counter',
        unit: 'orders',
        description: 'Total completed orders',
      },
      'app.connections.active': {
        type: 'gauge',
        unit: 'connections',
        description: 'Active connections',
      },
      'app.payment.duration': {
        type: 'histogram',
        unit: 'ms',
        description: 'Payment duration',
        buckets: [10, 50, 100, 250, 500, 1000],
      },
    })

    expect(meters['app.orders.completed']).toBeDefined()
    expect(meters['app.orders.completed'].add).toBeTypeOf('function')

    expect(meters['app.connections.active']).toBeDefined()
    expect(meters['app.connections.active'].set).toBeTypeOf('function')

    expect(meters['app.payment.duration']).toBeDefined()
    expect(meters['app.payment.duration'].record).toBeTypeOf('function')
  })

  it('counter.add() does not throw', () => {
    const { signal } = createTestSignal()

    const meters = signal.meter({
      'app.requests': { type: 'counter', unit: 'requests', description: 'Total requests' },
    })

    expect(() => meters['app.requests'].add(1)).not.toThrow()
    expect(() => meters['app.requests'].add(5, { region: 'us-east' })).not.toThrow()
  })

  it('histogram.record() does not throw', () => {
    const { signal } = createTestSignal()

    const meters = signal.meter({
      'app.latency': { type: 'histogram', unit: 'ms', description: 'Latency' },
    })

    expect(() => meters['app.latency'].record(42)).not.toThrow()
    expect(() => meters['app.latency'].record(150, { endpoint: '/api' })).not.toThrow()
  })
})
