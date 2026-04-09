import { describe, it, expect } from 'vitest'
import { createHonoTestApp } from '../helpers/setup'
import { narrateTrace } from '../../src/inspect/narrate'

describe('narrateTrace', () => {
  it('produces a narrative from trace spans', async () => {
    const { signal, harness, app } = createHonoTestApp()

    app.get('/checkout', async (c) => {
      signal.attr('app.user.id', 'usr_123')
      signal.attr('app.customer.tier', 'enterprise')
      await signal.span('payment.process', async (span) => {
        span.setAttribute('payment.amount', 4999)
      })
      return c.json({ ok: true })
    })

    await app.request('/checkout')

    const spans = harness.allSpans()
    const narrative = narrateTrace(spans as any)

    expect(narrative.summary).toContain('usr_123')
    expect(narrative.summary).toContain('enterprise')
    expect(narrative.timeline.length).toBeGreaterThan(0)
    expect(narrative.timeline[0].span).toBe('payment.process')
    expect(narrative.rootAttributes['app.user.id']).toBe('usr_123')
    expect(narrative.errorChain.length).toBe(0)

    harness.reset()
  })

  it('identifies error chains', async () => {
    const { signal, harness, app } = createHonoTestApp()

    app.get('/fail', async (c) => {
      try {
        await signal.span('payment.charge', async () => {
          throw new Error('Card declined')
        })
      } catch {
        signal.attr('app.error.code', 'CARD_DECLINED')
      }
      return c.json({ error: true }, 500)
    })

    await app.request('/fail')

    const spans = harness.allSpans()
    const narrative = narrateTrace(spans as any)

    expect(narrative.errorChain.length).toBeGreaterThan(0)
    expect(narrative.errorChain[0]).toContain('payment.charge')

    harness.reset()
  })
})
