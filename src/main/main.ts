import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  shell,
  Notification,
  screen
} from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { loadSettings, saveSettings, Settings, ViewMode } from './settings'
import { fetchUsage, fetchProfile, UsageData, ProfileData, ApiError } from './claudeApi'
import { saveUsageHistory, getUsageHistory } from './db'
import { getTokenFromCredentials } from './credentials'

let tray: Tray | null = null
let hudWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let updateTimer: ReturnType<typeof setInterval> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null

let lastUsage: UsageData | null = null
let lastProfile: ProfileData | null = null
let lastSuccessAt: Date | null = null   // 最後に成功した時刻
let retryCount = 0                      // 連続失敗回数

// 指数バックオフ: 30s → 1m → 2m → 4m → 8m → 16m → 30m (上限)
const BACKOFF_BASE_MS = 30 * 1000
const BACKOFF_MAX_MS  = 30 * 60 * 1000
function nextBackoffMs(): number {
  return Math.min(BACKOFF_BASE_MS * Math.pow(2, retryCount), BACKOFF_MAX_MS)
}

// ---- Display Helper ----

function getActiveDisplayBounds(): Electron.Rectangle {
  const point = screen.getCursorScreenPoint()
  return screen.getDisplayNearestPoint(point).workArea
}

function centerOnActiveDisplay(w: number, h: number): { x: number; y: number } {
  const { x, y, width, height } = getActiveDisplayBounds()
  return {
    x: Math.round(x + (width - w) / 2),
    y: Math.round(y + (height - h) / 2)
  }
}

function isPositionOnSomeDisplay(x: number, y: number): boolean {
  return screen.getAllDisplays().some(d => {
    const b = d.workArea
    return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
  })
}

// ---- Window Size ----

const DETAIL_W = 360
const DETAIL_H = 580
const COMPACT_W = 320
const COMPACT_BAR_H = 42   // 1本のバーの高さ
const COMPACT_BTN_H = 28   // ボタン行の高さ
const COMPACT_PAD = 8      // 上下パディング合計

function getCompactHeight(settings: Settings): number {
  const count = [
    settings.tray.show5h,
    settings.tray.show7d,
    settings.tray.showOauth,
    settings.tray.showOpus
  ].filter(Boolean).length || 1
  return COMPACT_BTN_H + COMPACT_BAR_H * count + COMPACT_PAD
}

function getWindowSize(mode: ViewMode, settings: Settings): { w: number; h: number } {
  return mode === 'compact'
    ? { w: COMPACT_W, h: getCompactHeight(settings) }
    : { w: DETAIL_W, h: DETAIL_H }
}

// ---- HUD Window ----

