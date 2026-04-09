import { describe, it, expect } from 'vitest'
import { createHonoTestApp } from '../helpers/setup'

function setup() {
  return createHonoTestApp({
    schema: {
      version: '1.0.0',
      required: ['app.request.id'] as const,
    },
  })
}

describe('Hono middleware', () => {
  it('creates a root span with automatic attributes', async () => {
    const { harness, app } = setup()
    app.get('/test', (c) => c.json({ ok: true }))

    await app.request('/test')

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    expect(root!.attributes['http.request.method']).toBe('GET')
    expect(root!.attributes['http.route']).toBe('/test')
    expect(root!.attributes['http.response.status_code']).toBe(200)
    expect(root!.attributes['app.schema.version']).toBe('1.0.0')
    expect(root!.attributes['app.request.id']).toBeDefined()

    harness.reset()
  })

  it('sets user attributes via signal.attr()', async () => {
    const { signal, harness, app } = setup()

    app.get('/checkout', (c) => {
      signal.attr('app.user.id', 'usr_123')
      signal.attr('app.customer.tier', 'enterprise')
      return c.json({ ok: true })
    })

    await app.request('/checkout')

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    harness.assertAttr(root!, 'app.user.id', 'usr_123')
    harness.assertAttr(root!, 'app.customer.tier', 'enterprise')

    harness.reset()
  })

  it('sets multiple attributes via signal.attrs()', async () => {
    const { signal, harness, app } = setup()

    app.get('/profile', (c) => {
      signal.attrs({
        'app.user.id': 'usr_456',
        'app.customer.tier': 'free',
        'app.cache.hit': true,
      })
      return c.json({ ok: true })
    })

    await app.request('/profile')

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    harness.assertAttr(root!, 'app.user.id', 'usr_456')
    harness.assertAttr(root!, 'app.customer.tier', 'free')
    harness.assertAttr(root!, 'app.cache.hit', true)

    harness.reset()
  })

  it('reads attributes back via signal.getAttr()', async () => {
    const { signal, harness, app } = setup()
    let readTier: string | undefined

    app.get('/read', (c) => {
      signal.attr('app.customer.tier', 'pro')
      readTier = signal.getAttr('app.customer.tier')
      return c.json({ ok: true })
    })

    await app.request('/read')
    expect(readTier).toBe('pro')

    harness.reset()
  })

  it('provides traceId inside request scope', async () => {
    const { signal, harness, app } = setup()
    let capturedTraceId: string | undefined

    app.get('/trace', (c) => {
      capturedTraceId = signal.traceId()
      return c.json({ ok: true })
    })

    await app.request('/trace')
    expect(capturedTraceId).toBeDefined()
    expect(capturedTraceId).toMatch(/^[0-9a-f]{32}$/)

    harness.reset()
  })

  it('sets response status code', async () => {
    const { harness, app } = setup()

    app.get('/not-found', (c) => {
      return c.json({ error: 'not found' }, 404)
    })

    await app.request('/not-found')

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    expect(root!.attributes['http.response.status_code']).toBe(404)

    harness.reset()
  })

  it('uses request ID from header when present', async () => {
    const { harness, app } = setup()
    app.get('/with-id', (c) => c.json({ ok: true }))

    await app.request('/with-id', {
      headers: { 'x-request-id': 'custom-req-123' },
    })

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    expect(root!.attributes['app.request.id']).toBe('custom-req-123')

    harness.reset()
  })

  it('harness.assertRequired checks required attributes', async () => {
    const { harness, app } = setup()
    app.get('/required', (c) => c.json({ ok: true }))

    await app.request('/required')

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    // app.request.id is set automatically by middleware, so this should pass
    expect(() => harness.assertRequired(root!)).not.toThrow()

    harness.reset()
  })

  it('harness.assertNoErrors passes when no errors', async () => {
    const { harness, app } = setup()
    app.get('/ok', (c) => c.json({ ok: true }))

    await app.request('/ok')
    expect(() => harness.assertNoErrors()).not.toThrow()

    harness.reset()
  })

  it('signal.keep() sets app.debug on root span', async () => {
    const { signal, harness, app } = setup()

    app.get('/debug', (c) => {
      signal.keep()
      return c.json({ ok: true })
    })

    await app.request('/debug')

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    expect(root!.attributes['app.debug']).toBe(true)

    harness.reset()
  })
})
