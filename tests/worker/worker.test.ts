import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import { buildSync } from 'esbuild'
import { createWorkerSignal } from '../../src/worker'
import type { SignalAttributes } from '../../src/types/attributes'

interface WorkerAttrs extends SignalAttributes {
  'app.user.id'?: string
}

function createTestWorkerSignal() {
  const signal = createWorkerSignal<WorkerAttrs>({
    service: { name: 'worker-test', version: '1.0.0', environment: 'test' },
    schema: { version: '1.0.0', required: ['app.request.id'] },
  })
  return { signal, harness: signal.test.harness() }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('canon-signal/worker', () => {
  it('captures Hono request spans and user attributes', async () => {
    const { signal, harness } = createTestWorkerSignal()
    const app = new Hono()
    app.use('*', signal.middleware())
    app.get('/worker', (c) => {
      signal.attr('app.user.id', 'usr_worker')
      return c.json({ ok: true })
    })

    await app.request('/worker', {
      headers: { 'x-request-id': 'req_worker' },
    })

    const root = harness.rootSpan()
    expect(root).toBeDefined()
    expect(root!.name).toBe('GET /worker')
    expect(root!.attributes['app.request.id']).toBe('req_worker')
    expect(root!.attributes['app.user.id']).toBe('usr_worker')
    expect(root!.attributes['http.response.status_code']).toBe(200)
  })

  it('parents manual child spans from the canon-signal request scope', async () => {
    const { signal, harness } = createTestWorkerSignal()
    const app = new Hono()
    app.use('*', signal.middleware())
    app.get('/child', async (c) => {
      await signal.span('worker.child', async () => {
        signal.event('child.event')
      })
      return c.text('ok')
    })

    await app.request('/child')

    const root = harness.rootSpan()
    const child = harness.findSpan('worker.child')
    expect(root).toBeDefined()
    expect(child).toBeDefined()
    expect(child!.parentSpanId).toBe(root!.spanContext().spanId)
    harness.assertEvent(child!, 'child.event')
  })

  it('adds trace context to worker log records', async () => {
    const { signal, harness } = createTestWorkerSignal()
    const app = new Hono()
    app.use('*', signal.middleware())
    app.get('/log', (c) => {
      signal.log.info('worker log')
      return c.text('ok')
    })

    await app.request('/log')

    const root = harness.rootSpan()
    const [record] = harness.logRecords() as Array<{ attributes?: Record<string, unknown> }>
    expect(root).toBeDefined()
    expect(record.attributes?.trace_id).toBe(root!.spanContext().traceId)
    expect(record.attributes?.span_id).toBe(root!.spanContext().spanId)
  })

  it('schedules flush with executionCtx.waitUntil when available', async () => {
    const { signal, harness } = createTestWorkerSignal()
    const waitUntil = vi.fn()
    const middleware = signal.middleware()
    const c = {
      req: {
        method: 'GET',
        url: 'https://example.com/wait',
        header: () => undefined,
      },
      res: { status: 202 },
      executionCtx: { waitUntil },
    }

    await middleware(c, async () => {
      signal.attr('app.user.id', 'usr_wait')
    })

    expect(waitUntil).toHaveBeenCalledTimes(1)
    await waitUntil.mock.calls[0][0]
    expect(harness.rootSpan()?.attributes['app.user.id']).toBe('usr_wait')
  })

  it('exports traces and logs over fetch-based OTLP', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const signal = createWorkerSignal({
      service: { name: 'worker-test', version: '1.0.0', environment: 'test' },
      schema: { version: '1.0.0' },
      export: {
        traces: [{ type: 'otlp', endpoint: 'https://collector.example/otlp' }],
        logs: [{ type: 'otlp', endpoint: 'https://collector.example/otlp' }],
      },
    })

    await signal.trace('worker.job', async () => {
      signal.log.info('job log')
    })
    await signal.flush()

    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls).toContain('https://collector.example/otlp/v1/traces')
    expect(urls).toContain('https://collector.example/otlp/v1/logs')
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.method).toBe('POST')
      expect(init.body).toBeInstanceOf(Uint8Array)
      expect((init.body as Uint8Array).byteLength).toBeGreaterThan(0)
    }
  })

  it('bundles the worker entry without Node-only runtime modules', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'canon-signal-worker-bundle-'))
    const outFile = join(outDir, 'worker.js')
    buildSync({
      entryPoints: ['src/worker.ts'],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      external: ['node:async_hooks'],
      outfile: outFile,
      logLevel: 'warning',
    })

    const bundled = readFileSync(outFile, 'utf8')
    rmSync(outDir, { recursive: true, force: true })
    expect(bundled).not.toContain('node:fs')
    expect(bundled).not.toContain('node:crypto')
    expect(bundled).not.toContain('node:http')
    expect(bundled).not.toContain('process.env')
    expect(bundled).not.toContain('@opentelemetry/sdk-trace-node')
    expect(bundled).not.toContain('@opentelemetry/auto-instrumentations-node')
  })
})
