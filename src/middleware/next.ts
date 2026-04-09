/**
 * @module canon-signal/middleware/next
 *
 * Next.js framework adapter. Returns a function compatible with both
 * App Router middleware (`middleware.ts` with `NextRequest`/`NextResponse`)
 * and Pages Router API routes (with the older `req`/`res` style).
 *
 * Usage in App Router (`middleware.ts`):
 * ```ts
 * import { NextResponse } from 'next/server'
 * import { signal } from '@/signal'
 *
 * const tracingMiddleware = signal.middleware({ framework: 'next' })
 *
 * export async function middleware(request) {
 *   return tracingMiddleware(request, () => NextResponse.next())
 * }
 * ```
 *
 * Usage in Pages Router API routes:
 * ```ts
 * const tracingMiddleware = signal.middleware({ framework: 'next' })
 *
 * export default async function handler(req, res) {
 *   await tracingMiddleware(
 *     { method: req.method, url: req.url, headers: req.headers },
 *     async () => {
 *       res.json({ ok: true })
 *     }
 *   )
 * }
 * ```
 *
 * **Edge Runtime caveat**: Next.js's Edge Runtime does NOT support
 * Node.js's `AsyncLocalStorage`. canon-signal's context propagation
 * therefore only works in the default Node.js runtime. To use canon-signal
 * in Next.js middleware, set `export const runtime = 'nodejs'` in your
 * route file.
 */

import type { Tracer } from '@opentelemetry/api'
import type { SignalStore } from '../context/store.js'
import type { SignalAttributes } from '../types/attributes.js'
import type { MiddlewareOptions } from '../types/config.js'
import { createRequestHandler } from './common.js'

/**
 * Creates the Next.js middleware function.
 *
 * **Route extraction**: prefers `request.nextUrl.pathname` (App Router's
 * `NextRequest`) and falls back to parsing `request.url` (Pages Router).
 *
 * **Header extraction**: handles both Web API `Headers` objects (which
 * have a `.get(name)` method, used by `NextRequest`) and plain header
 * objects (used by `req.headers` in Pages Router). The `getHeader`
 * function checks for `headers.get` first; if absent, treats `headers`
 * as a plain object.
 *
 * **Response status**: extracts the status code from the response
 * returned by `next()` (typically a `NextResponse` with a `status`
 * property). Defaults to 200 if no status is present.
 *
 * **Return value**: passes through the value returned by `next()` so
 * `NextResponse.next()` and similar return values flow through the
 * middleware chain unchanged.
 */
export function createNextMiddleware<T extends SignalAttributes>(
  store: SignalStore,
  tracer: Tracer,
  schemaVersion: string,
  options: MiddlewareOptions<T>,
) {
  const handleRequest = createRequestHandler<T>(store, tracer, {
    schemaVersion,
    options,
  })

  return async function nextMiddleware(
    request: { method?: string; url?: string; headers?: any; nextUrl?: { pathname: string } },
    next: () => any | Promise<any>,
  ): Promise<any> {
    const method = request.method ?? 'GET'
    const url = request.url ?? '/'
    const route = request.nextUrl?.pathname ?? new URL(url, 'http://localhost').pathname

    let response: any
    let responseStatusCode = 200

    const getHeader = (name: string): string | undefined => {
      const headers = request.headers
      if (!headers) return undefined
      // Support both Headers (Web API) and plain objects
      if (typeof headers.get === 'function') {
        return headers.get(name) ?? undefined
      }
      return headers[name] ?? headers[name.toLowerCase()]
    }

    await handleRequest(
      { method, route },
      getHeader,
      async () => {
        response = await next()
        // Try to extract status code from NextResponse
        if (response && typeof response.status === 'number') {
          responseStatusCode = response.status
        }
      },
      () => ({ statusCode: responseStatusCode }),
    )

    return response
  }
}
