export interface CodexPacePoint {
  recordedAt: number
  utilization: number
  resetsAt: string | null
}

export interface CodexPaceData {
  provider: 'codex'
  source: 'codex-rate-limit-delta'
  available: boolean
  /** Codexの利用枠消費速度。トークン単価とは独立した quota %/分。 */
  burnRatePercentPerMin: number | null
  minutesToLimit: number | null
  minutesToReset: number | null
  sampleWindowMinutes: number | null
  sampleCount: number
}

// 設定可能な最長poll間隔(30分)でも最低2点を確保できるよう、60分を見る。
const RECENT_WINDOW_MS = 60 * 60 * 1000
const MIN_SAMPLE_SPAN_MS = 60 * 1000

export function calculateCodexPace(
  utilization: number | null,
  resetsAt: string | null,
  history: CodexPacePoint[],
  now = Date.now()
): CodexPaceData {
  const empty: CodexPaceData = {
    provider: 'codex',
    source: 'codex-rate-limit-delta',
    available: false,
    burnRatePercentPerMin: null,
    minutesToLimit: null,
    minutesToReset: null,
    sampleWindowMinutes: null,
    sampleCount: 0,
  }
  if (utilization == null || !Number.isFinite(utilization) || !resetsAt) return empty
  const resetMs = new Date(resetsAt).getTime()
  if (!Number.isFinite(resetMs) || resetMs <= now) return empty

  const points = history
    .filter(p => p.resetsAt === resetsAt
      && Number.isFinite(p.recordedAt)
      && p.recordedAt >= now - RECENT_WINDOW_MS
      && p.recordedAt <= now
      && Number.isFinite(p.utilization)
      && p.utilization <= utilization)
    .sort((a, b) => a.recordedAt - b.recordedAt)

  const oldest = points.find(p => now - p.recordedAt >= MIN_SAMPLE_SPAN_MS && utilization > p.utilization)
  const minutesToReset = (resetMs - now) / 60_000
  if (!oldest) return { ...empty, minutesToReset, sampleCount: points.length }

  const sampleWindowMinutes = (now - oldest.recordedAt) / 60_000
  const burnRatePercentPerMin = (utilization - oldest.utilization) / sampleWindowMinutes
  if (!Number.isFinite(burnRatePercentPerMin) || burnRatePercentPerMin <= 0) {
    return { ...empty, minutesToReset, sampleCount: points.length }
  }

  return {
    provider: 'codex',
    source: 'codex-rate-limit-delta',
    available: true,
    burnRatePercentPerMin,
    minutesToLimit: Math.max(0, 100 - utilization) / burnRatePercentPerMin,
    minutesToReset,
    sampleWindowMinutes,
    sampleCount: points.length,
  }
}
