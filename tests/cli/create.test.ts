import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { runCreate } from '../../src/cli/create'

describe('canon-signal create', () => {
  const testDir = resolve(tmpdir(), 'canon-signal-test-' + Date.now())

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  it('generates src/signal.ts from package.json', () => {
    mkdirSync(testDir, { recursive: true })
    writeFileSync(
      resolve(testDir, 'package.json'),
      JSON.stringify({ name: 'my-app', version: '2.0.0', dependencies: { hono: '^4.0.0' } }),
    )

    runCreate(testDir)

    const outputPath = resolve(testDir, 'src', 'signal.ts')
    expect(existsSync(outputPath)).toBe(true)

    const content = readFileSync(outputPath, 'utf-8')
    expect(content).toContain("name: 'my-app'")
    expect(content).toContain("version: '2.0.0'")
    expect(content).toContain('createSignal')
    expect(content).toContain('AppAttributes')
    expect(content).toContain("framework: 'hono'")
  })

  it('detects express framework', () => {
    mkdirSync(testDir, { recursive: true })
    writeFileSync(
      resolve(testDir, 'package.json'),
      JSON.stringify({ name: 'express-app', version: '1.0.0', dependencies: { express: '^4.0.0' } }),
    )

    runCreate(testDir)

    const content = readFileSync(resolve(testDir, 'src', 'signal.ts'), 'utf-8')
    expect(content).toContain("framework: 'express'")
  })

  it('exits if signal.ts already exists', () => {
    mkdirSync(resolve(testDir, 'src'), { recursive: true })
    writeFileSync(resolve(testDir, 'package.json'), JSON.stringify({ name: 'test' }))
    writeFileSync(resolve(testDir, 'src', 'signal.ts'), 'existing content')

    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as any)

    expect(() => runCreate(testDir)).toThrow('process.exit called')
    mockExit.mockRestore()
  })
})
