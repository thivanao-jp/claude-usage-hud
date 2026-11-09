import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { diffCatalog, parseModelName, parsePerToken, parsePricingPage, serializeCatalog } from './pricing-watch.mjs'

const HEADER = [
  '## Model pricing',
  '',
  '| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |',
  '| :-- | :-- | :-- | :-- | :-- | :-- |',
]
const page = rows => [...HEADER, ...rows, '', '## Cloud platform pricing', '| Claude Opus 9 | $1 / MTok | $1 / MTok | $1 / MTok | $1 / MTok | $1 / MTok |'].join('\n')
const BASE_ROWS = [
  '| Claude Fable 5.2 | $8 / MTok | $10 / MTok | $16 / MTok | $0.20 / MTok<sup>1</sup> | $40 / MTok |',
  '| Claude Mythos 5.2 ([limited availability](https://example.com/a)) | $8 / MTok | $10 / MTok | $16 / MTok | $0.20 / MTok | $40 / MTok |',
  '| Claude Opus 4.1 ([retired, except on Claude Models on Google Cloud (Google managed) and Bedrock](https://example.com/b)) | $15 / MTok | $18.75 / MTok | $30 / MTok | $1.50 / MTok | $75 / MTok |',
  '| Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |',
  '| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok | $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |',
]

describe('pricing-watch', () => {
  it('parses names, notes with nested parentheses, and price tiers', () => {
    expect(parseModelName('Claude Opus 4.1 ([retired, except (x) y](https://e.com))').id).toBe('claude-opus-4-1')
    expect(parseModelName('Claude Haiku 3.5').id).toBe('claude-3-5-haiku')
    expect(parseModelName('Claude Haiku 5.5 (for prompts over 100,000 tokens)').tier).toEqual({ kind: 'over', tokens: 100000 })
    expect(parsePerToken(' $0.20 / MTok<sup>1</sup> ')).toBe(2e-7)
  })

  it('reads only the model pricing table and folds the long-context row into its model', () => {
    const models = parsePricingPage(page(BASE_ROWS))
    expect(Object.keys(models).sort()).toEqual(['claude-fable-5-2', 'claude-haiku-5-5', 'claude-mythos-5-2', 'claude-opus-4-1'])
    expect(models['claude-haiku-5-5'].price.cr).toBe(1e-8)
    expect(models['claude-haiku-5-5'].longContext).toEqual({ overPromptTokens: 100000, in: 5e-7, out: 2.5e-6, cw5m: 6.25e-7, cw1h: 1e-6, cr: 5e-8 })
  })

  it('fails loudly when the table layout changes instead of reading wrong columns', () => {
    const swapped = page(BASE_ROWS).replace('| Model | Base input tokens | 5m cache writes', '| Model | Output tokens | 5m cache writes')
    expect(() => parsePricingPage(swapped)).toThrow(/unexpected table header/)
    expect(() => parsePricingPage('# nothing here')).toThrow(/Model pricing/)
  })

  it('reports no changes against the shipped catalog for a page with the same prices', () => {
    const catalog = JSON.parse(readFileSync(new URL('../src/main/modelPricing.json', import.meta.url), 'utf8'))
    const result = diffCatalog(catalog, parsePricingPage(page(BASE_ROWS)), '2099-01-01')
    expect(result.hasChanges).toBe(false)
  })

  it('adds a new model, records a price change, and moves the family fallback forward', () => {
    const catalog = JSON.parse(readFileSync(new URL('../src/main/modelPricing.json', import.meta.url), 'utf8'))
    const rows = [
      '| Claude Fable 5.3 | $6 / MTok | $7.50 / MTok | $12 / MTok | $0.15 / MTok | $30 / MTok |',
      ...BASE_ROWS.map(r => r.startsWith('| Claude Fable 5.2') ? r.replace('$40 / MTok |', '$36 / MTok |') : r),
    ]
    const result = diffCatalog(catalog, parsePricingPage(page(rows)), '2099-01-01')
    expect(result.added.map(a => a.id)).toEqual(['claude-fable-5-3'])
    expect(result.changed).toEqual([{ id: 'claude-fable-5-2', diffs: ['out: $40 → $36'] }])
    expect(result.next.familyFallbacks.fable).toBe('claude-fable-5-3')
    expect(result.next._meta.updatedAt).toBe('2099-01-01')
    // 新モデルは同系列の旧モデルの直前に並ぶ
    const keys = Object.keys(result.next.models)
    expect(keys.indexOf('claude-fable-5-3')).toBe(keys.indexOf('claude-fable-5-2') - 1)
    // 既存の書き方を保ったまま書き出せる
    expect(serializeCatalog(result.next)).toContain('"cr": 1.5e-07')
  })
})
