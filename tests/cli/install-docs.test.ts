import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { runInstallDocs } from '../../src/cli/install-docs'

describe('canon-signal install-docs', () => {
  const testDir = resolve(tmpdir(), 'canon-signal-install-docs-test-' + Date.now())

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  it('copies markdown files from resources/ into .canon-signal/', () => {
    mkdirSync(testDir, { recursive: true })

    runInstallDocs({ cwd: testDir })

    const installedDir = resolve(testDir, '.canon-signal')
    expect(existsSync(installedDir)).toBe(true)

    // Should have at least the core docs
    const installed = readdirSync(installedDir)
    expect(installed).toContain('README.md')
    expect(installed).toContain('CONSTITUTION.md')
    expect(installed).toContain('PLAYBOOK.md')
    expect(installed).toContain('API.md')
    expect(installed).toContain('PATTERNS.md')
    expect(installed).toContain('ANTI_PATTERNS.md')
    expect(installed).toContain('TROUBLESHOOTING.md')
  })

  it('does not copy the tutorial subdirectory', () => {
    mkdirSync(testDir, { recursive: true })

    runInstallDocs({ cwd: testDir })

    const installedDir = resolve(testDir, '.canon-signal')
    const installed = readdirSync(installedDir)
    expect(installed).not.toContain('tutorial')
  })

  it('prepends a version header to each installed file', () => {
    mkdirSync(testDir, { recursive: true })

    runInstallDocs({ cwd: testDir })

    const playbook = readFileSync(
      resolve(testDir, '.canon-signal', 'PLAYBOOK.md'),
      'utf-8',
    )
    expect(playbook).toMatch(/^<!--/)
    expect(playbook).toContain('canon-signal v')
    expect(playbook).toContain('Source: resources/PLAYBOOK.md')
  })

  it('writes AGENTS.md at the cwd root by default', () => {
    mkdirSync(testDir, { recursive: true })

    runInstallDocs({ cwd: testDir })

    const agentsMdPath = resolve(testDir, 'AGENTS.md')
    expect(existsSync(agentsMdPath)).toBe(true)

    const content = readFileSync(agentsMdPath, 'utf-8')
    expect(content).toContain('canon-signal')
    expect(content).toContain('.canon-signal/CONSTITUTION.md')
  })

  it('skips AGENTS.md when writeAgentsMd is false', () => {
    mkdirSync(testDir, { recursive: true })

    runInstallDocs({ cwd: testDir, writeAgentsMd: false })

    expect(existsSync(resolve(testDir, 'AGENTS.md'))).toBe(false)
    // But .canon-signal/ should still be installed
    expect(existsSync(resolve(testDir, '.canon-signal'))).toBe(true)
  })

  it('refuses to overwrite existing .canon-signal/ without force', () => {
    mkdirSync(resolve(testDir, '.canon-signal'), { recursive: true })

    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as any)

    expect(() => runInstallDocs({ cwd: testDir })).toThrow('process.exit called')
    mockExit.mockRestore()
  })

  it('overwrites .canon-signal/ when force is true', () => {
    mkdirSync(resolve(testDir, '.canon-signal'), { recursive: true })

    expect(() => runInstallDocs({ cwd: testDir, force: true })).not.toThrow()

    const installed = readdirSync(resolve(testDir, '.canon-signal'))
    expect(installed.length).toBeGreaterThan(0)
    expect(installed).toContain('CONSTITUTION.md')
  })
})
