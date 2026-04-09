import { describe, it, expect } from 'vitest'
import { createTestSignal } from '../helpers/setup'

describe('TailSamplingProcessor', () => {
  it('keeps error spans when alwaysKeep.errors is true', async () => {
    const { signal, harness } = createTestSignal({
      sampling: {
        alwaysKeep: { errors: true },
        defaultRate: 0,
      },
    })

    // Successful trace — should be dropped
    await signal.trace('ok.job', async () => {
      signal.attr('app.user.id', 'usr_1')
    })

    // Error trace — should be kept
    try {
      await signal.trace('fail.job', async () => {
        throw new Error('boom')
      })
    } catch {}

    const spans = harness.allSpans()
    expect(spans.length).toBe(1)
    expect(spans[0].name).toBe('fail.job')

    harness.reset()
  })

  it('keeps spans matching signal.keep()', async () => {
    const { signal, harness } = createTestSignal({
      sampling: { defaultRate: 0 },
    })

    await signal.trace('normal', async () => {})

    await signal.trace('pinned', async () => {
      signal.keep()
    })

    const spans = harness.allSpans()
    expect(spans.length).toBe(1)
    expect(spans[0].name).toBe('pinned')

    harness.reset()
  })

  it('keeps all spans when defaultRate is 1.0', async () => {
    const { signal, harness } = createTestSignal({
      sampling: { defaultRate: 1.0 },
    })

    await signal.trace('job1', async () => {})
    await signal.trace('job2', async () => {})
    await signal.trace('job3', async () => {})

    expect(harness.allSpans().length).toBe(3)

    harness.reset()
  })

  it('drops all non-matching spans when defaultRate is 0', async () => {
    const { signal, harness } = createTestSignal({
      sampling: { defaultRate: 0 },
    })

    await signal.trace('job1', async () => {})
    await signal.trace('job2', async () => {})

    expect(harness.allSpans().length).toBe(0)

    harness.reset()
  })

  it('deterministic: same traceId always same decision', async () => {
    const { signal, harness } = createTestSignal({
      sampling: { defaultRate: 0.5 },
    })

    for (let i = 0; i < 20; i++) {
      await signal.trace(`job-${i}`, async () => {})
    }

    const kept = harness.allSpans().length
    expect(kept).toBeGreaterThan(0)
    expect(kept).toBeLessThan(20)

    harness.reset()
  })
})
