import { describe, it, expect } from 'vitest'
import { createFastifyTestApp } from '../helpers/setup'

function setup() {
  return createFastifyTestApp({
    schema: {
      version: '1.0.0',
      required: ['app.request.id'] as const,
    },
  })
}

describe('Fastify middleware', () => {
  it('does not deadlock the request lifecycle (issue #4)', async () => {
    const { app } = await setup()
    app.get('/ping', async (_req, reply) => reply.status(200).send({ ok: true }))

    const racer = Promise.race([
      app.inject({ method: 'GET', url: '/ping' }).then((r) => ({ kind: 'response' as const, r })),
      new Promise<{ kind: 'timeout' }>((resolve) =>
        setTimeout(() => resolve({ kind: 'timeout' }), 2000),
      ),
    ])
    const outcome = await racer
    expect(outcome.kind).toBe('response')

    await app.close()
  })

  it('creates a root span with automatic attributes', async () => {
    const { harness, app } = await setup()
    app.get('/test', async (_req, reply) => reply.status(200).send({ ok: true }))

    await app.inject({ method: 'GET', url: '/test' })

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    expect(root!.attributes['http.request.method']).toBe('GET')
    expect(root!.attributes['http.route']).toBe('/test')
    expect(root!.attributes['http.response.status_code']).toBe(200)
    expect(root!.attributes['app.schema.version']).toBe('1.0.0')
    expect(root!.attributes['app.request.id']).toBeDefined()

    harness.reset()
    await app.close()
  })

  it('uses Fastify route template for http.route on parameterized routes', async () => {
    const { harness, app } = await setup()
    app.get('/users/:id', async (_req, reply) => reply.status(200).send({ ok: true }))

    await app.inject({ method: 'GET', url: '/users/abc-123' })

    const root = harness.rootSpan()
    expect(root!.attributes['http.route']).toBe('/users/:id')

    harness.reset()
    await app.close()
  })

  it('runs route handlers inside a request scope', async () => {
    const { signal, harness, app } = await setup()

    app.get('/checkout', async (_req, reply) => {
      signal.attr('app.user.id', 'usr_123')
      signal.attr('app.customer.tier', 'enterprise')
      return reply.status(200).send({ ok: true })
    })

    await app.inject({ method: 'GET', url: '/checkout' })

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    harness.assertAttr(root!, 'app.user.id', 'usr_123')
    harness.assertAttr(root!, 'app.customer.tier', 'enterprise')

    harness.reset()
    await app.close()
  })

  it('reads attributes back via signal.getAttr() inside the handler', async () => {
    const { signal, harness, app } = await setup()
    let readTier: string | undefined

    app.get('/read', async (_req, reply) => {
      signal.attr('app.customer.tier', 'pro')
      readTier = signal.getAttr('app.customer.tier')
      return reply.status(200).send({ ok: true })
    })

    await app.inject({ method: 'GET', url: '/read' })
    expect(readTier).toBe('pro')

    harness.reset()
    await app.close()
  })

  it('exposes a stable traceId inside the request scope', async () => {
    const { signal, harness, app } = await setup()
    let capturedTraceId: string | undefined

    app.get('/trace', async (_req, reply) => {
      capturedTraceId = signal.traceId()
      return reply.status(200).send({ ok: true })
    })

    await app.inject({ method: 'GET', url: '/trace' })
    expect(capturedTraceId).toMatch(/^[0-9a-f]{32}$/)

    harness.reset()
    await app.close()
  })

  it('records a non-200 status code from reply.status()', async () => {
    const { harness, app } = await setup()

    app.get('/not-found', async (_req, reply) => reply.status(404).send({ error: 'not found' }))

    await app.inject({ method: 'GET', url: '/not-found' })

    const root = harness.rootSpan()
    expect(root!.attributes['http.response.status_code']).toBe(404)

    harness.reset()
    await app.close()
  })

  it('uses request ID from x-request-id header when present', async () => {
    const { harness, app } = await setup()
    app.get('/with-id', async (_req, reply) => reply.status(200).send({ ok: true }))

    await app.inject({
      method: 'GET',
      url: '/with-id',
      headers: { 'x-request-id': 'custom-req-123' },
    })

    const root = harness.rootSpan()
    expect(root!.attributes['app.request.id']).toBe('custom-req-123')

    harness.reset()
    await app.close()
  })

  it('signal.span() inside a handler creates a child of the root span', async () => {
    const { signal, harness, app } = await setup()

    app.get('/work', async (_req, reply) => {
      await signal.span('child-work', async () => {
        // do nothing
      })
      return reply.status(200).send({ ok: true })
    })

    await app.inject({ method: 'GET', url: '/work' })

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    const child = harness.findSpan('child-work')
    expect(child).toBeDefined()
    expect(child!.parentSpanId).toBe(root!.spanContext().spanId)

    harness.reset()
    await app.close()
  })

  it('signal.keep() sets app.debug on root span', async () => {
    const { signal, harness, app } = await setup()

    app.get('/debug', async (_req, reply) => {
      signal.keep()
      return reply.status(200).send({ ok: true })
    })

    await app.inject({ method: 'GET', url: '/debug' })

    const root = harness.rootSpan()
    expect(root!.attributes['app.debug']).toBe(true)

    harness.reset()
    await app.close()
  })

  it('records exceptions thrown by the route handler and re-throws', async () => {
    const { harness, app } = await setup()

    app.get('/boom', async () => {
      throw new Error('intentional')
    })

    const res = await app.inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(500)

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    harness.assertException(root!)

    harness.reset()
    await app.close()
  })

  it('escapes plugin encapsulation so hooks fire for routes on the parent app', async () => {
    // This is the second half of issue #4: without `Symbol.for('skip-override')`,
    // `app.register(signal.middleware(...))` would create an encapsulated child
    // context, and the plugin's `onRoute` hook would never fire for routes
    // registered on the outer `app`. If the override is missing, this test fails
    // because no root span gets recorded.
    const { harness, app } = await setup()
    app.get('/parent-scope', async (_req, reply) => reply.status(200).send({ ok: true }))

    await app.inject({ method: 'GET', url: '/parent-scope' })

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    expect(root!.attributes['http.route']).toBe('/parent-scope')

    harness.reset()
    await app.close()
  })
})
