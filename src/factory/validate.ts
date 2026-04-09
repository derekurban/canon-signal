/**
 * @module canon-signal/factory/validate
 *
 * Schema validation that runs before any provider setup.
 */

import type { SignalAttributes } from '../types/attributes.js'
import type { SchemaConfig } from '../types/config.js'

/**
 * Validates the schema metadata. Currently enforces one rule:
 * **prohibited attributes cannot be defined**.
 *
 * This runs before OTel provider setup so a misconfigured schema fails
 * fast at startup with a clear error message rather than emitting
 * dangerous data to telemetry.
 *
 * @throws {Error} If any attribute in `schema.meta` has `sensitivity: 'prohibited'`. Error message identifies the offending attribute.
 */
export function validateSchema<T extends SignalAttributes>(schema: SchemaConfig<T>): void {
  if (!schema.meta) return

  for (const [key, meta] of Object.entries(schema.meta)) {
    if (meta && (meta as any).sensitivity === 'prohibited') {
      throw new Error(
        `canon-signal: Attribute "${key}" has sensitivity "prohibited" and cannot be used. ` +
        'Remove it from your schema or change its sensitivity classification.',
      )
    }
  }
}