function createHudWindow(): BrowserWindow {
  const settings = loadSettings()
  const { w, h } = getWindowSize(settings.viewMode, settings)

  let { x, y } =
    settings.window.x != null && settings.window.y != null &&
    isPositionOnSomeDisplay(settings.window.x, settings.window.y)
      ? { x: settings.window.x, y: settings.window.y }
      : centerOnActiveDisplay(w, h)

  const win = new BrowserWindow({
    width: w,
    height: h,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: settings.window.alwaysOnTop,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setOpacity(settings.window.opacity / 100)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('moved', () => {
    const [px, py] = win.getPosition()
    const s = loadSettings()
    s.window.x = px
    s.window.y = py
    saveSettings(s)
  })

  win.on('closed', () => { hudWindow = null })

  return win
}

function toggleHudWindow(): void {
  if (hudWindow) {
    if (hudWindow.isVisible()) {
      hudWindow.hide()
    } else {
      hudWindow.show()
      hudWindow.focus()
    }
  } else {
    hudWindow = createHudWindow()
    hudWindow.show()
  }
}

/** モード切り替え: ウィンドウのリサイズ + レンダラーへ通知 */
function switchViewMode(mode: ViewMode): void {
  const s = loadSettings()
  s.viewMode = mode
  saveSettings(s)

  if (!hudWindow || hudWindow.isDestroyed()) return
  const { w, h } = getWindowSize(mode, s)
  hudWindow.setSize(w, h)
  hudWindow.webContents.send('mode-changed', mode)
}

// ---- Tray ----

function createTray(): void {
  const iconPath = join(__dirname, '../../resources/tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setTitle('--')
  tray.setToolTip('Claude Usage HUD')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => toggleHudWindow() },
    { label: 'Compact', click: () => switchViewMode('compact') },
    { label: 'Detail', click: () => switchViewMode('detail') },
    { label: 'Settings', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: 'Refresh Now', click: () => doUpdate() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])

  tray.on('click', () => toggleHudWindow())
  tray.on('right-click', () => tray!.popUpContextMenu(contextMenu))
}

function updateTrayTitle(usage: UsageData, settings: Settings, isStale: boolean): void {
  if (!tray) return
  const parts: string[] = []
  if (settings.tray.show5h && usage.five_hour)
    parts.push(`5h:${Math.round(usage.five_hour.utilization)}%`)
  if (settings.tray.show7d && usage.seven_day)
    parts.push(`7d:${Math.round(usage.seven_day.utilization)}%`)
  if (settings.tray.showOauth && usage.seven_day_oauth_apps)
    parts.push(`oa:${Math.round(usage.seven_day_oauth_apps.utilization)}%`)
  if (settings.tray.showOpus && usage.seven_day_opus)
    parts.push(`op:${Math.round(usage.seven_day_opus.utilization)}%`)
  // staleのとき末尾に ~ をつけて古いデータであることを示す
  const title = parts.length > 0 ? parts.join(' ') + (isStale ? '~' : '') : '--'
  tray.setTitle(title)
}

// ---- Settings Window ----

function openSettingsWindow(): void {
  if (settingsWindow) { settingsWindow.focus(); return }

  const sw = 480
  const sh = 560
  const { x, y } = centerOnActiveDisplay(sw, sh)

  settingsWindow = new BrowserWindow({
    width: sw,
    height: sh,
    x,
    y,
    title: 'Settings',
    backgroundColor: '#1a1a1f',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    settingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/settings`)
  } else {
    settingsWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/settings' })
  }

  settingsWindow.on('closed', () => { settingsWindow = null })
}

// ---- Data Update ----

function sendToHud(isStale: boolean): void {
  if (!hudWindow || hudWindow.isDestroyed()) return
  hudWindow.webContents.send('usage-update', {
    usage: lastUsage,
    profile: lastProfile,
    lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
    isStale,
  })
}

async function doUpdate(): Promise<void> {
  const settings = loadSettings()
  if (!settings.token) return

  try {
    const [usage, profile] = await Promise.all([
      fetchUsage(settings.token),
      lastProfile ? Promise.resolve(lastProfile) : fetchProfile(settings.token)
    ])

    // プロフィールは変化しないので成功時のみ更新
    if (!lastProfile) lastProfile = profile

    lastUsage = usage
    lastSuccessAt = new Date()
    retryCount = 0  // 成功したのでリセット

    saveUsageHistory(usage)
    updateTrayTitle(usage, settings, false)
    checkAlerts(usage, settings)
    sendToHud(false)

  } catch (err) {
    const isRateLimit = err instanceof ApiError && err.isRateLimit
    console.warn(`Update failed (${isRateLimit ? '429 rate limit' : 'error'}):`, err)

    if (isRateLimit) {
      retryCount++
      const delay = nextBackoffMs()
      console.log(`Retry #${retryCount} in ${Math.round(delay / 1000)}s`)
      // 既存のリトライタイマーをキャンセルして再スケジュール
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = setTimeout(doUpdate, delay)
    }

    // キャッシュデータがあれば stale 表示、なければ '--'
    if (lastUsage) {
      updateTrayTitle(lastUsage, settings, true)
      sendToHud(true)
    } else {
      if (tray) tray.setTitle('--')
    }
  }
}

function scheduleUpdates(): void {
  if (updateTimer) clearInterval(updateTimer)
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  retryCount = 0

  const settings = loadSettings()
  const intervalMs = (settings.updateIntervalMinutes ?? 5) * 60 * 1000

  // 起動直後の即時呼び出しは429になりやすいので3秒後に初回実行
  setTimeout(doUpdate, 3000)
  updateTimer = setInterval(doUpdate, intervalMs)
}

// ---- Alerts ----

function checkAlerts(usage: UsageData, settings: Settings): void {
  const checks: Array<{ key: keyof UsageData; label: string }> = [
    { key: 'five_hour', label: '5-hour' },
    { key: 'seven_day', label: '7-day' },
    { key: 'seven_day_oauth_apps', label: '7-day OAuth Apps' },
    { key: 'seven_day_opus', label: '7-day Opus' }
  ]
  for (const { key, label } of checks) {
    const entry = usage[key]
    const threshold = settings.alerts?.[key]
    if (entry && threshold && entry.utilization >= threshold) {
      new Notification({
        title: 'Claude Usage HUD',
        body: `${label} usage is at ${Math.round(entry.utilization)}% (threshold: ${threshold}%)`
      }).show()
    }
  }
}

// ---- IPC Handlers ----

ipcMain.handle('get-usage', () => ({ usage: lastUsage, profile: lastProfile }))
ipcMain.handle('get-history', (_e, days: number) => getUsageHistory(days))
ipcMain.handle('get-settings', () => loadSettings())
ipcMain.handle('save-settings', (_e, settings: Settings) => {
  saveSettings(settings)
  scheduleUpdates()
  if (hudWindow && !hudWindow.isDestroyed()) {
    const s = loadSettings()
    hudWindow.setAlwaysOnTop(s.window.alwaysOnTop)
    hudWindow.setOpacity(s.window.opacity / 100)
    // コンパクト表示のバー数が変わった場合リサイズ
    if (s.viewMode === 'compact') {
      const { w, h } = getWindowSize('compact', s)
      hudWindow.setSize(w, h)
    }
  }
})
ipcMain.handle('set-view-mode', (_e, mode: ViewMode) => switchViewMode(mode))
ipcMain.handle('refresh', () => doUpdate())
ipcMain.handle('open-settings', () => openSettingsWindow())
ipcMain.handle('close-hud', () => hudWindow?.hide())
ipcMain.handle('auto-detect-token', () => getTokenFromCredentials())
ipcMain.handle('open-external', (_e, url: string) => shell.openExternal(url))

// ---- App Lifecycle ----

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (hudWindow && !hudWindow.isDestroyed()) {
      hudWindow.show()
      hudWindow.focus()
    }
  })

  app.whenReady().then(() => {
    app.dock?.hide()
    createTray()
    scheduleUpdates()
  })

  app.on('window-all-closed', (e) => { e.preventDefault() })
}
