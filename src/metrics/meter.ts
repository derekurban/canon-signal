/**
 * @module canon-signal/metrics/meter
 *
 * Implements `signal.meter()` — typed metric instrument definition.
 *
 * Users define instruments declaratively (a map of name → definition),
 * and `signal.meter()` returns a typed object where each entry has the
 * right method for its instrument type:
 *
 * - `counter` → `.add(value, labels?)`
 * - `gauge` → `.set(value, labels?)`
 * - `histogram` → `.record(value, labels?)`
 *
 * The TypeScript conditional type `InstrumentMap<D>` reads each
 * instrument's `type` literal and maps it to the right wrapper interface
 * — so `meters['app.orders.completed'].add(1)` works while
 * `meters['app.orders.completed'].record(1)` is a compile error.
 */

import type { MeterProvider } from '@opentelemetry/api'
import type { MeterInstrumentDef } from '../types/config.js'

/** Metric instrument label map — keys and values passed on emit. */
export type MetricLabels = Record<string, string | number | boolean>

/** Counter instrument wrapper. Monotonically increasing values. */
export interface CounterInstrument {
  add(value: number, labels?: MetricLabels): void
}

/** Gauge instrument wrapper. Bidirectional values. */
export interface GaugeInstrument {
  set(value: number, labels?: MetricLabels): void
}

/** Histogram instrument wrapper. Distributions with optional bucket boundaries. */
export interface HistogramInstrument {
  record(value: number, labels?: MetricLabels): void
}

/** Union of the three wrapper types — used internally for the result map. */
type InstrumentInstance = CounterInstrument | GaugeInstrument | HistogramInstrument

/**
 * Conditional type that maps a definition map to the typed instrument
 * map. For each key in `D`, the result type is determined by the
 * literal `type` field of the definition — so `meters['x'].add()`
 * autocompletes correctly if `x` is a counter, `.set()` for gauges,
 * and `.record()` for histograms.
 */
export type InstrumentMap<D extends Record<string, MeterInstrumentDef>> = {
  [K in keyof D]: D[K]['type'] extends 'counter'
    ? CounterInstrument
    : D[K]['type'] extends 'gauge'
      ? GaugeInstrument
      : D[K]['type'] extends 'histogram'
        ? HistogramInstrument
        : never
}

/**
 * Builds the `signal.meter(instruments)` function bound to a signal's
 * `MeterProvider`. The returned function takes a definition map and
 * returns a typed instrument map.
 *
 * **Gauge implementation note**: OTel's `UpDownCounter` is the closest
 * to a "gauge" but doesn't have a `set()` method (only `add()`). For
 * v0.x, `gauge.set(value)` is implemented as `upDownCounter.add(value)`,
 * which means the recorded value is treated as a *delta*, not an
 * absolute. A proper observable gauge would need a callback-based API,
 * which we'll add in a future version.
 *
 * **Histogram buckets**: passed as `advice.explicitBucketBoundaries`
 * to the OTel histogram. If omitted, OTel uses its default bucket
 * boundaries.
 *
 * @example
 * ```ts
 * const meters = signal.meter({
 *   'app.orders.completed': {
 *     type: 'counter',
 *     unit: 'orders',
 *     description: 'Total completed orders',
 *   },
 *   'app.payment.duration': {
 *     type: 'histogram',
 *     unit: 'ms',
 *     description: 'Payment processing duration',
 *     buckets: [10, 50, 100, 250, 500, 1000],
 *   },
 * })
 *
 * meters['app.orders.completed'].add(1, { region: 'us-east' })
 * meters['app.payment.duration'].record(347)
 * ```
 */
export function createMeterFn(meterProvider: MeterProvider) {
  return function meter<D extends Record<string, MeterInstrumentDef>>(
    instruments: D,
  ): InstrumentMap<D> {
    const otelMeter = meterProvider.getMeter('canon-signal')
    const result = {} as Record<string, InstrumentInstance>

    for (const [name, def] of Object.entries(instruments)) {
      switch (def.type) {
        case 'counter': {
          const counter = otelMeter.createCounter(name, {
            unit: def.unit,
            description: def.description,
          })
          result[name] = {
            add(value: number, labels?: MetricLabels) {
              counter.add(value, labels)
            },
          }
          break
        }
        case 'gauge': {
          const gauge = otelMeter.createUpDownCounter(name, {
            unit: def.unit,
            description: def.description,
          })
          result[name] = {
            set(value: number, labels?: MetricLabels) {
              // UpDownCounter doesn't have set() — values are treated as deltas.
              // A proper gauge would need ObservableGauge with a callback,
              // which is a v1+ enhancement.
              gauge.add(value, labels)
            },
          }
          break
        }
        case 'histogram': {
          const histogram = otelMeter.createHistogram(name, {
            unit: def.unit,
            description: def.description,
            advice: def.buckets ? { explicitBucketBoundaries: def.buckets } : undefined,
          })
          result[name] = {
            record(value: number, labels?: MetricLabels) {
              histogram.record(value, labels)
            },
          }
          break
        }
      }
    }

    return result as InstrumentMap<D>
  }
}
