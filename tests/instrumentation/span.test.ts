import { describe, it, expect } from 'vitest'
import { createHonoTestApp } from '../helpers/setup'

describe('signal.span()', () => {
  it('creates a child span', async () => {
    const { signal, harness, app } = createHonoTestApp()

    app.get('/test', async (c) => {
      await signal.span('payment.process', async (span) => {
        span.setAttribute('payment.provider', 'stripe')
      })
      return c.json({ ok: true })
    })

    await app.request('/test')

    const payment = harness.findSpan('payment.process')
    expect(payment).toBeDefined()
    expect(payment!.attributes['payment.provider']).toBe('stripe')

    harness.reset()
  })

  it('child span has correct parent', async () => {
    const { signal, harness, app } = createHonoTestApp()

    app.get('/test', async (c) => {
      await signal.span('child.op', async () => {})
      return c.json({ ok: true })
    })

    await app.request('/test')

    const root = harness.rootSpan()
    const child = harness.findSpan('child.op')
    expect(root).toBeDefined()
    expect(child).toBeDefined()
    expect(child!.parentSpanId).toBe(root!.spanContext().spanId)

    harness.reset()
  })

  it('returns the callback result', async () => {
    const { signal, harness, app } = createHonoTestApp()
    let result: number | undefined

    app.get('/test', async (c) => {
      result = await signal.span('compute', async () => 42)
      return c.json({ ok: true })
    })

    await app.request('/test')
    expect(result).toBe(42)

    harness.reset()
  })

  it('records exception and sets ERROR status on throw', async () => {
    const { signal, harness, app } = createHonoTestApp()

    app.get('/test', async (c) => {
      try {
        await signal.span('failing.op', async () => {
          throw new Error('oops')
        })
      } catch {
        // swallow for test
      }
      return c.json({ ok: true })
    })

    await app.request('/test')

    const failing = harness.findSpan('failing.op')
    expect(failing).toBeDefined()
    harness.assertStatus(failing!, 'ERROR')
    harness.assertException(failing!)

    harness.reset()
  })

  it('signal.attr() inside span still targets root span', async () => {
    const { signal, harness, app } = createHonoTestApp()

    app.get('/test', async (c) => {
      await signal.span('inner', async () => {
        signal.attr('app.user.id', 'usr_from_child')
      })
      return c.json({ ok: true })
    })

    await app.request('/test')

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    harness.assertAttr(root!, 'app.user.id', 'usr_from_child')

    // child span should NOT have this attribute
    const inner = harness.findSpan('inner')
    expect(inner).toBeDefined()
    expect(inner!.attributes['app.user.id']).toBeUndefined()

    harness.reset()
  })
})

describe('signal.error()', () => {
  it('records exception on the active span', async () => {
    const { signal, harness, app } = createHonoTestApp()

    app.get('/test', async (c) => {
      await signal.span('risky', async () => {
        try {
          throw new Error('bad thing')
        } catch (err) {
          signal.error(err)
          signal.attr('app.error.code', 'BAD_THING')
        }
      })
      return c.json({ ok: true })
    })

    await app.request('/test')

    const risky = harness.findSpan('risky')
    expect(risky).toBeDefined()
    harness.assertStatus(risky!, 'ERROR')
    harness.assertException(risky!)

    // error.code should be on root span (signal.attr always targets root)
    const root = harness.rootSpan()
    harness.assertAttr(root!, 'app.error.code', 'BAD_THING')

    harness.reset()
  })
})

describe('signal.event()', () => {
  it('records an event on the active span', async () => {
    const { signal, harness, app } = createHonoTestApp()

    app.get('/test', async (c) => {
      signal.event('cache_miss', { key: 'user:123' })
      return c.json({ ok: true })
    })

    await app.request('/test')

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    harness.assertEvent(root!, 'cache_miss')

    harness.reset()
  })
})
