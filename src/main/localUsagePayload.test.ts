import { describe, expect, it } from 'vitest'
import { buildLocalUsagePayload } from './localUsagePayload'
import type { BetaProvidersData, UsageData } from './claudeApi'
import type { CcPaceData } from './ccPaceMeter'

describe('local usage API contract', () => {
  it('keeps Claude Code and Codex pace in separate provider namespaces', () => {
    const claudePace = {
      provider: 'claude', source: 'claude-code-jsonl', available: true,
      paceTokensInBlock: 1, burnRatePerMin: 1, burnRateCostPerMin: 1,
      minutesToLimit: 1, minutesToReset: 1, estimatedLimitTokens: 1,
      estimatedLimitUsd: 1, calibratedNow: false, sampleCount: 1,
      pricingCatalog: { source: 'bundled', updatedAt: '2026-08-26', reference: 'test' },
      pricingFallbackModels: [], unpricedModels: [],
    } satisfies CcPaceData
    const codexPace = {
      provider: 'codex', source: 'codex-rate-limit-delta', available: true,
    }
    const beta = {
      copilot: null,
      codex: { pace: codexPace },
    } as BetaProvidersData

    const payload = buildLocalUsagePayload({
      usage: { five_hour: { utilization: 10, resets_at: null } } as UsageData,
      lastUpdated: '2026-08-26T00:00:00.000Z',
      beta,
      claudePace,
      generatedAt: '2026-08-26T00:00:01.000Z',
    }) as any

    expect(payload.schema_version).toBe(2)
    expect(payload.cc_pace.provider).toBe('claude')
    expect(payload.claude_code_pace.source).toBe('claude-code-jsonl')
    expect(payload.providers.claude.pace.provider).toBe('claude')
    expect(payload.providers.codex.pace.provider).toBe('codex')
    expect(payload.providers.codex.pace.source).toBe('codex-rate-limit-delta')
  })
})
