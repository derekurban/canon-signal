/**
 * @module canon-signal/cli/tutorial
 *
 * Implements `npx canon-signal tutorial` — opens or copies the
 * single-file HTML tutorial.
 *
 * Two modes:
 * 1. **Default**: print the path to the bundled HTML file. The user can
 *    open it in their browser. We don't try to launch the browser
 *    automatically because that's brittle across platforms.
 * 2. **`--copy`**: copies the HTML file to the user's current directory
 *    (or a path specified with `--out`) so they have a portable artifact.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Resolves the path to the bundled tutorial HTML file by walking up
 * from this module's location until we find the canon-signal package
 * root, then locating `resources/tutorial/canon-signal-tutorial.html`.
 */
function findTutorialFile(): string {
  let currentDir: string
  try {
    currentDir = dirname(fileURLToPath(import.meta.url))
  } catch {
    currentDir = __dirname
  }

  let dir = currentDir
  for (let i = 0; i < 10; i++) {
    const pkgJsonPath = join(dir, 'package.json')
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
        if (pkg.name === 'canon-signal') {
          const tutorialPath = join(dir, 'resources', 'tutorial', 'canon-signal-tutorial.html')
          if (existsSync(tutorialPath)) return tutorialPath
        }
      } catch {
        // ignore parse errors
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  throw new Error(
    'canon-signal: could not locate the tutorial HTML file. ' +
      'This usually means the package is corrupted or the resources/ folder ' +
      'is missing from the published package.',
  )
}

export interface TutorialOptions {
  cwd?: string
  /** Copy the tutorial file to the cwd (or to outPath if specified). */
  copy?: boolean
  /** Optional output path when --copy is used. */
  outPath?: string
}

/**
 * Runs the tutorial command. With no flags, prints the path to the
 * bundled HTML file. With `--copy`, copies the file to the user's cwd.
 */
export function runTutorial(options: TutorialOptions = {}): void {
  const cwd = options.cwd ?? process.cwd()
  const sourcePath = findTutorialFile()

  if (options.copy) {
    const destPath = options.outPath
      ? resolve(cwd, options.outPath)
      : resolve(cwd, 'canon-signal-tutorial.html')

    const destDir = dirname(destPath)
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true })
    }

    const content = readFileSync(sourcePath, 'utf-8')
    writeFileSync(destPath, content, 'utf-8')

    console.log(`Copied tutorial to ${destPath}`)
    console.log('Open it in any browser to read.')
    return
  }

  // Default: print the path so the user can open it
  console.log('canon-signal tutorial')
  console.log()
  console.log('The bundled HTML tutorial is located at:')
  console.log(`  ${sourcePath}`)
  console.log()
  console.log('Open it in any browser, or run `npx canon-signal tutorial --copy`')
  console.log('to copy it to your current directory.')
}
