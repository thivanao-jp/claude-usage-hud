import { CodexUsageData } from './types'

/** EX バーの色（Claude の Extra Usage と揃える） */
export const CODEX_CREDITS_COLOR = '#a78bfa'

/**
 * 追加クレジットの行を出すべきか。
 *
 * クレジットを持たないアカウントでは Codex 側が `hasCredits: false` を返すので、
 * Claude の Extra Usage が `is_enabled` のときだけ出るのと同じ扱いにする。
 */
export function hasCodexCredits(d: CodexUsageData | null | undefined): d is CodexUsageData {
  return !!d?.hasCredits
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
  const balance = d.creditBalance.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${balance}${unit}`
}
