/**
 * @module canon-signal/factory/shutdown
 *
 * Builds the `signal.shutdown()` function — multi-provider graceful
 * teardown.
 */

/**
 * The set of providers that need to be shut down. Logger and meter
 * providers are optional because earlier versions of canon-signal had
 * code paths where they weren't created.
 */
export interface ShutdownableProviders {
  tracerProvider: { shutdown(): Promise<void> }
  loggerProvider?: { shutdown(): Promise<void> }
  meterProvider?: { shutdown(): Promise<void> }
}

/**
 * Builds the `signal.shutdown()` function. Returns an idempotent async
 * function that flushes all three providers in parallel.
 *
 * Idempotency: subsequent calls after the first are no-ops. This means
 * it's safe to wire `shutdown()` into multiple signal handlers (SIGTERM,
 * SIGINT) without worrying about double-shutdown errors.
 *
 * @example
 * ```ts
 * process.on('SIGTERM', async () => {
 *   await signal.shutdown()
 *   process.exit(0)
 * })
 * ```
 */
export function createShutdownFn(providers: ShutdownableProviders) {
  let isShutdown = false

  return async function shutdown(): Promise<void> {
    if (isShutdown) return
    isShutdown = true
    await Promise.all([
      providers.tracerProvider.shutdown(),
      providers.loggerProvider?.shutdown(),
      providers.meterProvider?.shutdown(),
    ])
  }
}
