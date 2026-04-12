import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

export type ViewMode = 'compact' | 'detail'

export interface Settings {
  token: string
  updateIntervalMinutes: number
  viewMode: ViewMode
  language: 'auto' | 'en' | 'ja'
  tray: {
    show5h: boolean
    show7d: boolean
    showOauth: boolean
    showOpus: boolean
  }
  window: {
    opacity: number        // 10〜100
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

const defaultSettings: Settings = {
  token: '',
  updateIntervalMinutes: 10,
  viewMode: 'compact',
  language: 'auto',
  tray: {
    show5h: true,
    show7d: true,
    showOauth: false,
    showOpus: false
  },
  window: {
    opacity: 90,
    alwaysOnTop: true
  },
  alerts: {}
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
    return { ...defaultSettings, ...JSON.parse(readFileSync(p, 'utf-8')) }
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(s: Settings): void {
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf-8')
}
