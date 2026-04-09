import { describe, it, expect } from 'vitest'
import { createTestSignal } from '../helpers/setup'
import { createPinoTransport } from '../../src/bridges/pino'

function setup() {
  const { signal, harness } = createTestSignal()
  // Bind the transport to this specific signal's loggerProvider so test isolation works
  const transport = createPinoTransport({ loggerProvider: signal.loggerProvider })
  return { signal, harness, transport }
}

async function writeLine(transport: any, line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    transport.write(line, 'utf-8', (err: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

describe('Pino bridge', () => {
  it('emits OTel log records from JSON pino lines', async () => {
    const { harness, transport } = setup()

    const pinoLine = JSON.stringify({
      level: 30,
      time: 1700000000000,
      pid: 12345,
      hostname: 'host',
      msg: 'user logged in',
      userId: 'usr_1',
    }) + '\n'

    await writeLine(transport, pinoLine)
    await new Promise((r) => setTimeout(r, 10))

    const records = harness.logRecords() as any[]
    expect(records.length).toBeGreaterThan(0)
    const record = records[records.length - 1]
    expect(record.body).toBe('user logged in')
    expect(record.severityText).toBe('INFO')
    expect(record.attributes?.userId).toBe('usr_1')

    harness.reset()
  })

  it('maps pino levels to OTel severities', async () => {
    const { harness, transport } = setup()

    const levels = [
      { level: 10, expected: 'TRACE' },
      { level: 20, expected: 'DEBUG' },
      { level: 30, expected: 'INFO' },
      { level: 40, expected: 'WARN' },
      { level: 50, expected: 'ERROR' },
      { level: 60, expected: 'FATAL' },
    ]

    for (const { level, expected } of levels) {
      const line = JSON.stringify({ level, msg: `${expected} msg`, time: Date.now() }) + '\n'
      await writeLine(transport, line)
    }

    await new Promise((r) => setTimeout(r, 10))

    const records = harness.logRecords() as any[]
    expect(records.length).toBe(6)
    for (let i = 0; i < levels.length; i++) {
      expect(records[i].severityText).toBe(levels[i].expected)
    }

    harness.reset()
  })

  it('skips invalid (non-JSON) lines without throwing', async () => {
    const { harness, transport } = setup()

    await writeLine(transport, 'not json\n')
    await new Promise((r) => setTimeout(r, 10))

    const records = harness.logRecords() as any[]
    expect(records.length).toBe(0)

    harness.reset()
  })
})
