import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

export type ViewMode = 'compact' | 'detail'

export interface Settings {
  token: string
  orgUuid?: string
  updateIntervalMinutes: number
  viewMode: ViewMode
  language: 'auto' | 'en' | 'ja'
  theme: 'auto' | 'dark' | 'light'
  tray: {
    show5h: boolean
    show7d: boolean
    showOauth: boolean
    showOpus: boolean
    showSonnet: boolean
    showExtra: boolean
  }
  window: {
    opacity: number        // 10〜100
    alwaysOnTop: boolean
    compactX?: number
    compactY?: number
    detailX?: number
    detailY?: number
  }
  alerts: {
    five_hour?: number
    seven_day?: number
    seven_day_oauth_apps?: number
    seven_day_opus?: number
    seven_day_sonnet?: number
    extra_usage?: number
  }
  pace: {
    workHoursOnly: boolean
    workDayStart: number   // 0-23
    workDayEnd: number     // 0-23
    excludeWeekends: boolean
  }
}

const defaultSettings: Settings = {
  token: '',
  updateIntervalMinutes: 10,
  viewMode: 'compact',
  language: 'auto',
  theme: 'auto',
  tray: {
    show5h: true,
    show7d: true,
    showOauth: false,
    showOpus: false,
    showSonnet: false,
    showExtra: false,
  },
  window: {
    opacity: 90,
    alwaysOnTop: true
  },
  alerts: {},
  pace: {
    workHoursOnly: false,
    workDayStart: 5,
    workDayEnd: 22,
    excludeWeekends: true,
  },
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
    return {
      ...defaultSettings,
      ...saved,
      tray:   { ...defaultSettings.tray,   ...(saved.tray   ?? {}) },
      window: { ...defaultSettings.window, ...(saved.window ?? {}) },
      alerts: { ...defaultSettings.alerts, ...(saved.alerts ?? {}) },
      pace:   { ...defaultSettings.pace,   ...(saved.pace   ?? {}) },
    }
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(s: Settings): void {
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf-8')
}
