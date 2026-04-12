export interface UsageEntry {
  utilization: number
  resets_at: string | null
}

export interface UsageData {
  five_hour: UsageEntry | null
  seven_day: UsageEntry | null
  seven_day_oauth_apps: UsageEntry | null
  seven_day_opus: UsageEntry | null
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
  tray: {
    show5h: boolean
    show7d: boolean
    showOauth: boolean
    showOpus: boolean
  }
  window: {
    opacity: number
    alwaysOnTop: boolean
    x?: number
    y?: number
  }
  alerts: {
    five_hour?: number
    seven_day?: number
    seven_day_oauth_apps?: number
    seven_day_opus?: number
  }
}

export interface HistoryRow {
  recorded_at: string
  five_hour: number | null
  seven_day: number | null
  seven_day_oauth_apps: number | null
  seven_day_opus: number | null
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
      onUsageUpdate: (cb: (data: {
        usage: UsageData
        profile: ProfileData
        lastSuccessAt: string | null
        isStale: boolean
      }) => void) => () => void
      onModeChanged: (cb: (mode: string) => void) => () => void
    }
  }
}
