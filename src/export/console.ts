/**
 * @module canon-signal/export/console
 *
 * Wrapper around OTel's built-in `ConsoleSpanExporter`. Outputs
 * structured JSON span data to stdout — useful in 12-factor / container
 * environments where logs and traces both go to stdout for collection.
 */

import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base'

/**
 * Creates a `ConsoleSpanExporter` instance. The exporter writes each
 * span to stdout as a JSON object with the standard OTel span shape.
 */
export function createConsoleSpanExporter() {
  return new ConsoleSpanExporter()
}
