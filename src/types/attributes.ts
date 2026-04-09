/**
 * @module canon-signal/types/attributes
 *
 * The base interface that every user-defined attribute schema extends.
 *
 * `SignalAttributes` declares the well-known attributes canon-signal sets
 * automatically (schema version, debug flag, request ID). Users extend
 * this interface to add their own application-specific attributes:
 *
 * ```ts
 * interface AppAttributes extends SignalAttributes {
 *   'app.user.id'?: string
 *   'app.customer.tier'?: 'free' | 'pro' | 'enterprise'
 * }
 * ```
 *
 * The generic parameter `T extends SignalAttributes` flows through every
 * `signal.*` method that touches attributes (`attr`, `attrs`, `getAttr`,
 * `middleware.defaultAttributes`, `harness.assertAttr`, etc.) — so
 * misspelled keys and wrong value types are compile errors.
 */

/**
 * Base attribute interface. Extend this to declare your own canonical
 * span attributes.
 *
 * The three properties below are managed by canon-signal itself:
 *
 * - `app.schema.version` — set automatically by middleware and `signal.trace()`
 *   from your `schema.version` config
 * - `app.debug` — set by `signal.keep()` to flag a trace for guaranteed export
 * - `app.request.id` — set automatically by middleware from a configurable header
 *   or generated via `crypto.randomUUID()`
 */
export interface SignalAttributes {
  'app.schema.version'?: string
  'app.debug'?: boolean
  'app.request.id'?: string
}
