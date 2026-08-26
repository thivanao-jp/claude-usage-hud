import { describe, expect, it } from 'vitest'
import { calibrationAlpha, estimateLimitFromUtilization } from './ccPaceMeter'

describe('Claude Code pace calibration', () => {
  it('rejects saturated samples that can include overshoot', () => {
    expect(estimateLimitFromUtilization(6_320_000, 100)).toBeNull()
    expect(estimateLimitFromUtilization(6_100_000, 95)).toBeNull()
  })

  it('accepts a high but non-saturated sample', () => {
    expect(estimateLimitFromUtilization(5_500_000, 94)).toBeCloseTo(5_851_063.83, 2)
  })

  it('reduces EMA weight again near saturation', () => {
    expect(calibrationAlpha(60)).toBe(0.3)
    expect(calibrationAlpha(90)).toBeLessThan(0.1)
    expect(calibrationAlpha(94)).toBeCloseTo(0.0571, 3)
  })
})
