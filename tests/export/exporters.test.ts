import http from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSignal } from '../../src/index'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

function makeTempPath(fileName: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'canon-signal-'))
  tempDirs.push(dir)
  return join(dir, fileName)
}

function createBaseSignal(exportConfig: NonNullable<Parameters<typeof createSignal>[0]['export']>) {
  return createSignal({
    service: { name: 'test-service', version: '0.0.1', environment: 'test' },
    schema: { version: '1.0.0' },
    export: exportConfig,
  })
}

describe('exporters', () => {
  it('supports console, pretty-console, and file for logs', async () => {
    const logPath = makeTempPath('logs.jsonl')
    const consoleDir = vi.spyOn(console, 'dir').mockImplementation(() => {})
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    const signal = createBaseSignal({
      logs: [
        { type: 'console' },
        { type: 'pretty-console' },
        { type: 'file', path: logPath },
      ],
    })

    signal.log.info('hello world', { region: 'test' })
    await signal.shutdown()

    const file = readFileSync(logPath, 'utf8')
    expect(consoleDir).toHaveBeenCalled()
    expect(consoleLog).toHaveBeenCalled()
    expect(file).toContain('"signal":"log"')
    expect(file).toContain('"body":"hello world"')
  })

  it('exports metrics over OTLP on shutdown', async () => {
    const requests: Array<{ method?: string; url?: string; bytes: number }> = []
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        requests.push({
          method: req.method,
          url: req.url,
          bytes: Buffer.concat(chunks).length,
        })
        res.statusCode = 200
        res.end('ok')
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address')
    }

    const signal = createBaseSignal({
      metrics: [{ type: 'otlp', endpoint: `http://127.0.0.1:${address.port}/v1/metrics` }],
    })

    const meters = signal.meter({
      requests_total: {
        type: 'counter',
        unit: 'requests',
        description: 'Total requests',
      },
    })
    meters.requests_total.add(1, { route: '/test' })

    await signal.shutdown()
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )

    expect(requests.length).toBeGreaterThan(0)
    expect(requests[0].url).toBe('/v1/metrics')
    expect(requests[0].bytes).toBeGreaterThan(0)
  })

  it('applies export.all to traces, logs, and metrics', async () => {
    const sharedPath = makeTempPath('shared.jsonl')
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    const signal = createBaseSignal({
      all: [
        { type: 'pretty-console' },
        { type: 'file', path: sharedPath },
      ],
    })

    const meters = signal.meter({
      requests_total: {
        type: 'counter',
        unit: 'requests',
        description: 'Total requests',
      },
    })

    await signal.trace('job.process', async () => {
      signal.log.info('job emitted', { queue: 'default' })
      meters.requests_total.add(1, { job: 'process' })
    })
    await signal.shutdown()

    const lines = readFileSync(sharedPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { signal: string })

    expect(lines.some((line) => line.signal === 'trace')).toBe(true)
    expect(lines.some((line) => line.signal === 'log')).toBe(true)
    expect(lines.some((line) => line.signal === 'metric')).toBe(true)
    expect(consoleLog).toHaveBeenCalled()
  })

  it('supports console, pretty-console, and file for metrics', async () => {
    const metricPath = makeTempPath('metrics.jsonl')
    const consoleDir = vi.spyOn(console, 'dir').mockImplementation(() => {})
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    const signal = createBaseSignal({
      metrics: [
        { type: 'console' },
        { type: 'pretty-console' },
        { type: 'file', path: metricPath },
      ],
    })

    const meters = signal.meter({
      latency_ms: {
        type: 'histogram',
        unit: 'ms',
        description: 'Latency',
      },
    })
    meters.latency_ms.record(42, { route: '/metrics' })

    await signal.shutdown()

    const file = readFileSync(metricPath, 'utf8')
    expect(consoleDir).toHaveBeenCalled()
    expect(consoleLog).toHaveBeenCalled()
    expect(file).toContain('"signal":"metric"')
    expect(file).toContain('"name":"latency_ms"')
  })
})
