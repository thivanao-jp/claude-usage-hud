import { homedir } from 'os'
import { join } from 'path'
import { readdir, stat, open } from 'fs/promises'
import { calcPaceCost, getPricingCatalogStatus, type PricingCatalogStatus } from './modelPricing'

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects')

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
const LOOKBACK_MS = 6 * 60 * 60 * 1000   // 通常ポーリングでファイルを追跡対象にする最大の古さ
const RECENT_WINDOW_MS = 15 * 60 * 1000  // 直近バーンレート算出ウィンドウ
const MAX_INITIAL_READ = 2 * 1024 * 1024 // 新規追跡ファイルは末尾2MBのみ初期読み込み

// ブートストラップ（初回キャリブレーション）用: より長い期間のJSONLを一度だけ読み込む
export const BOOTSTRAP_LOOKBACK_MS = 24 * 60 * 60 * 1000
const BOOTSTRAP_MAX_INITIAL_READ = 16 * 1024 * 1024
const BOOTSTRAP_MAX_BLOCKS = 4 // 過去何ブロック分まで遡ってサンプル化するか
const MAX_RECORD_GAP_MS = 15 * 60 * 1000 // 境界から遠い古いutilizationはトークンとの鮮度差が大きいため使わない

// ディレクトリ全体の再走査（readdir）はこの間隔でのみ行い、それ以外は前回のファイル一覧を再利用する
const DIR_RESCAN_INTERVAL_MS = 5 * 60 * 1000
// 最終更新がこれより古いファイルは「非アクティブ」とみなし、再走査時のみ stat する
const DORMANT_THRESHOLD_MS = LOOKBACK_MS

export interface CcPaceData {
  provider: 'claude'
  source: 'claude-code-jsonl'
  available: boolean
  paceTokensInBlock: number | null
  burnRatePerMin: number | null
  /** 直近の消費コスト（$/分） */
  burnRateCostPerMin: number | null
  /** このペースが続いた場合に推定上限（$）に到達するまでの分数（既に到達済みなら0） */
  minutesToLimit: number | null
  /** 5h枠リセットまでの残り分数 */
  minutesToReset: number | null
  /** utilization% から逆算した5h枠の推定トークン上限（100%相当のトークン数） */
  estimatedLimitTokens: number | null
  /** utilization% から逆算した5h枠の推定コスト上限（$、100%相当） */
  estimatedLimitUsd: number | null
  /** 今回のブロックで新たにキャリブレーションできたか（true なら永続化推奨） */
  calibratedNow: boolean
  /** キャリブレーションに使われたブロック数（EMAのウォームアップに使用） */
  sampleCount: number
  /** 現在使っている価格カタログ。価格表だけを更新した場合も追跡できる。 */
  pricingCatalog: PricingCatalogStatus
  /** 同系列の既知価格で概算した未知バージョン。 */
  pricingFallbackModels: string[]
  /** 系列も判別できず、コストに含められなかったモデル。 */
  unpricedModels: string[]
}

export interface HistoryPoint {
  recordedAt: number       // epoch ms
  fiveHour: number | null  // utilization%
}

export interface BootstrapResult {
  estimatedLimitTokens: number | null
  estimatedLimitUsd: number | null
  sampleCount: number
}

const MIN_UTIL_FOR_CALIBRATION = 5 // % 未満は逆算値が不安定なので信頼しない
export const MAX_UTIL_FOR_CALIBRATION = 95 // 飽和域は飛行中リクエストのオーバーシュートを含むため除外
const EMA_ALPHA_MIN = 0.05
const EMA_ALPHA_MAX = 0.3

interface UsageEvent {
  timestamp: number
  paceTokens: number
  paceCostUsd: number
  model: string | null
  pricingMatch: 'exact-prefix' | 'family-fallback' | 'unpriced'
}

interface FileState {
  offset: number
  mtimeMs: number
  partial: string
}

const fileStates = new Map<string, FileState>()
const seenKeys = new Set<string>()
let events: UsageEvent[] = []
let trackedLookbackMs = LOOKBACK_MS

// ディレクトリ再走査のキャッシュ
let lastDirScanAt = 0
let knownFiles: string[] = []
const dormantFiles = new Set<string>()

