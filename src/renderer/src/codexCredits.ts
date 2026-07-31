import { CodexUsageData, Settings } from './types'

/** 追加クレジットの目安上限の既定値（降順） */
export const DEFAULT_CREDIT_THRESHOLDS = { high: 1000, mid: 500, low: 100 }

export type CreditThresholds = typeof DEFAULT_CREDIT_THRESHOLDS

/**
 * 残高が入る段ごとの色。下の段（残り少ない）ほど危機感のある色にする。
 * `above` は最上段より多い＝当面余裕がある状態で、Claude の Extra Usage と同じ紫。
 */
const CREDIT_BUCKET_COLORS = {
  above: '#a78bfa',
  high:  '#e0a12b',
  mid:   '#e05a2b',
  low:   '#d92b2b',
} as const

export interface CreditGauge {
  /** 目安上限に対する残高の割合（0〜100） */
  pct: number
  color: string
  /** バーの分母に使った目安上限。最上段より多い場合は青天井なので null */
  gaugeMax: number | null
}

/**
 * 追加クレジットの行を出すべきか。
 *
 * クレジットを持たないアカウントでは Codex 側が `hasCredits: false` を返すので、
 * Claude の Extra Usage が `is_enabled` のときだけ出るのと同じ扱いにする。
 */
export function hasCodexCredits(d: CodexUsageData | null | undefined): d is CodexUsageData {
  return !!d?.hasCredits
}

/**
 * 設定値を降順の3段階に正規化する。
 *
 * 設定画面で自由に数値を入れられるので、順序が入れ替わっていたり 0 以下だったりしても
 * 段が壊れないようにここで吸収する（不正な値はその段だけ既定値に戻す）。
 */
export function normalizeCreditThresholds(thresholds?: Partial<CreditThresholds>): CreditThresholds {
  const valid = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback
  const [high, mid, low] = [
    valid(thresholds?.high, DEFAULT_CREDIT_THRESHOLDS.high),
    valid(thresholds?.mid, DEFAULT_CREDIT_THRESHOLDS.mid),
    valid(thresholds?.low, DEFAULT_CREDIT_THRESHOLDS.low),
  ].sort((a, b) => b - a)
  return { high, mid, low }
}

export function creditThresholdsOf(settings: Settings): CreditThresholds {
  return normalizeCreditThresholds(settings.codex?.creditThresholds)
}

/**
 * 残高からバーの塗り具合と色を決める。
 *
 * Codex は「使った量 / 上限」を返さないので分母が無い。代わりに残高が入る段の上限を
 * 仮の分母として使う（例: 閾値 1000/500/100 で残高 222.68 なら 500 を分母に 45%）。
 * 段が下がるほど色が赤に寄るので、同じ塗り具合でも危機感が伝わる。
 */
export function calcCreditGauge(d: CodexUsageData, thresholds: CreditThresholds): CreditGauge {
  // unlimited は減らないので満タン扱い。残高不明も段を決めようがないので同じ扱いにする。
  if (d.creditsUnlimited || d.creditBalance == null) {
    return { pct: 100, color: CREDIT_BUCKET_COLORS.above, gaugeMax: null }
  }
  const balance = Math.max(0, d.creditBalance)
  const { high, mid, low } = thresholds
  if (balance <= low)  return { pct: ratio(balance, low),  color: CREDIT_BUCKET_COLORS.low,  gaugeMax: low }
  if (balance <= mid)  return { pct: ratio(balance, mid),  color: CREDIT_BUCKET_COLORS.mid,  gaugeMax: mid }
  if (balance <= high) return { pct: ratio(balance, high), color: CREDIT_BUCKET_COLORS.high, gaugeMax: high }
  return { pct: 100, color: CREDIT_BUCKET_COLORS.above, gaugeMax: null }
}

function ratio(balance: number, gaugeMax: number): number {
  return Math.max(0, Math.min(100, (balance / gaugeMax) * 100))
}

interface FormatOptions {
  /** unlimited なアカウントに出す文字列。省略時は ∞（狭いビュー向け） */
  unlimitedLabel?: string
  /** 残高に付ける単位。unlimited / 不明のときは付かない */
  unit?: string
}

/**
 * 残高の表示文字列。balance は API 上 `"222.6778700000"` のような長い小数なので 2 桁に丸める。
 *
 * unlimited と「値が取れなかった」は残高を持たないので、単位を付けずに記号だけを返す
 * （`無制限cr` のような文字列にならないようにする）。
 */
export function formatCreditBalance(d: CodexUsageData, { unlimitedLabel = '∞', unit = '' }: FormatOptions = {}): string {
  if (d.creditsUnlimited) return unlimitedLabel
  if (d.creditBalance == null) return '—'
  return `${formatCreditNumber(d.creditBalance)}${unit}`
}

/**
 * 残高と目安上限を `222.68/500` の形にまとめる（Claude の Extra Usage の `164/2,000` に合わせる）。
 * 目安上限が無い（最上段より多い / unlimited / 不明）ときは残高だけを返す。
 */
export function formatCreditBalanceOverMax(d: CodexUsageData, gauge: CreditGauge, { unlimitedLabel = '∞', unit = '' }: FormatOptions = {}): string {
  if (d.creditsUnlimited) return unlimitedLabel
  if (d.creditBalance == null) return '—'
  const balance = formatCreditNumber(d.creditBalance)
  if (gauge.gaugeMax == null) return `${balance}${unit}`
  return `${balance}/${gauge.gaugeMax.toLocaleString()}${unit}`
}

/**
 * ゲージの割合表示。unlimited や残高不明のときは割合に意味がないので空文字を返す
 * （`—` の隣に `100%` が並ぶような矛盾した表示を防ぐ）。
 */
export function formatGaugePct(d: CodexUsageData, gauge: CreditGauge): string {
  if (d.creditsUnlimited || d.creditBalance == null) return ''
  return `${Math.round(gauge.pct)}%`
}

function formatCreditNumber(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
