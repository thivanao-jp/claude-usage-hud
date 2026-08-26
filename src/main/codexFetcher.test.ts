import { describe, expect, it } from 'vitest'
import { CodexFetcher } from './codexFetcher'

describe('Codex App Server rate-limit parsing', () => {
  it('parses official primary/secondary windows and earned reset credits', () => {
    const fetcher = new CodexFetcher()
    const parsed = (fetcher as any).parseRateLimits({
      rateLimitsByLimitId: {
        codex: {
          primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_800_000_000 },
          secondary: { usedPercent: 42, windowDurationMins: 10_080, resetsAt: 1_800_604_800 },
          credits: { hasCredits: true, balance: '220.5', unlimited: false },
        },
      },
      rateLimitResetCredits: { availableCount: 2, credits: [] },
    }, 'plus')

    expect(parsed.fiveHourUtilization).toBe(25)
    expect(parsed.primaryWindowMinutes).toBe(300)
    expect(parsed.utilization).toBe(42)
    expect(parsed.secondaryWindowMinutes).toBe(10_080)
    expect(parsed.creditBalance).toBe(220.5)
    expect(parsed.rateLimitResetCreditsAvailable).toBe(2)
    expect(parsed.pace).toBeNull()
  })
})
