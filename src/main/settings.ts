import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

export type ViewMode = 'compact' | 'detail' | 'ultra'

export type UltraPosition = 'top-left' | 'top-center' | 'top-right'

export interface Settings {
  token: string
  orgUuid?: string
  launchAtLogin: boolean
  autoUpdate: boolean
  updateIntervalMinutes: number
  viewMode: ViewMode
  language: 'auto' | 'en' | 'ja'
  theme: 'auto' | 'dark' | 'light'
  tray: {
    show5h: boolean
    showExtra: boolean
    showFields: Record<string, boolean>  // key = WeeklyFieldDef.key
    showCodexPrimary?: boolean
    showCodexSecondary?: boolean
    showCodexCredits?: boolean
    // deprecated (migration用、削除しない)
    show7d?: boolean
    showOauth?: boolean
    showOpus?: boolean
    showSonnet?: boolean
  }
  window: {
    opacity: number        // 10〜100
    alwaysOnTop: boolean
    clickThrough?: boolean  // バー部分をクリックスルーするか
    compactX?: number
    compactY?: number
    detailX?: number
    detailY?: number
    ultraPosition?: UltraPosition
  }
  alerts: Record<string, number | undefined> & {
    five_hour?: number
    extra_usage?: number
  }
  pace: {
    workHoursOnly: boolean
    workDayStart: number   // 0-23
    workDayEnd: number     // 0-23
    excludeWeekends: boolean
  }
  betaProviders?: {
    copilot?: { enabled: boolean }
  }
  codex?: {
    enabled: boolean
    /**
     * 追加クレジットバーの目安上限。Codex は残高しか返さず分母が無いので、
     * この値を仮の分母にして「そこからどれだけ減ったか」を塗る。
     */
    creditGaugeMax?: number
  }
  /** cc-pace-meter: 5h枠の推定上限のキャリブレーション結果（直近の信頼できる値を永続化） */
  ccPaceCalibration?: {
    estimatedLimitTokens: number
    estimatedLimitUsd?: number
    /** クロスブロックでブレンドした回数（ブートストラップ分含む、EMAウォームアップ用） */
    sampleCount?: number
    /** 直近のクロスブロック更新で使用した resetsAt（ブロック切り替え検知用） */
    lastResetsAt?: string
    updatedAt: string
  }
}

/** 追加クレジットの目安上限の既定値 */
export const DEFAULT_CREDIT_GAUGE_MAX = 1000

const defaultSettings: Settings = {
  token: '',
  launchAtLogin: false,
  autoUpdate: true,
  updateIntervalMinutes: 10,
  viewMode: 'compact',
  language: 'auto',
  theme: 'auto',
  tray: {
    show5h: true,
    showExtra: false,
    showFields: {
      seven_day: true,
      seven_day_oauth_apps: false,
      seven_day_opus: false,
      seven_day_sonnet: false,
      seven_day_cowork: false,
      seven_day_omelette: false,
      iguana_necktie: false,
      omelette_promotional: false,
    },
    showCodexPrimary: true,
    showCodexSecondary: true,
    showCodexCredits: true,
  },
  window: {
    opacity: 90,
    alwaysOnTop: true,
    clickThrough: true,
  },
  alerts: {},
  pace: {
    workHoursOnly: false,
    workDayStart: 5,
    workDayEnd: 22,
    excludeWeekends: true,
  },
  codex: { enabled: false, creditGaugeMax: DEFAULT_CREDIT_GAUGE_MAX },
}

function settingsPath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.json')
}

export function loadSettings(): Settings {
  const p = settingsPath()
  if (!existsSync(p)) return { ...defaultSettings }
  try {
    const saved = JSON.parse(readFileSync(p, 'utf-8'))
    const merged: Settings = {
      ...defaultSettings,
      ...saved,
      tray:   { ...defaultSettings.tray,   ...(saved.tray   ?? {}) },
      window: { ...defaultSettings.window, ...(saved.window ?? {}) },
      alerts: { ...defaultSettings.alerts, ...(saved.alerts ?? {}) },
      pace:   { ...defaultSettings.pace,   ...(saved.pace   ?? {}) },
      codex:  { ...defaultSettings.codex,  ...(saved.codex  ?? {}) },
    }
    // 旧フォーマットからの移行
    if (!saved.tray?.showFields) {
      const t = saved.tray ?? {}
      merged.tray.showFields = {
        seven_day: t.show7d ?? true,
        seven_day_oauth_apps: t.showOauth ?? false,
        seven_day_opus: t.showOpus ?? false,
        seven_day_sonnet: t.showSonnet ?? false,
        seven_day_cowork: false,
        seven_day_omelette: false,
        iguana_necktie: false,
        omelette_promotional: false,
      }
    }
    // v1.0: Codex はβプロバイダーから正式プロバイダー設定へ移行する。
    if (!saved.codex && saved.betaProviders?.codex) merged.codex = { ...merged.codex, ...saved.betaProviders.codex }
    return merged
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(s: Settings): void {
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf-8')
}