async function walkJsonlFiles(dir: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) await walkJsonlFiles(full, out)
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full)
  }
}

function parseLine(line: string): void {
  if (!line.trim()) return
  let d: Record<string, unknown>
  try {
    d = JSON.parse(line)
  } catch {
    return
  }
  if (d['type'] !== 'assistant') return

  const msg = d['message'] as Record<string, unknown> | undefined
  const usage = msg?.['usage'] as Record<string, unknown> | undefined
  if (!usage) return

  const requestId = d['requestId']
  const msgId = msg?.['id']
  if (!requestId || !msgId) return
  const key = `${msgId}|${requestId}`
  if (seenKeys.has(key)) return
  seenKeys.add(key)

  const ts = new Date(String(d['timestamp'] ?? '')).getTime()
  if (!Number.isFinite(ts)) return

  const inputTokens = Number(usage['input_tokens'] ?? 0)
  const outputTokens = Number(usage['output_tokens'] ?? 0)
  const cacheCreate = Number(usage['cache_creation_input_tokens'] ?? 0)
  const model = msg?.['model'] as string | undefined

  const cost = calcPaceCost(usage, model)
  events.push({
    timestamp: ts,
    paceTokens: inputTokens + outputTokens + cacheCreate,
    paceCostUsd: cost.usd,
    model: model ?? null,
    pricingMatch: cost.resolution.match,
  })
}

async function pollFile(path: string, lookbackMs: number, initialReadCap: number): Promise<void> {
  let st
  try {
    st = await stat(path)
  } catch {
    return
  }

  const known = fileStates.get(path)

  // 未追跡ファイルは、最近更新されたものだけを対象にする
  if (!known && Date.now() - st.mtimeMs > lookbackMs) return
  if (known && known.mtimeMs === st.mtimeMs && known.offset === st.size) return

  const startOffset = known?.offset ?? Math.max(0, st.size - initialReadCap)
  if (st.size < startOffset) {
    // ファイルが縮小（ローテート等）された場合は読み直し
    fileStates.delete(path)
    return pollFile(path, lookbackMs, initialReadCap)
  }
  const len = st.size - startOffset
  if (len <= 0) {
    fileStates.set(path, { offset: st.size, mtimeMs: st.mtimeMs, partial: known?.partial ?? '' })
    return
  }

  let text = ''
  try {
    const fh = await open(path, 'r')
    try {
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, startOffset)
      text = buf.toString('utf8')
    } finally {
      await fh.close()
    }
  } catch {
    return
  }

  const combined = (known?.partial ?? '') + text
  const lines = combined.split('\n')
  const incomplete = lines.pop() ?? ''

  for (const line of lines) parseLine(line)

  fileStates.set(path, { offset: st.size, mtimeMs: st.mtimeMs, partial: incomplete })
}

let isPolling = false

/**
 * JSONLファイルをポーリングし、新規イベントを取り込む。
 * すべてfs/promisesによる非同期I/Oで行い、Electronメインプロセスをブロックしない。
 * @param lookbackMs 通常は LOOKBACK_MS（6h）。ブートストラップ時のみ大きい値を渡し、
 *                   一度だけ広い範囲のファイルを読み込む（以後も保持される）。
 */
export async function pollCcUsage(lookbackMs: number = LOOKBACK_MS): Promise<void> {
  // 前回のポーリングが終わっていなければスキップ（多重実行防止）
  if (isPolling) return
  isPolling = true
  try {
    trackedLookbackMs = Math.max(trackedLookbackMs, lookbackMs)
    const initialReadCap = lookbackMs > LOOKBACK_MS ? BOOTSTRAP_MAX_INITIAL_READ : MAX_INITIAL_READ

    const now = Date.now()
    // ディレクトリ全体の再走査は間引く（ブートストラップ時は常に実施）
    const isRescan = lookbackMs > LOOKBACK_MS || now - lastDirScanAt > DIR_RESCAN_INTERVAL_MS || knownFiles.length === 0
    if (isRescan) {
      knownFiles = []
      await walkJsonlFiles(PROJECTS_DIR, knownFiles)
      lastDirScanAt = now
    }

    for (const f of knownFiles) {
      // 非アクティブなファイルは再走査タイミングのみ確認する（毎回のstatを省く）
      if (!isRescan && dormantFiles.has(f)) continue

      await pollFile(f, lookbackMs, initialReadCap)

      const known = fileStates.get(f)
      if (known && now - known.mtimeMs > DORMANT_THRESHOLD_MS) {
        dormantFiles.add(f)
      } else {
        dormantFiles.delete(f)
      }
    }

    const cutoff = now - trackedLookbackMs
    events = events.filter(e => e.timestamp >= cutoff)

    // seenKeys が際限なく増えないよう、定期的にクリア
    if (seenKeys.size > 50000) seenKeys.clear()
  } finally {
    isPolling = false
  }
}

