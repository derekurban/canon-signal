/**
 * @module canon-signal/cli/report-issue
 *
 * Implements `npx canon-signal report-issue` — opens a pre-filled
 * GitHub issue in the user's browser with diagnostic information
 * automatically gathered from the local environment.
 *
 * **Why this command exists**: filing a high-quality issue requires
 * including version numbers, OS info, Node version, and other context.
 * Asking users (or AI agents) to manually gather this is friction.
 * This command does it automatically and pre-fills the issue body
 * with the structured diagnostic block, leaving the user to write
 * the actual description on GitHub.
 *
 * **No authentication required**: this works by constructing a GitHub
 * "new issue" URL with `title=` and `body=` query parameters. The user's
 * browser handles authentication via their existing GitHub session.
 * No API tokens, no PATs, no extra setup.
 *
 * The repository URL is read from canon-signal's own `package.json`
 * `repository.url` field, so this CLI files issues against canon-signal
 * itself, not the user's project.
 */

import { exec } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Resolves the canon-signal package root by walking up from this
 * module's location. Returns the parsed `package.json`.
 */
function readCanonSignalPackageJson(): Record<string, any> {
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
        if (pkg.name === 'canon-signal') return pkg
      } catch {
        // ignore parse errors
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  throw new Error('canon-signal: could not locate package.json')
}

/**
 * Result of extracting a GitHub slug from package metadata.
 * The `placeholder` flag distinguishes "no recognizable URL" from
 * "URL contains an unfilled placeholder like `<OWNER>`".
 */
interface SlugResult {
  slug: string | null
  placeholder: boolean
  rawUrl: string | null
}

/**
 * Extracts the GitHub `owner/repo` slug from a `package.json`
 * `repository.url` field. Handles the standard formats:
 * - `git+https://github.com/owner/repo.git`
 * - `https://github.com/owner/repo`
 * - `git@github.com:owner/repo.git`
 * - `github:owner/repo`
 *
 * If the URL contains an obvious placeholder like `<OWNER>` or `OWNER/`,
 * the result reports `placeholder: true` so the caller can produce a
 * helpful error message.
 */
function extractGitHubSlug(pkg: Record<string, any>): SlugResult {
  const repository = pkg.repository
  if (!repository) return { slug: null, placeholder: false, rawUrl: null }

  const url = typeof repository === 'string' ? repository : repository.url
  if (typeof url !== 'string') return { slug: null, placeholder: false, rawUrl: null }

  // Detect unfilled placeholders before running the strict regex
  if (url.includes('<OWNER>') || /(?:^|[/:])OWNER\//.test(url)) {
    return { slug: null, placeholder: true, rawUrl: url }
  }

  // Try common formats
  const patterns = [
    /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/,
    /^github:([\w.-]+\/[\w.-]+)$/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1]) {
      return { slug: match[1], placeholder: false, rawUrl: url }
    }
  }

  return { slug: null, placeholder: false, rawUrl: url }
}

/**
 * Builds the markdown body of the issue with diagnostic information
 * pre-filled. The user is expected to fill in the description sections
 * on GitHub before submitting.
 */
function buildIssueBody(version: string): string {
  const lines: string[] = []
  lines.push('## Description')
  lines.push('')
  lines.push('<!-- Describe the issue you encountered or the question you have. -->')
  lines.push('')
  lines.push('## Reproduction')
  lines.push('')
  lines.push('<!-- Minimal code that reproduces the issue, if applicable. -->')
  lines.push('')
  lines.push('```typescript')
  lines.push('// your code here')
  lines.push('```')
  lines.push('')
  lines.push('## Expected behavior')
  lines.push('')
  lines.push('<!-- What did you expect to happen? -->')
  lines.push('')
  lines.push('## Actual behavior')
  lines.push('')
  lines.push('<!-- What actually happened? -->')
  lines.push('')
  lines.push('## Diagnostics')
  lines.push('')
  lines.push(`- canon-signal version: ${version}`)
  lines.push(`- Node.js version: ${process.version}`)
  lines.push(`- Platform: ${process.platform} ${process.arch}`)
  lines.push(`- Module format: ${typeof require === 'undefined' ? 'ESM' : 'CJS'}`)
  lines.push('')
  lines.push('---')
  lines.push('*This issue was opened via `npx canon-signal report-issue`*')

  return lines.join('\n')
}

