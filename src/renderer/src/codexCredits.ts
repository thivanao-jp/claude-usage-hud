import { CodexUsageData } from './types'

/** EX バーの色（Claude の Extra Usage と揃える） */
export const CODEX_CREDITS_COLOR = '#a78bfa'

/**
 * 追加クレジットの行を出すべきか。
 *
 * クレジットを持たないアカウントでは Codex 側が `hasCredits: false` を返すので、
 * Claude の Extra Usage が `is_enabled` のときだけ出るのと同じ扱いにする。
 */
export function hasCodexCredits(d: CodexUsageData | null | undefined): boolean {
  return !!d?.hasCredits
}

/**
 * 残高の表示文字列。unlimited のアカウントは残高を持たないので ∞ を返す。
 * balance は API 上 `"222.6778700000"` のような長い小数なので 2 桁に丸める。
 */
export function formatCreditBalance(d: CodexUsageData, unlimitedLabel = '∞'): string {
  if (d.creditsUnlimited) return unlimitedLabel
  if (d.creditBalance == null) return '—'
  return d.creditBalance.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