/** EMAでフォールバック値とブレンドする（fallbackがnullなら現在値をそのまま採用） */
function blendEma(fallback: number | null, current: number, alpha: number): number {
  return fallback != null ? fallback * (1 - alpha) + current * alpha : current
}

/** 低使用率の丸め誤差と95%手前のオーバーシュートをともに弱く扱う。 */
export function calibrationAlpha(utilization: number): number {
  if (utilization <= 60) {
    return Math.min(EMA_ALPHA_MAX, Math.max(EMA_ALPHA_MIN, utilization / 100))
  }
  const highUtilWeight = (MAX_UTIL_FOR_CALIBRATION - utilization) / (MAX_UTIL_FOR_CALIBRATION - 60)
  return Math.min(EMA_ALPHA_MAX, Math.max(EMA_ALPHA_MIN,
    EMA_ALPHA_MIN + (EMA_ALPHA_MAX - EMA_ALPHA_MIN) * highUtilWeight))
}

export function estimateLimitFromUtilization(consumed: number, utilization: number): number | null {
  if (!Number.isFinite(consumed) || consumed <= 0) return null
  if (!Number.isFinite(utilization)
    || utilization <= MIN_UTIL_FOR_CALIBRATION
    || utilization >= MAX_UTIL_FOR_CALIBRATION) return null
  return (consumed / utilization) * 100
}

function pricingDiagnostics(sourceEvents: UsageEvent[]): Pick<CcPaceData, 'pricingCatalog' | 'pricingFallbackModels' | 'unpricedModels'> {
  const unique = (match: UsageEvent['pricingMatch']) => [...new Set(sourceEvents
    .filter(e => e.pricingMatch === match && e.model)
    .map(e => e.model as string))].sort()
  return {
    pricingCatalog: getPricingCatalogStatus(),
    pricingFallbackModels: unique('family-fallback'),
    unpricedModels: unique('unpriced'),
  }
}

/**
 * 過去の usage_history（5h枠利用率の定期スナップショット）とJSONLのトークン蓄積を
 * 突き合わせ、過去 BOOTSTRAP_MAX_BLOCKS ブロック分の「推定上限」サンプルを作る。
 * 初回起動時（ccPaceCalibration が無いとき）に呼び出し、即座に妥当な初期値を得るために使う。
 *
 * 前提: 5h枠は resetsAt を起点に5時間ごとに区切られていると仮定し、各ブロック終了時刻に
 * 最も近い（直前の）usage_history レコードの utilization を「そのブロックでの累積使用率」とみなす。
 */
