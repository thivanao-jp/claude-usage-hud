import { afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { calcPaceCostUsd, getModelPrice, initializeModelPricing, resolveModelPrice } from './modelPricing'

let tempDir: string | null = null
afterAll(async () => { if (tempDir) await rm(tempDir, { recursive: true, force: true }) })

describe('model pricing', () => {
  it('prices Opus 5 with the official $5/$25 rates', () => {
    const price = getModelPrice('claude-opus-5-20260826')
    expect(price?.input).toBe(5e-6)
    expect(price?.output).toBe(25e-6)
  })

  it('prices Sonnet 5 with the standard $2/$10 rates', () => {
    const cost = calcPaceCostUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, 'claude-sonnet-5')
    expect(cost).toBeCloseTo(12, 8)
  })

  it('uses an explicit family fallback instead of silently returning zero', () => {
    const resolution = resolveModelPrice('claude-opus-6-preview')
    expect(resolution.match).toBe('family-fallback')
    expect(resolution.matchedPrefix).toBe('claude-opus-5')
    expect(resolution.price?.output).toBe(25e-6)
  })

  it('still marks an unrecognizable model as unpriced', () => {
    expect(resolveModelPrice('new-provider-mystery-1')).toEqual({
      price: null, matchedPrefix: null, match: 'unpriced',
    })
  })

  it('accepts a validated data-only remote catalog and caches it', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'claude-usage-hud-pricing-'))
    const catalog = {
      _meta: { schemaVersion: 1, source: 'test', updatedAt: '2099-01-01' },
      familyFallbacks: { sonnet: 'claude-sonnet-99' },
      models: {
        'claude-sonnet-99': { in: 4e-6, out: 20e-6, cw5m: 5e-6, cw1h: 8e-6, cr: 4e-7 },
      },
    }
    const url = `data:application/json,${encodeURIComponent(JSON.stringify(catalog))}`
    const status = await initializeModelPricing(tempDir, () => {}, url)
    expect(status.source).toBe('remote')
    expect(status.updatedAt).toBe('2099-01-01')
    expect(getModelPrice('claude-sonnet-99-preview')?.output).toBe(20e-6)
  })
})
