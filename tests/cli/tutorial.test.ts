import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { runTutorial } from '../../src/cli/tutorial'

describe('canon-signal tutorial', () => {
  const testDir = resolve(tmpdir(), 'canon-signal-tutorial-test-' + Date.now())

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  it('prints the path to the bundled tutorial when called without --copy', () => {
    // Just verify it doesn't throw
    expect(() => runTutorial({ cwd: testDir })).not.toThrow()
  })

  it('copies the tutorial to cwd when --copy is set', () => {
    mkdirSync(testDir, { recursive: true })

    runTutorial({ cwd: testDir, copy: true })

    const expectedPath = resolve(testDir, 'canon-signal-tutorial.html')
    expect(existsSync(expectedPath)).toBe(true)

    const content = readFileSync(expectedPath, 'utf-8')
    expect(content).toContain('<!DOCTYPE html>')
    expect(content).toContain('canon-signal')
  })

  it('respects --out path', () => {
    mkdirSync(testDir, { recursive: true })

    runTutorial({ cwd: testDir, copy: true, outPath: 'docs/tutorial.html' })

    const expectedPath = resolve(testDir, 'docs', 'tutorial.html')
    expect(existsSync(expectedPath)).toBe(true)
  })

  it('creates the destination directory if it does not exist', () => {
    mkdirSync(testDir, { recursive: true })

    // Path with nested directories that don't exist yet
    runTutorial({ cwd: testDir, copy: true, outPath: 'a/b/c/tutorial.html' })

    expect(existsSync(resolve(testDir, 'a', 'b', 'c', 'tutorial.html'))).toBe(true)
  })
})
