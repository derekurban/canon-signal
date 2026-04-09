/**
 * @module canon-signal/auto
 *
 * Zero-configuration entry point. Importing from this module gives you
 * a pre-built `signal` instance with sensible defaults pulled from your
 * environment, intended for evaluation and quick demos.
 *
 * ```ts
 * import { signal } from 'canon-signal/auto'
 *
 * app.use('*', signal.middleware())
 * ```
 *
 * The auto-configured signal:
 * - Reads `service.name` from `OTEL_SERVICE_NAME`, falling back to `package.json`'s `name`
 * - Reads `service.version` from `package.json`
 * - Reads `environment` from `NODE_ENV` (default: 'development')
 * - Uses the base `SignalAttributes` type (no custom `app.*` attributes)
 * - Uses schema version `'0.0.0'`
 * - Enables every default auto-instrumentation
 *
 * To graduate from `auto` to a typed schema, run `npx canon-signal create`
 * and replace this import with your own `src/signal.ts`.
 */

import { createSignal } from './factory/create.js'
import type { SignalAttributes } from './types/attributes.js'

/**
 * Reads the consumer project's `package.json` to extract the service name
 * and version. Returns an empty object if the file can't be read.
 *
 * Uses `require()` rather than `import()` so this works in both ESM and CJS
 * builds without an async boundary.
 */
function readPackageJson(): { name?: string; version?: string } {
  try {
    const fs = require('node:fs')
    const path = require('node:path')
    const pkgPath = path.resolve(process.cwd(), 'package.json')
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  } catch {
    return {}
  }
}

const pkg = readPackageJson()

/**
 * The pre-built signal instance for zero-config use. Configured from
 * environment variables and `package.json` at module load time.
 *
 * Side effect: importing this module immediately calls `createSignal()`,
 * which initializes the OTel SDK and registers all auto-instrumentations.
 */
export const signal = createSignal<SignalAttributes>({
  service: {
    name: process.env.OTEL_SERVICE_NAME ?? pkg.name ?? 'unknown-service',
    version: pkg.version ?? '0.0.0',
    environment: process.env.NODE_ENV ?? 'development',
  },
  schema: { version: '0.0.0' },
})
