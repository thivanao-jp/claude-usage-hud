import { homedir } from 'os'
import { join } from 'path'
import { readdirSync, statSync, openSync, readSync, closeSync } from 'fs'

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects')

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
const LOOKBACK_MS = 6 * 60 * 60 * 1000   // ファイルを追跡対象にする最大の古さ
const RECENT_WINDOW_MS = 15 * 60 * 1000  // 直近バーンレート算出ウィンドウ
const MAX_INITIAL_READ = 2 * 1024 * 1024 // 新規追跡ファイルは末尾2MBのみ初期読み込み

export interface CcPaceData {
  available: boolean
  paceTokensInBlock: number | null
  burnRatePerMin: number | null
  /** このペースが続いた場合に utilization が 100% に到達するまでの分数（既に100%以上なら0） */
  minutesToLimit: number | null
  /** 5h枠リセットまでの残り分数 */
  minutesToReset: number | null
  /** utilization% から逆算した5h枠の推定トークン上限（100%相当のトークン数） */
  estimatedLimitTokens: number | null
  /** 今回のブロックで新たにキャリブレーションできたか（true なら永続化推奨） */
  calibratedNow: boolean
}

const MIN_UTIL_FOR_CALIBRATION = 5 // % 未満は逆算値が不安定なので信頼しない

interface UsageEvent {
  timestamp: number
  paceTokens: number
}

interface FileState {
  offset: number
  mtimeMs: number
  partial: string
}

const fileStates = new Map<string, FileState>()
const seenKeys = new Set<string>()
let events: UsageEvent[] = []

function walkJsonlFiles(dir: string, out: string[]): void {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) walkJsonlFiles(full, out)
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

  events.push({
    timestamp: ts,
    paceTokens: inputTokens + outputTokens + cacheCreate,
  })
}

function pollFile(path: string): void {
  let st
  try {
    st = statSync(path)
  } catch {
    return
  }

  const known = fileStates.get(path)

  // 未追跡ファイルは、最近更新されたものだけを対象にする
  if (!known && Date.now() - st.mtimeMs > LOOKBACK_MS) return
  if (known && known.mtimeMs === st.mtimeMs && known.offset === st.size) return

  const startOffset = known?.offset ?? Math.max(0, st.size - MAX_INITIAL_READ)
  if (st.size < startOffset) {
    // ファイルが縮小（ローテート等）された場合は読み直し
    fileStates.delete(path)
    return pollFile(path)
  }
  const len = st.size - startOffset
  if (len <= 0) {
    fileStates.set(path, { offset: st.size, mtimeMs: st.mtimeMs, partial: known?.partial ?? '' })
    return
  }

  let text = ''
  try {
    const fd = openSync(path, 'r')
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, startOffset)
    closeSync(fd)
    text = buf.toString('utf8')
  } catch {
    return
  }

  const combined = (known?.partial ?? '') + text
  const lines = combined.split('\n')
  const incomplete = lines.pop() ?? ''

  for (const line of lines) parseLine(line)

  fileStates.set(path, { offset: st.size, mtimeMs: st.mtimeMs, partial: incomplete })
}

/** JSONLファイルをポーリングし、新規イベントを取り込む */
export function pollCcUsage(): void {
  const files: string[] = []
  walkJsonlFiles(PROJECTS_DIR, files)
  for (const f of files) pollFile(f)

  const cutoff = Date.now() - LOOKBACK_MS
  events = events.filter(e => e.timestamp >= cutoff)

  // seenKeys が際限なく増えないよう、定期的にクリア
  if (seenKeys.size > 50000) seenKeys.clear()
}

/**
 * 5h枠の利用状況を元に、現在のバーンレートと着地予測を計算する。
 * @param fiveHourUtilization API由来の現在の5h枠使用率（%）
 * @param resetsAtIso API由来の5h枠リセット時刻（ISO文字列）
 * @param fallbackLimitTokens 過去にキャリブレーションした推定上限（今回算出できない場合のフォールバック）
 */
export function getCcPaceData(
  fiveHourUtilization: number | null,
  resetsAtIso: string | null,
  fallbackLimitTokens: number | null = null
): CcPaceData {
  const empty: CcPaceData = {
    available: events.length > 0,
    paceTokensInBlock: null,
    burnRatePerMin: null,
    minutesToLimit: null,
    minutesToReset: null,
    estimatedLimitTokens: fallbackLimitTokens,
    calibratedNow: false,
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

  const recentCutoff = now - RECENT_WINDOW_MS
  const recentEvents = blockEvents.filter(e => e.timestamp >= recentCutoff)
  const recentWindowMs = Math.min(elapsedMs, RECENT_WINDOW_MS)
  const recentTokens = recentEvents.reduce((sum, e) => sum + e.paceTokens, 0)
  const burnRatePerMin = recentWindowMs > 0 ? (recentTokens / recentWindowMs) * 60000 : null

  const minutesToReset = remainingMs / 60000

  let estimatedLimitTokens = fallbackLimitTokens
  let calibratedNow = false
  if (fiveHourUtilization != null && fiveHourUtilization > MIN_UTIL_FOR_CALIBRATION && paceTokensInBlock > 0) {
    estimatedLimitTokens = (paceTokensInBlock / fiveHourUtilization) * 100
    calibratedNow = true
  }

  let minutesToLimit: number | null = null
  if (estimatedLimitTokens != null && burnRatePerMin != null && burnRatePerMin > 0) {
    const remainingTokensToLimit = Math.max(0, estimatedLimitTokens - paceTokensInBlock)
    minutesToLimit = remainingTokensToLimit / burnRatePerMin
  }

  return {
    available: true,
    paceTokensInBlock,
    burnRatePerMin,
    minutesToLimit,
    minutesToReset,
    estimatedLimitTokens,
    calibratedNow,
  }
}
