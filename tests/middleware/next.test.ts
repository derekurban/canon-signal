import { describe, it, expect } from 'vitest'
import { createSignal, type SignalAttributes } from '../../src/index'

interface TestAttrs extends SignalAttributes {
  'app.request.id': string
  'app.user.id'?: string
}

describe('Next.js middleware', () => {
  it('creates a root span and runs the handler', async () => {
    const signal = createSignal<TestAttrs>({
      service: { name: 'next-app', version: '1.0.0', environment: 'test' },
      schema: { version: '1.0.0' },
    })
    const harness = signal.test.harness()
    const middleware = signal.middleware({ framework: 'next' })

    const headerMap = new Map([['x-request-id', 'next-req-1']])
    const fakeRequest = {
      method: 'POST',
      url: 'http://localhost:3000/api/checkout',
      // Headers-like object: only exposes .get(name)
      headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
      nextUrl: { pathname: '/api/checkout' },
    }

    const fakeResponse = { status: 200 }

    await middleware(fakeRequest, async () => {
      signal.attr('app.user.id', 'next-user-1')
      return fakeResponse
    })

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    expect(root!.attributes['http.request.method']).toBe('POST')
    expect(root!.attributes['http.route']).toBe('/api/checkout')
    expect(root!.attributes['http.response.status_code']).toBe(200)
    expect(root!.attributes['app.user.id']).toBe('next-user-1')
    expect(root!.attributes['app.request.id']).toBe('next-req-1')

    harness.reset()
  })

  it('returns the response from the next handler', async () => {
    const signal = createSignal<TestAttrs>({
      service: { name: 'next-app', version: '1.0.0', environment: 'test' },
      schema: { version: '1.0.0' },
    })
    const harness = signal.test.harness()
    const middleware = signal.middleware({ framework: 'next' })

    const fakeRequest = {
      method: 'GET',
      url: 'http://localhost:3000/api/users',
      headers: {},
      nextUrl: { pathname: '/api/users' },
    }

    const expectedResponse = { status: 201, custom: 'value' }
    const result = await middleware(fakeRequest, async () => expectedResponse)

    expect(result).toBe(expectedResponse)

    const root = harness.rootSpan()
    expect(root!.attributes['http.response.status_code']).toBe(201)

    harness.reset()
  })

  it('supports plain header objects (Pages Router)', async () => {
    const signal = createSignal<TestAttrs>({
      service: { name: 'next-app', version: '1.0.0', environment: 'test' },
      schema: { version: '1.0.0' },
    })
    const harness = signal.test.harness()
    const middleware = signal.middleware({ framework: 'next' })

    const fakeRequest = {
      method: 'GET',
      url: '/api/items',
      headers: { 'x-request-id': 'pages-req-1' },
    }

    await middleware(fakeRequest, async () => ({ status: 200 }))

    const root = harness.rootSpan()
    expect(root!.attributes['app.request.id']).toBe('pages-req-1')

    harness.reset()
  })
})
