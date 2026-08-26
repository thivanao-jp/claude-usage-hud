import { describe, expect, it } from 'vitest'
import { calculateCodexPace } from './codexPaceMeter'

describe('Codex pace', () => {
  const now = Date.parse('2026-08-26T12:00:00Z')
  const reset = '2026-08-26T14:00:00.000Z'

  it('calculates quota burn and range from official utilization deltas', () => {
    const pace = calculateCodexPace(40, reset, [
      { recordedAt: now - 10 * 60_000, utilization: 35, resetsAt: reset },
      { recordedAt: now, utilization: 40, resetsAt: reset },
    ], now)
    expect(pace.available).toBe(true)
    expect(pace.burnRatePercentPerMin).toBeCloseTo(0.5)
    expect(pace.minutesToLimit).toBeCloseTo(120)
    expect(pace.minutesToReset).toBeCloseTo(120)
  })

  it('does not mix samples across reset windows', () => {
    const pace = calculateCodexPace(2, reset, [
      { recordedAt: now - 10 * 60_000, utilization: 90, resetsAt: '2026-08-26T11:00:00.000Z' },
    ], now)
    expect(pace.available).toBe(false)
    expect(pace.burnRatePercentPerMin).toBeNull()
  })

  it('does not invent a burn rate while utilization is flat', () => {
    const pace = calculateCodexPace(40, reset, [
      { recordedAt: now - 10 * 60_000, utilization: 40, resetsAt: reset },
    ], now)
    expect(pace.available).toBe(false)
  })
})
