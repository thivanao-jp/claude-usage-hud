import { CodexUsageData, Settings } from './types'

/** 追加クレジットの目安上限の既定値 */
export const DEFAULT_CREDIT_GAUGE_MAX = 1000

/**
 * バーの色の道筋。塗り 0%〜100% に等間隔で割り当てる。
 *
 *   0%（残高＝目安上限）青 → 33% 緑 → 67% 黄 → 100%（残高ゼロ）赤
 *
 * 使い込むほど赤へ寄っていく一本の流れなので、途中で色が跳ねない。
 */
const CREDIT_COLOR_RAMP = ['#4a9eff', '#54c98e', '#e0a12b', '#d92b2b'] as const

export interface CreditGauge {
  /** 消費の進み具合（0〜100）。Claude のバーと同じく、使うほど増える */
  pct: number
  color: string
  /** 塗りの分母に使った目安上限。表示ラベル用 */
  gaugeMax: number
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

/** 設定画面で自由に数値を入れられるので、0 以下や非数値は既定値に戻す */
export function normalizeCreditGaugeMax(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_CREDIT_GAUGE_MAX
}

export function creditGaugeMaxOf(settings: Settings): number {
  return normalizeCreditGaugeMax(settings.codex?.creditGaugeMax)
}

/**
 * 残高からバーの塗り具合と色を決める。
 *
 * Codex は残高しか返さないので分母が無い。そこで設定した目安上限を仮の分母にして
 * 「そこからどれだけ減ったか」を塗る。Claude のバーと向きを揃えてあるので、
 * 使い込むほど右へ伸びて % が上がる。
 *
 * 例（目安上限 1000）: 残高 750 で 25%、残高 221.35 で 78%、残高ゼロで 100%。
 * 目安上限より残高が多いうちは 0%（まだ減り始めていない）。
 */
export function calcCreditGauge(d: CodexUsageData, gaugeMax: number): CreditGauge {
  // unlimited は減らないので消費ゼロ扱い。残高不明も割合を出しようがないので同じ扱いにする。
  const balance = d.creditsUnlimited ? gaugeMax : d.creditBalance
  const pct = balance == null ? 0 : Math.max(0, Math.min(100, ((gaugeMax - balance) / gaugeMax) * 100))
  return { pct, color: rampColor(pct / 100), gaugeMax }
}

/** ランプ上の t（0〜1）の位置の色を返す */
function rampColor(t: number): string {
  const segments = CREDIT_COLOR_RAMP.length - 1
  const scaled = Math.max(0, Math.min(1, t)) * segments
  const index = Math.min(Math.floor(scaled), segments - 1)
  return mixHex(CREDIT_COLOR_RAMP[index], CREDIT_COLOR_RAMP[index + 1], scaled - index)
}

/**
 * 2色を t（0〜1）で補間する。
 *
 * RGB を直線で混ぜると緑→赤が彩度の低い草色を通ってしまい、途中が「濁った色」に見える。
 * HSL で色相を近い側に回して混ぜると、緑→黄→橙→赤／青→紫→赤 という鮮やかな経路になる。
 */
function mixHex(from: string, to: string, t: number): string {
  const a = hexToHsl(from)
  const b = hexToHsl(to)
  // 色相は環状なので、遠回り（180度超）になる場合は逆回りにする
  let dh = b[0] - a[0]
  if (dh > 180) dh -= 360
  if (dh < -180) dh += 360
  return hslToHex(
    (a[0] + dh * t + 360) % 360,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  )
}

/** #rrggbb → [色相 0-360, 彩度 0-1, 明度 0-1] */
function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map(v => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0))
          : max === g ? (b - r) / d + 2
          :             (r - g) / d + 4
  return [h * 60, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const i = Math.floor(h / 60) % 6
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][i]
  return `#${[r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`
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
