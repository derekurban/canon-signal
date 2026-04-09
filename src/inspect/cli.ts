/**
 * @module canon-signal/inspect/cli
 *
 * Implements `npx canon-signal inspect` — reads a JSONL spans file
 * (produced by the file exporter) and renders trace waterfalls.
 *
 * The CLI is designed for offline inspection of production traces:
 * pull a `traces.jsonl` artifact from CI, copy it locally, and run
 * `npx canon-signal inspect --file traces.jsonl --errors` to see what
 * went wrong without needing access to a backend.
 *
 * Supported flags:
 * - `--file <path>` (required) — JSONL file to read
 * - `--last <N>` — show the last N traces (default: 10)
 * - `--errors` — only show traces containing at least one ERROR span
 * - `--trace <id>` — show a specific trace by ID
 * - `--format json` — output structured JSON instead of the tree view
 */

import { readFileSync, existsSync } from 'node:fs'
import { SpanStatusCode } from '@opentelemetry/api'
import {
  formatDurationMs,
  hrDurationMs,
  hrTimeToMs,
} from '../util/span.js'

/**
 * Internal shape used by the CLI parser. Mirrors the JSONL output
 * format produced by `FileSpanExporter` — same field names, same nesting.
 * It's a subset of `ReadableSpan` with just the fields the CLI needs.
 */
interface ParsedSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startTime: [number, number]
  endTime: [number, number]
  status: { code: number }
  attributes: Record<string, any>
  events: Array<{ name: string; time: [number, number]; attributes?: Record<string, any> }>
}

/** Canon-signal-internal attributes filtered out of the CLI's attribute footer. */
const INTERNAL_ATTRS = new Set(['app.schema.version', 'app.debug', 'app.request.id'])

/**
 * Returns `true` if a parsed span has no parent (root of its trace).
 * Mirrors `isRootSpan` from `util/span.ts` but operates on the parsed
 * shape used by the CLI.
 */
function isParsedRootSpan(span: ParsedSpan): boolean {
  return !span.parentSpanId || span.parentSpanId === '0000000000000000'
}

/**
 * Reads a JSONL spans file from disk. Each non-empty line is parsed
 * as a single span. Aborts on file-not-found.
 */
function loadSpansFromFile(path: string): ParsedSpan[] {
  if (!existsSync(path)) {
    console.error(`canon-signal inspect: File not found: ${path}`)
    process.exit(1)
  }

  const content = readFileSync(path, 'utf-8')
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}

/** Groups spans by trace ID. Returns a map keyed by traceId. */
function groupByTrace(spans: ParsedSpan[]): Map<string, ParsedSpan[]> {
  const map = new Map<string, ParsedSpan[]>()
  for (const span of spans) {
    if (!map.has(span.traceId)) map.set(span.traceId, [])
    map.get(span.traceId)!.push(span)
  }
  return map
}

/**
 * Prints a single trace as a tree to stdout. Uses plain text (no ANSI)
 * so the output is easy to redirect or grep.
 */
function printTrace(spans: ParsedSpan[]): void {
  const root = spans.find(isParsedRootSpan)
  if (!root) return

  const statusText = root.status.code === SpanStatusCode.ERROR ? 'ERROR' : 'OK'
  const duration = formatDurationMs(hrDurationMs(root.startTime, root.endTime))
  const statusCode = root.attributes['http.response.status_code'] ?? ''

  console.log(`${root.name}  ${statusCode}  ${duration}  [${statusText}]`)

  const children = spans
    .filter((s) => s.spanId !== root.spanId)
    .sort((a, b) => hrTimeToMs(a.startTime) - hrTimeToMs(b.startTime))

  for (const child of children) {
    const d = formatDurationMs(hrDurationMs(child.startTime, child.endTime))
    const cs = child.status.code === SpanStatusCode.ERROR ? ' [ERROR]' : ''
    console.log(`  ├─ ${child.name}  ${d}${cs}`)
  }

  const attrKeys = Object.keys(root.attributes).filter(
    (k) => k.startsWith('app.') && !INTERNAL_ATTRS.has(k),
  )
  if (attrKeys.length > 0) {
    const attrs = attrKeys.map((k) => `${k.replace('app.', '')}=${root.attributes[k]}`).join('  ')
    console.log(`  └─ ${attrs}`)
  }

  console.log()
}

/**
 * Entry point for the inspect command. Parses CLI args, loads the
 * file, applies filters, and prints (or JSON-dumps) the result.
 *
 * @param args - The CLI arguments (excluding the `inspect` subcommand).
 */
export function runInspect(args: string[]): void {
  let filePath = ''
  let last = 10
  let errorsOnly = false
  let traceId: string | undefined
  let formatJson = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--file' && args[i + 1]) {
      filePath = args[++i]
    } else if (arg === '--last' && args[i + 1]) {
      last = parseInt(args[++i], 10)
    } else if (arg === '--errors') {
      errorsOnly = true
    } else if (arg === '--trace' && args[i + 1]) {
      traceId = args[++i]
    } else if (arg === '--format' && args[i + 1] === 'json') {
      formatJson = true
      i++
    }
  }

  if (!filePath) {
    console.error('canon-signal inspect: --file <path> is required')
    console.error('Usage: canon-signal inspect --file traces.jsonl [--last N] [--errors] [--trace ID] [--format json]')
    process.exit(1)
  }

  const spans = loadSpansFromFile(filePath)
  const traces = groupByTrace(spans)

  if (traceId) {
    const traceSpans = traces.get(traceId)
    if (!traceSpans) {
      console.error(`canon-signal inspect: No trace found with ID: ${traceId}`)
      process.exit(1)
    }
    if (formatJson) {
      console.log(JSON.stringify(traceSpans, null, 2))
    } else {
      printTrace(traceSpans)
    }
    return
  }

  let traceList = [...traces.values()]

  if (errorsOnly) {
    traceList = traceList.filter((spans) =>
      spans.some((s) => s.status.code === SpanStatusCode.ERROR),
    )
  }

  traceList = traceList.slice(-last)

  if (formatJson) {
    console.log(JSON.stringify(traceList, null, 2))
  } else {
    for (const traceSpans of traceList) {
      printTrace(traceSpans)
    }
    console.log(`Showing ${traceList.length} trace(s)`)
  }
}