/**
 * Builds the full GitHub "new issue" URL with pre-filled title, body,
 * and labels. Uses URLSearchParams which handles URL-encoding for us.
 */
function buildIssueUrl(
  slug: string,
  title: string,
  body: string,
  labels: string[],
): string {
  const params = new URLSearchParams()
  if (title) params.set('title', title)
  if (body) params.set('body', body)
  if (labels.length > 0) params.set('labels', labels.join(','))

  return `https://github.com/${slug}/issues/new?${params.toString()}`
}

/**
 * Attempts to open a URL in the default browser using the platform's
 * shell command. Returns true if the command was issued (not necessarily
 * if the browser actually opened).
 *
 * Cross-platform commands:
 * - macOS: `open <url>`
 * - Windows: `start "" <url>` (the empty quoted string is the window title)
 * - Linux: `xdg-open <url>`
 */
function tryOpenInBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let command: string
    switch (process.platform) {
      case 'darwin':
        command = `open "${url}"`
        break
      case 'win32':
        command = `start "" "${url}"`
        break
      default:
        command = `xdg-open "${url}"`
        break
    }

    exec(command, (error) => {
      resolve(!error)
    })
  })
}

/**
 * Maps the user-facing issue type to a default title prefix and label
 * set for the GitHub URL.
 */
const ISSUE_TYPES = {
  bug: { titlePrefix: '[Bug] ', labels: ['bug'] },
  feature: { titlePrefix: '[Feature] ', labels: ['enhancement'] },
  question: { titlePrefix: '[Question] ', labels: ['question'] },
} as const

type IssueType = keyof typeof ISSUE_TYPES

export interface ReportIssueOptions {
  /** Issue title (will be prefixed based on `type`). */
  title?: string
  /** Issue type — controls title prefix and labels. */
  type?: IssueType
  /** Skip the browser-open step and just print the URL. */
  printOnly?: boolean
}

/**
 * Runs the report-issue command. Builds a pre-filled GitHub new-issue
 * URL with diagnostic info, attempts to open it in the user's browser,
 * and prints it to stdout as a fallback.
 */
export async function runReportIssue(options: ReportIssueOptions = {}): Promise<void> {
  const pkg = readCanonSignalPackageJson()
  const version = pkg.version ?? '0.0.0'
  const slugResult = extractGitHubSlug(pkg)

  if (slugResult.placeholder) {
    console.error(
      'canon-signal: the package.json repository.url still contains a placeholder ' +
        `(${slugResult.rawUrl}). canon-signal has not been configured with its real ` +
        'GitHub URL yet, so report-issue cannot construct an issue link.',
    )
    process.exit(1)
  }

  if (!slugResult.slug) {
    console.error(
      'canon-signal: could not determine the GitHub repository URL from package.json. ' +
        'The repository.url field may be missing or in an unrecognized format.',
    )
    process.exit(1)
  }

  const slug = slugResult.slug
  const type: IssueType = options.type ?? 'bug'
  const typeConfig = ISSUE_TYPES[type]

  const userTitle = options.title?.trim() ?? ''
  const fullTitle = userTitle
    ? `${typeConfig.titlePrefix}${userTitle}`
    : typeConfig.titlePrefix.trim()

  const body = buildIssueBody(version)
  const url = buildIssueUrl(slug, fullTitle, body, [...typeConfig.labels])

  console.log('canon-signal: opening a new issue in your browser')
  console.log()
  console.log(`Repository: https://github.com/${slug}`)
  console.log(`Type:       ${type}`)
  if (userTitle) {
    console.log(`Title:      ${fullTitle}`)
  }
  console.log()
  console.log('If your browser does not open automatically, copy this URL:')
  console.log()
  console.log(url)
  console.log()

  if (!options.printOnly) {
    const opened = await tryOpenInBrowser(url)
    if (!opened) {
      console.log(
        '(Note: could not auto-open the browser. Use the URL above.)',
      )
    }
  }
}
