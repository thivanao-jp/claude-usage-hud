import { CodexUsageData, Settings } from './types'

/** 追加クレジットの目安上限の既定値（降順） */
export const DEFAULT_CREDIT_THRESHOLDS = { high: 1000, mid: 500, low: 100 }

export type CreditThresholds = typeof DEFAULT_CREDIT_THRESHOLDS

/**
 * バー全体の色の道筋。各閾値がそのまま色のアンカーになる。
 *
 *   残高 1000（塗り 0%）= 青 → 500（33%）= 緑 → 100（67%）= 黄 → 0（100%）= 赤
 *
 * 段ごとに「ベース色→赤」を往復させると段の境目で赤から緑へ飛んで見た目が跳ねるので、
 * 隣の段のベース色へ向けて繋ぎ、バー全体で 100% に近づくほど赤くなる一本の流れにしてある。
 */
const CREDIT_COLOR_RAMP = ['#4a9eff', '#54c98e', '#e0a12b', '#d92b2b'] as const
const CREDIT_BAND_COUNT = CREDIT_COLOR_RAMP.length - 1

export interface CreditGauge {
  /** 消費の進み具合（0〜100）。Claude のバーと同じく、使うほど増える */
  pct: number
  color: string
  /**
   * 残高が入っている段の範囲 `[下限, 上限]`。上限は最上段より多い場合 null（青天井）。
   * 表示ラベル用で、塗りの計算そのものには使わない。
   */
  band: { floor: number; ceiling: number | null }
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
 * Codex は残高しか返さないので分母が無い。そこで閾値で区切った3つの段にバーを3等分して割り当て、
 * 「今どの段の、どこまで消費したか」を通しの割合として塗る。Claude のバーと向きを揃えてあるので、
 * 使い込むほど右へ伸びて % が上がり、段を跨いでもリセットしない。
 *
 * 例（閾値 1000/500/100）: 残高 750 は最上段の半分消費で 17%、残高 221.35 は中段を 70% 消費して 57%。
 * 色は青→緑→黄→赤の一本の流れで、閾値がそのままアンカーになる（[[CREDIT_COLOR_RAMP]] 参照）。
 */
export function calcCreditGauge(d: CodexUsageData, thresholds: CreditThresholds): CreditGauge {
  const { high, mid, low } = thresholds
  // unlimited は減らないので消費ゼロ扱い。残高不明も段を決めようがないので同じ扱いにする。
  if (d.creditsUnlimited || d.creditBalance == null || d.creditBalance > high) {
    return { pct: 0, color: CREDIT_COLOR_RAMP[0], band: { floor: high, ceiling: null } }
  }
  const balance = Math.max(0, d.creditBalance)
  const [index, ceiling, floor] =
    balance > mid ? [0, high, mid] :
    balance > low ? [1, mid, low] :
                    [2, low, 0]

  // 閾値が同値だと段の幅がゼロになるので、その段は消費しきったものとして扱う
  const span = ceiling - floor
  const progress = span > 0 ? Math.max(0, Math.min(1, (ceiling - balance) / span)) : 1

  return {
    pct: ((index + progress) / CREDIT_BAND_COUNT) * 100,
    color: mixHex(CREDIT_COLOR_RAMP[index], CREDIT_COLOR_RAMP[index + 1], progress),
    band: { floor, ceiling },
  }
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

/** 残高が入っている段を `100〜500` のような範囲で表す。最上段より多い場合は上限が無い。 */
export function formatCreditBand(gauge: CreditGauge): { floor: string; ceiling: string | null } {
  return {
    floor: gauge.band.floor.toLocaleString(),
    ceiling: gauge.band.ceiling?.toLocaleString() ?? null,
  }
}

function formatCreditNumber(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