export function getBootstrapEstimate(usageHistory: HistoryPoint[], resetsAtIso: string): BootstrapResult {
  const empty: BootstrapResult = { estimatedLimitTokens: null, estimatedLimitUsd: null, sampleCount: 0 }

  const resetsAt = new Date(resetsAtIso).getTime()
  if (!Number.isFinite(resetsAt)) return empty
  if (events.length === 0) return empty

  const tokenSamples: number[] = []
  const usdSamples: number[] = []

  for (let n = 1; n <= BOOTSTRAP_MAX_BLOCKS; n++) {
    const blockEnd = resetsAt - n * FIVE_HOURS_MS
    const blockStart = blockEnd - FIVE_HOURS_MS

    // blockEnd 時点（直前）に最も近い usage_history レコードを探す
    let closest: HistoryPoint | null = null
    for (const row of usageHistory) {
      if (row.fiveHour == null) continue
      if (row.recordedAt > blockEnd) continue
      if (!closest || row.recordedAt > closest.recordedAt) closest = row
    }
    if (!closest) continue
    if (blockEnd - closest.recordedAt > MAX_RECORD_GAP_MS) continue

    const utilization = closest.fiveHour as number
    if (utilization <= MIN_UTIL_FOR_CALIBRATION || utilization >= MAX_UTIL_FOR_CALIBRATION) continue

    // utilization と同じ観測時刻までのイベントだけを分子にし、鮮度差による過大推定を防ぐ。
    const blockEvents = events.filter(e => e.timestamp >= blockStart && e.timestamp <= closest!.recordedAt)
    const tokens = blockEvents.reduce((sum, e) => sum + e.paceTokens, 0)
    const usd = blockEvents.reduce((sum, e) => sum + e.paceCostUsd, 0)
    if (tokens <= 0) continue

    const tokenEstimate = estimateLimitFromUtilization(tokens, utilization)
    const usdEstimate = estimateLimitFromUtilization(usd, utilization)
    if (tokenEstimate != null) tokenSamples.push(tokenEstimate)
    if (usdEstimate != null) usdSamples.push(usdEstimate)
  }

  const avg = (arr: number[]): number | null =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null

  return {
    estimatedLimitTokens: avg(tokenSamples),
    estimatedLimitUsd: avg(usdSamples),
    sampleCount: tokenSamples.length,
  }
}

/**
 * 5h枠の利用状況を元に、現在のバーンレートと着地予測を計算する。
 * @param fiveHourUtilization API由来の現在の5h枠使用率（%）
 * @param resetsAtIso API由来の5h枠リセット時刻（ISO文字列）
 * @param fallbackLimitTokens 過去にキャリブレーションした推定トークン上限（フォールバック）
 * @param fallbackLimitUsd 過去にキャリブレーションした推定コスト上限（$、フォールバック）
 * @param fallbackSampleCount これまでにクロスブロックでブレンドした回数（EMAウォームアップ用）
 * @param fallbackLastResetsAt 前回クロスブロックでブレンドした際の resetsAt（ブロック切り替え検知用）
 * @param utilizationObservedAt API使用率を観測した時刻。校正の分子もこの時刻までに揃える。
 */
