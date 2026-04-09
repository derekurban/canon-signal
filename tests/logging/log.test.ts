import { describe, it, expect } from 'vitest'
import { createTestSignal, createHonoTestApp } from '../helpers/setup'

describe('signal.log (context-aware)', () => {
  it('attaches trace_id inside request scope', async () => {
    const { signal, harness, app } = createHonoTestApp()

    app.get('/test', (c) => {
      signal.log.info('audit event', { resource: 'patients' })
      return c.json({ ok: true })
    })

    await app.request('/test')

    const logs = harness.logRecords() as any[]
    expect(logs.length).toBeGreaterThan(0)

    const logRecord = logs[0]
    expect(logRecord.attributes?.['trace_id']).toBeDefined()
    expect(logRecord.attributes?.['trace_id']).toMatch(/^[0-9a-f]{32}$/)
    expect(logRecord.attributes?.['resource']).toBe('patients')
    expect(logRecord.body).toBe('audit event')

    harness.reset()
  })

  it('works without trace context outside request scope', async () => {
    const { signal, harness } = createTestSignal()

    signal.log.info('startup complete', { port: 3000 })

    const logs = harness.logRecords() as any[]
    expect(logs.length).toBe(1)
    expect(logs[0].body).toBe('startup complete')
    expect(logs[0].attributes?.['trace_id']).toBeUndefined()

    harness.reset()
  })

  it('supports all severity levels', async () => {
    const { signal, harness } = createTestSignal()

    signal.log.trace('trace msg')
    signal.log.debug('debug msg')
    signal.log.info('info msg')
    signal.log.warn('warn msg')
    signal.log.error('error msg')
    signal.log.fatal('fatal msg')

    const logs = harness.logRecords() as any[]
    expect(logs.length).toBe(6)

    harness.reset()
  })
})

describe('signal.systemLog (process-scoped)', () => {
  it('never attaches trace_id even inside request scope', async () => {
    const { signal, harness, app } = createHonoTestApp()

    app.get('/test', (c) => {
      signal.systemLog.info('pool status', { active: 18 })
      return c.json({ ok: true })
    })

    await app.request('/test')

    const logs = harness.logRecords() as any[]
    expect(logs.length).toBeGreaterThan(0)

    const systemLog = logs[0]
    expect(systemLog.attributes?.['trace_id']).toBeUndefined()
    expect(systemLog.attributes?.['active']).toBe(18)
    expect(systemLog.body).toBe('pool status')

    harness.reset()
  })
})
