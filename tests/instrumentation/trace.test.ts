import { describe, it, expect } from 'vitest'
import { createTestSignal } from '../helpers/setup'

describe('signal.trace()', () => {
  it('creates a new trace with its own root span', async () => {
    const { signal, harness } = createTestSignal()

    await signal.trace('job.process', async () => {
      signal.attr('app.job.id', 'job_123')
      signal.attr('app.job.type', 'email')
    })

    const root = harness.findSpan('job.process')
    expect(root).toBeDefined()
    expect(root!.attributes['app.job.id']).toBe('job_123')
    expect(root!.attributes['app.job.type']).toBe('email')
    expect(root!.attributes['app.schema.version']).toBe('1.0.0')

    harness.reset()
  })

  it('signal.attr() works inside trace scope', async () => {
    const { signal, harness } = createTestSignal()

    let tid: string | undefined
    await signal.trace('bg.task', async () => {
      tid = signal.traceId()
      signal.attr('app.job.id', 'bg_456')
    })

    expect(tid).toBeDefined()
    expect(tid).toMatch(/^[0-9a-f]{32}$/)

    const span = harness.findSpan('bg.task')
    expect(span).toBeDefined()
    expect(span!.attributes['app.job.id']).toBe('bg_456')

    harness.reset()
  })

  it('records exception and sets ERROR on throw', async () => {
    const { signal, harness } = createTestSignal()

    await expect(
      signal.trace('failing.job', async () => {
        throw new Error('job failed')
      }),
    ).rejects.toThrow('job failed')

    const span = harness.findSpan('failing.job')
    expect(span).toBeDefined()
    harness.assertStatus(span!, 'ERROR')
    harness.assertException(span!)

    harness.reset()
  })

  it('returns the callback result', async () => {
    const { signal } = createTestSignal()
    const result = await signal.trace('compute', async () => 99)
    expect(result).toBe(99)
  })
})

describe('signal.link()', () => {
  it('parses W3C traceparent string', () => {
    const { signal } = createTestSignal()
    const link = signal.link('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')
    expect(link.context.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(link.context.spanId).toBe('00f067aa0ba902b7')
  })

  it('accepts traceId/spanId object', () => {
    const { signal } = createTestSignal()
    const link = signal.link({ traceId: 'abc123', spanId: 'def456' })
    expect(link.context.traceId).toBe('abc123')
    expect(link.context.spanId).toBe('def456')
  })
})