export function getCcPaceData(
  fiveHourUtilization: number | null,
  resetsAtIso: string | null,
  fallbackLimitTokens: number | null = null,
  fallbackLimitUsd: number | null = null,
  fallbackSampleCount = 0,
  fallbackLastResetsAt: string | null = null,
  utilizationObservedAt: number | null = null
): CcPaceData {
  const diagnostics = pricingDiagnostics(events)
  const empty: CcPaceData = {
    provider: 'claude',
    source: 'claude-code-jsonl',
    available: events.length > 0,
    paceTokensInBlock: null,
    burnRatePerMin: null,
    burnRateCostPerMin: null,
    minutesToLimit: null,
    minutesToReset: null,
    estimatedLimitTokens: fallbackLimitTokens,
    estimatedLimitUsd: fallbackLimitUsd,
    calibratedNow: false,
    sampleCount: fallbackSampleCount,
    ...diagnostics,
  }
  if (events.length === 0) return empty
  if (!resetsAtIso) return empty

  const resetsAt = new Date(resetsAtIso).getTime()
  if (!Number.isFinite(resetsAt)) return empty

  const now = Date.now()
  const blockStart = resetsAt - FIVE_HOURS_MS
  const elapsedMs = now - blockStart
  const remainingMs = resetsAt - now
  if (elapsedMs <= 0 || remainingMs <= 0) return empty

  const blockEvents = events.filter(e => e.timestamp >= blockStart && e.timestamp <= now)
  const paceTokensInBlock = blockEvents.reduce((sum, e) => sum + e.paceTokens, 0)
  const paceCostUsdInBlock = blockEvents.reduce((sum, e) => sum + e.paceCostUsd, 0)

  const recentCutoff = now - RECENT_WINDOW_MS
  const recentEvents = blockEvents.filter(e => e.timestamp >= recentCutoff)
  const recentWindowMs = Math.min(elapsedMs, RECENT_WINDOW_MS)
  const recentTokens = recentEvents.reduce((sum, e) => sum + e.paceTokens, 0)
  const recentCostUsd = recentEvents.reduce((sum, e) => sum + e.paceCostUsd, 0)
  const burnRatePerMin = recentWindowMs > 0 ? (recentTokens / recentWindowMs) * 60000 : null
  const burnRateCostPerMin = recentWindowMs > 0 ? (recentCostUsd / recentWindowMs) * 60000 : null

  const minutesToReset = remainingMs / 60000

  let estimatedLimitTokens = fallbackLimitTokens
  let estimatedLimitUsd = fallbackLimitUsd
  let calibratedNow = false
  let sampleCount = fallbackSampleCount

  const observedAt = utilizationObservedAt != null && Number.isFinite(utilizationObservedAt)
    ? Math.min(now, utilizationObservedAt)
    : now
  const calibrationEvents = blockEvents.filter(e => e.timestamp <= observedAt)
  const calibrationTokens = calibrationEvents.reduce((sum, e) => sum + e.paceTokens, 0)
  const calibrationUsd = calibrationEvents.reduce((sum, e) => sum + e.paceCostUsd, 0)

  if (fiveHourUtilization != null
    && fiveHourUtilization > MIN_UTIL_FOR_CALIBRATION
    && fiveHourUtilization < MAX_UTIL_FOR_CALIBRATION
    && observedAt >= blockStart
    && calibrationTokens > 0) {
    const currentEstimateTokens = estimateLimitFromUtilization(calibrationTokens, fiveHourUtilization)!
    const currentEstimateUsd = estimateLimitFromUtilization(calibrationUsd, fiveHourUtilization)

    if (fallbackLimitTokens == null) {
      // 初回（ブートストラップ未実施 or 失敗）: そのまま採用
      estimatedLimitTokens = currentEstimateTokens
      estimatedLimitUsd = currentEstimateUsd
      sampleCount = 1
    } else {
      const isNewBlock = fallbackLastResetsAt !== resetsAtIso
      const utilAlpha = calibrationAlpha(fiveHourUtilization)
      let alpha: number
      if (isNewBlock) {
        // ブロック跨ぎ: サンプル数に応じたウォームアップ係数（1/(n+1)）と utilization 係数の小さい方を採用
        const warmupAlpha = 1 / (fallbackSampleCount + 1)
        alpha = Math.min(EMA_ALPHA_MAX, Math.max(EMA_ALPHA_MIN, Math.min(utilAlpha, warmupAlpha)))
        sampleCount = fallbackSampleCount + 1
      } else {
        // 同一ブロック内: そのブロックの比率へ素早く収束させる
        alpha = utilAlpha
      }
      estimatedLimitTokens = blendEma(fallbackLimitTokens, currentEstimateTokens, alpha)
      if (currentEstimateUsd != null) {
        estimatedLimitUsd = blendEma(fallbackLimitUsd, currentEstimateUsd, alpha)
      }
    }
    calibratedNow = true
  }

  // 航続時間: $ベースで計算できる場合はそちらを優先、できなければトークンベースにフォールバック
  let minutesToLimit: number | null = null
  if (estimatedLimitUsd != null && estimatedLimitUsd > 0 && burnRateCostPerMin != null && burnRateCostPerMin > 0) {
    const remainingUsdToLimit = Math.max(0, estimatedLimitUsd - paceCostUsdInBlock)
    minutesToLimit = remainingUsdToLimit / burnRateCostPerMin
  } else if (estimatedLimitTokens != null && burnRatePerMin != null && burnRatePerMin > 0) {
    const remainingTokensToLimit = Math.max(0, estimatedLimitTokens - paceTokensInBlock)
    minutesToLimit = remainingTokensToLimit / burnRatePerMin
  }

  return {
    provider: 'claude',
    source: 'claude-code-jsonl',
    available: true,
    paceTokensInBlock,
    burnRatePerMin,
    burnRateCostPerMin,
    minutesToLimit,
    minutesToReset,
    estimatedLimitTokens,
    estimatedLimitUsd,
    calibratedNow,
    sampleCount,
    ...pricingDiagnostics(blockEvents),
  }
}
