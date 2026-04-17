export interface UsageEntry {
  utilization: number
  resets_at: string | null
}

export interface ExtraUsage {
  is_enabled: boolean
  monthly_limit: number
  used_credits: number
  utilization: number | null
  currency?: string
}

export interface UsageData {
  five_hour: UsageEntry | null
  seven_day: UsageEntry | null
  seven_day_oauth_apps: UsageEntry | null
  seven_day_opus: UsageEntry | null
  seven_day_sonnet: UsageEntry | null
  seven_day_cowork: UsageEntry | null
  seven_day_omelette: UsageEntry | null
  extra_usage: ExtraUsage | null
}

export interface ProfileData {
  account: {
    display_name: string
    email: string
    has_claude_max: boolean
    has_claude_pro: boolean
  }
  organization: {
    name: string
    rate_limit_tier: string
  }
}

export type ViewMode = 'compact' | 'detail'

export interface Settings {
  token: string
  updateIntervalMinutes: number
  viewMode: ViewMode
  language: 'auto' | 'en' | 'ja'
  theme: 'auto' | 'dark' | 'light'
  tray: {
    show5h: boolean
    showExtra: boolean
    showFields: Record<string, boolean>  // key = WeeklyFieldDef.key
    // deprecated (migration用、削除しない)
    show7d?: boolean
    showOauth?: boolean
    showOpus?: boolean
    showSonnet?: boolean
  }
  window: {
    opacity: number
    alwaysOnTop: boolean
    compactX?: number
    compactY?: number
    detailX?: number
    detailY?: number
  }
  alerts: Record<string, number | undefined> & {
    five_hour?: number
    extra_usage?: number
  }
  pace: {
    workHoursOnly: boolean
    workDayStart: number
    workDayEnd: number
    excludeWeekends: boolean
  }
}

export interface HistoryRow {
  recorded_at: string
  five_hour: number | null
  seven_day: number | null
  seven_day_oauth_apps: number | null
  seven_day_opus: number | null
  seven_day_sonnet: number | null
  seven_day_cowork: number | null
  seven_day_omelette: number | null
  extra_usage: number | null
}

declare global {
  interface Window {
    api: {
      getUsage: () => Promise<{ usage: UsageData | null; profile: ProfileData | null }>
      getHistory: (days: number) => Promise<HistoryRow[]>
      getSettings: () => Promise<Settings>
      saveSettings: (s: Settings) => Promise<void>
      setViewMode: (mode: string) => Promise<void>
      refresh: () => Promise<void>
      openSettings: () => Promise<void>
      closeHud: () => Promise<void>
      autoDetectToken: () => Promise<string | null>
      openExternal: (url: string) => Promise<void>
      showLoginWindow: () => Promise<void>
      hideLoginWindow: () => Promise<void>
      getLoginStatus: () => Promise<'logged-in' | 'logged-out' | 'unknown'>
      onUsageUpdate: (cb: (data: {
        usage: UsageData
        profile: ProfileData
        lastSuccessAt: string | null
        isStale: boolean
      }) => void) => () => void
      onModeChanged: (cb: (mode: string) => void) => () => void
      onLoginStatusChanged: (cb: (status: 'logged-in' | 'logged-out' | 'unknown') => void) => () => void
      onSettingsChanged: (cb: (s: Settings) => void) => () => void
    }
  }
}
