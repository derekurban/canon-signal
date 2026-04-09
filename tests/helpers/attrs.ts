/**
 * @module tests/helpers/attrs
 *
 * Shared test attribute interface. Most tests need the same small set
 * of attributes (request ID, user ID, customer tier, error code) —
 * declaring them once here avoids drift and cuts repetition.
 */

import type { SignalAttributes } from '../../src/types/attributes.js'

/**
 * The common attribute interface used by every test that doesn't
 * need something more specific. Tests can extend this if they need
 * additional attributes.
 */
export interface TestAttrs extends SignalAttributes {
  'app.request.id': string
  'app.user.id'?: string
  'app.customer.tier'?: 'free' | 'pro' | 'enterprise'
  'app.auth.method'?: 'api_key' | 'oauth' | 'session' | 'anonymous'
  'app.transaction.type'?: 'checkout' | 'refund' | 'subscription_renewal'
  'app.cache.hit'?: boolean
  'app.error.code'?: string
  'app.error.retriable'?: boolean
  'app.job.id'?: string
  'app.job.type'?: string
}
