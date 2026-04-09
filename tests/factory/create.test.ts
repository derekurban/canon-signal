import { describe, it, expect } from 'vitest'
import { createSignal } from '../../src/index'
import { createTestSignal } from '../helpers/setup'
import type { TestAttrs } from '../helpers/attrs'

describe('createSignal', () => {
  it('returns a signal instance with all expected methods', () => {
    const { signal } = createTestSignal()

    expect(signal.attr).toBeTypeOf('function')
    expect(signal.attrs).toBeTypeOf('function')
    expect(signal.getAttr).toBeTypeOf('function')
    expect(signal.traceId).toBeTypeOf('function')
    expect(signal.span).toBeTypeOf('function')
    expect(signal.trace).toBeTypeOf('function')
    expect(signal.link).toBeTypeOf('function')
    expect(signal.event).toBeTypeOf('function')
    expect(signal.error).toBeTypeOf('function')
    expect(signal.keep).toBeTypeOf('function')
    expect(signal.shutdown).toBeTypeOf('function')
    expect(signal.middleware).toBeTypeOf('function')
    expect(signal.schema).toBeTypeOf('function')
    expect(signal.log).toBeDefined()
    expect(signal.systemLog).toBeDefined()
    expect(signal.test).toBeDefined()
  })

  it('returns correct schema introspection', () => {
    const { signal } = createTestSignal<TestAttrs>({
      schema: {
        version: '2.0.0',
        meta: {
          'app.user.id': { sensitivity: 'internal', description: 'User ID' },
        },
      },
    })

    const schema = signal.schema()
    expect(schema.version).toBe('2.0.0')
    expect(schema.meta?.['app.user.id']?.sensitivity).toBe('internal')
  })

  it('throws when schema has prohibited sensitivity', () => {
    expect(() => {
      createSignal<TestAttrs>({
        service: { name: 'test', version: '0.0.1', environment: 'test' },
        schema: {
          version: '1.0.0',
          meta: {
            'app.user.id': { sensitivity: 'prohibited' },
          },
        },
      })
    }).toThrow('prohibited')
  })

  it('traceId returns undefined outside request scope', () => {
    const { signal } = createTestSignal()
    expect(signal.traceId()).toBeUndefined()
  })

  it('attr throws outside request scope', () => {
    const { signal } = createTestSignal()
    expect(() => signal.attr('app.user.id', 'test')).toThrow('outside a request scope')
  })
})
