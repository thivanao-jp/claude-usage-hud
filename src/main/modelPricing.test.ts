import { afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { calcPaceCostUsd, getModelPrice, getPricingCatalogSnapshot, initializeModelPricing, resolveModelPrice } from './modelPricing'

let tempDir: string | null = null
afterAll(async () => { if (tempDir) await rm(tempDir, { recursive: true, force: true }) })

describe('model pricing', () => {
  it('prices Opus 5.5 separately from Opus 5, including its 0.05x cache reads', () => {
    const resolution = resolveModelPrice('claude-opus-5-5-20260922')
    expect(resolution.matchedPrefix).toBe('claude-opus-5-5')
    expect(resolution.price).toEqual({
      input: 4e-6, output: 20e-6, cacheWrite5m: 5e-6, cacheWrite1h: 8e-6, cacheRead: 0.2e-6,
    })
  })

  it('prices Opus 5 with the official $5/$25 rates', () => {
    const price = getModelPrice('claude-opus-5-20260826')
    expect(price?.input).toBe(5e-6)
    expect(price?.output).toBe(25e-6)
  })

  it('prices Sonnet 5 with the standard $2/$10 rates', () => {
    const cost = calcPaceCostUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, 'claude-sonnet-5')
    expect(cost).toBeCloseTo(12, 8)
  })

  it('prices Fable 5.1 cache reads at the discounted 0.025x rate, not the standard 0.1x', () => {
    const price = getModelPrice('claude-fable-5-1-20260826')
    expect(price?.input).toBe(10e-6)
    expect(price?.output).toBe(50e-6)
    expect(price?.cacheRead).toBeCloseTo(0.25e-6, 12)
  })

  it('keeps Fable 5 (non-5.1) on the standard 0.1x cache read rate', () => {
    const price = getModelPrice('claude-fable-5-20260601')
    expect(price?.cacheRead).toBeCloseTo(1e-6, 12)
  })

  it('does not let the shorter claude-fable-5 prefix shadow claude-fable-5-1', () => {
    const resolution = resolveModelPrice('claude-fable-5-1-20260901')
    expect(resolution.matchedPrefix).toBe('claude-fable-5-1')
  })

  it('prices the 2026-11 models (Fable/Mythos 5.2, Sonnet 5.5, Haiku 5.5) with their own entries', () => {
    const fable52 = resolveModelPrice('claude-fable-5-2')
    expect(fable52.matchedPrefix).toBe('claude-fable-5-2')
    expect(fable52.price?.input).toBeCloseTo(8e-6, 12)
    expect(fable52.price?.cacheRead).toBeCloseTo(0.2e-6, 12)
    expect(resolveModelPrice('claude-mythos-5-2').matchedPrefix).toBe('claude-mythos-5-2')
    const sonnet55 = resolveModelPrice('claude-sonnet-5-5')
    expect(sonnet55.matchedPrefix).toBe('claude-sonnet-5-5')
    expect(sonnet55.price?.cacheRead).toBeCloseTo(0.1e-6, 12)
    const haiku55 = resolveModelPrice('claude-haiku-5-5')
    expect(haiku55.matchedPrefix).toBe('claude-haiku-5-5')
    expect(haiku55.price?.output).toBeCloseTo(0.5e-6, 12)
  })

  it('does not let claude-fable-5-2 swallow a dated Fable 5 id', () => {
    expect(resolveModelPrice('claude-fable-5-20260601').matchedPrefix).toBe('claude-fable-5')
    expect(resolveModelPrice('claude-fable-5-2-20261101').matchedPrefix).toBe('claude-fable-5-2')
    expect(resolveModelPrice('claude-sonnet-5-20260801').matchedPrefix).toBe('claude-sonnet-5')
    expect(resolveModelPrice('claude-opus-4-6[1m]').matchedPrefix).toBe('claude-opus-4-6')
  })

  it('applies Haiku 5.5 long-context prices only when the whole prompt exceeds 100K tokens', () => {
    // 10万ちょうど（キャッシュ読み込み込み）は基本単価
    const atLimit = calcPaceCostUsd({ input_tokens: 10_000, cache_read_input_tokens: 90_000, output_tokens: 1_000_000 }, 'claude-haiku-5-5')
    expect(atLimit).toBeCloseTo(10_000 * 0.1e-6 + 1_000_000 * 0.5e-6, 9)
    // キャッシュ読み込みで閾値を超えると、入力・出力とも高い単価
    const over = calcPaceCostUsd({ input_tokens: 10_000, cache_read_input_tokens: 90_001, output_tokens: 1_000_000 }, 'claude-haiku-5-5')
    expect(over).toBeCloseTo(10_000 * 0.5e-6 + 1_000_000 * 2.5e-6, 9)
    // キャッシュ書き込みの内訳もプロンプト長に数え、高い書き込み単価を使う
    const overByWrite = calcPaceCostUsd({
      input_tokens: 1_000, cache_creation_input_tokens: 120_000,
      cache_creation: { ephemeral_5m_input_tokens: 100_000, ephemeral_1h_input_tokens: 20_000 },
    }, 'claude-haiku-5-5')
    expect(overByWrite).toBeCloseTo(1_000 * 0.5e-6 + 100_000 * 0.625e-6 + 20_000 * 1e-6, 9)
    // 段階料金の無いモデルは長いプロンプトでも基本単価
    const opus = calcPaceCostUsd({ input_tokens: 500_000 }, 'claude-opus-5-5')
    expect(opus).toBeCloseTo(500_000 * 4e-6, 9)
  })

  it('uses an explicit family fallback instead of silently returning zero', () => {
    const resolution = resolveModelPrice('claude-opus-6-preview')
    expect(resolution.match).toBe('family-fallback')
    expect(resolution.matchedPrefix).toBe('claude-opus-5-5')
    expect(resolution.price?.output).toBe(20e-6)
  })

  it('still marks an unrecognizable model as unpriced', () => {
    expect(resolveModelPrice('new-provider-mystery-1')).toEqual({
      price: null, matchedPrefix: null, match: 'unpriced',
    })
  })

  it('exposes a settings-UI-friendly snapshot with catalog status and every model', () => {
    const snapshot = getPricingCatalogSnapshot()
    expect(snapshot.status.source).toBeTruthy()
    expect(snapshot.status.updatedAt).toBeTruthy()
    const fable51 = snapshot.models.find(m => m.id === 'claude-fable-5-1')
    expect(fable51?.cacheRead).toBeCloseTo(0.25e-6, 12)
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
