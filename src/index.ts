/**
 * @module canon-signal
 *
 * Main entry point for canon-signal — the public API surface.
 *
 * canon-signal is an opinionated OpenTelemetry toolkit that implements
 * the trace-first observability model. The exports below are everything
 * a user needs to set up a typed signal instance:
 *
 * ```ts
 * import { createSignal, type SignalAttributes } from 'canon-signal'
 *
 * interface AppAttributes extends SignalAttributes {
 *   'app.user.id'?: string
 * }
 *
 * export const signal = createSignal<AppAttributes>({
 *   service: { name: 'my-app', version: '1.0.0', environment: 'production' },
 *   schema: { version: '1.0.0' },
 * })
 * ```
 *
 * Subpath exports for testing, bridges, and zero-config setup are
 * available under `canon-signal/testing`, `canon-signal/bridges/*`, and
 * `canon-signal/auto`.
 */

export { createSignal } from './factory/create.js'
export type { SignalAttributes } from './types/attributes.js'
export type { Signal } from './types/signal.js'
export type { CreateSignalOptions } from './types/config.js'
