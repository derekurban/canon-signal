/**
 * @module canon-signal/export/console
 *
 * Wrappers around OTel's built-in console exporters.
 *
 * The `console` destination is intentionally the "raw structured output"
 * family across all three signals:
 *
 * - traces → `ConsoleSpanExporter`
 * - logs → `ConsoleLogRecordExporter`
 * - metrics → `ConsoleMetricExporter`
 *
 * We keep these thin so canon-signal only owns the higher-level
 * ergonomics (`pretty-console`, `file`, config merging) while the raw
 * console exporters stay close to the upstream OTel SDK.
 */

import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base'
import { ConsoleLogRecordExporter } from '@opentelemetry/sdk-logs'
import { ConsoleMetricExporter } from '@opentelemetry/sdk-metrics'

/**
 * Creates a `ConsoleSpanExporter` instance. The exporter writes each
 * span to stdout as a JSON object with the standard OTel span shape.
 */
export function createConsoleSpanExporter() {
  return new ConsoleSpanExporter()
}

/**
 * Creates a `ConsoleLogRecordExporter` instance. Each log record is
 * printed with the stock OTel console representation.
 */
export function createConsoleLogExporter() {
  return new ConsoleLogRecordExporter()
}

/**
 * Creates a `ConsoleMetricExporter` instance. Metric batches are
 * rendered by the upstream OTel console formatter and are intended
 * primarily for local diagnostics.
 */
export function createConsoleMetricExporter() {
  return new ConsoleMetricExporter()
}
