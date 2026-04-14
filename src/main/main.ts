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
import { appendFileSync, mkdirSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { loadSettings, saveSettings, Settings, ViewMode } from './settings'
import { UsageData, ProfileData } from './claudeApi'
import { saveUsageHistory, getUsageHistory } from './db'
import { getTokenFromCredentials } from './credentials'
import { ClaudeWebFetcher } from './claudeWebFetcher'
import { createBarIcon } from './trayIcon'

// stdoutがバッファリングされることがあるため、ログは直接ファイルに書き込む
// app.getPath('logs') はプラットフォームに応じた適切なディレクトリを返す
// macOS: ~/Library/Logs/<appName>/  Windows: %APPDATA%\<appName>\logs\
const LOG_DIR = app.getPath('logs')
const LOG_PATH = join(LOG_DIR, 'claude-usage-hud.log')
try { mkdirSync(LOG_DIR, { recursive: true }) } catch {}
function log(...args: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`
  try { appendFileSync(LOG_PATH, line) } catch {}
  console.log(...args)
}

let tray: Tray | null = null
let hudWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let updateTimer: ReturnType<typeof setInterval> | null = null

const claudeWebFetcher = new ClaudeWebFetcher()

let lastUsage: UsageData | null = null
let lastProfile: ProfileData | null = null
let lastSuccessAt: Date | null = null

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
const COMPACT_BAR_H = 46   // 1本のバーの高さ（ペースライン含む）
const COMPACT_BTN_H = 28   // ボタン行の高さ
const COMPACT_PAD = 8      // 上下パディング合計

function getCompactHeight(settings: Settings): number {
  const count = [
    settings.tray.show5h,
    settings.tray.show7d,
    settings.tray.showOauth,
    settings.tray.showOpus,
    settings.tray.showSonnet,
    settings.tray.showExtra,
  ].filter(Boolean).length || 1
  return COMPACT_BTN_H + COMPACT_BAR_H * count + COMPACT_PAD
}

function getWindowSize(mode: ViewMode, settings: Settings): { w: number; h: number } {
  return mode === 'compact'
    ? { w: COMPACT_W, h: getCompactHeight(settings) }
    : { w: DETAIL_W, h: DETAIL_H }
}

// ---- HUD Window ----

function getSavedPosition(mode: ViewMode, settings: Settings): { x: number; y: number } | null {
  const cx = mode === 'compact' ? settings.window.compactX : settings.window.detailX
  const cy = mode === 'compact' ? settings.window.compactY : settings.window.detailY
  if (cx != null && cy != null && isPositionOnSomeDisplay(cx, cy)) return { x: cx, y: cy }
  return null
}

function saveWindowPosition(mode: ViewMode, px: number, py: number): void {
  const s = loadSettings()
  if (mode === 'compact') {
    s.window.compactX = px
    s.window.compactY = py
  } else {
    s.window.detailX = px
    s.window.detailY = py
  }
  saveSettings(s)
}

function createHudWindow(): BrowserWindow {
  const settings = loadSettings()
  const mode = settings.viewMode
  const { w, h } = getWindowSize(mode, settings)

  const savedPos = getSavedPosition(mode, settings)
  const { x, y } = savedPos ?? centerOnActiveDisplay(w, h)

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
    saveWindowPosition(loadSettings().viewMode, px, py)
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

/** モード切り替え: 現在位置を保存 → リサイズ → 保存済み位置に移動 */
function switchViewMode(mode: ViewMode): void {
  const s = loadSettings()

  // 現在のモードの位置を保存
  if (hudWindow && !hudWindow.isDestroyed()) {
    const [px, py] = hudWindow.getPosition()
    if (s.viewMode === 'compact') {
      s.window.compactX = px
      s.window.compactY = py
    } else {
      s.window.detailX = px
      s.window.detailY = py
    }
  }

  s.viewMode = mode
  saveSettings(s)

  if (!hudWindow || hudWindow.isDestroyed()) return

  const { w, h } = getWindowSize(mode, s)
  hudWindow.setSize(w, h)

  // 新しいモードの保存済み位置に移動（なければ中央）
  const savedPos = getSavedPosition(mode, s)
  const { x, y } = savedPos ?? centerOnActiveDisplay(w, h)
  hudWindow.setPosition(x, y)

  hudWindow.webContents.send('mode-changed', mode)
}

// ---- Tray ----

function createTray(): void {
  const iconPath = is.dev
    ? join(__dirname, '../../resources/tray-icon.png')
    : join(process.resourcesPath, 'resources', 'tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
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

function updateTray(usage: UsageData, settings: Settings, isStale: boolean): void {
  if (!tray) return

  // Windows: バーチャートアイコンを動的生成
  // macOS:  setTitle() でメニューバーにテキスト表示（setImage は機能しない）
  if (process.platform === 'win32') {
    const icon = createBarIcon(usage, settings, isStale)
    if (!icon.isEmpty()) tray.setImage(icon)
    // ツールチップに数値を表示
    const parts: string[] = []
    if (settings.tray.show5h && usage.five_hour)
      parts.push(`5h: ${Math.round(usage.five_hour.utilization)}%`)
    if (settings.tray.show7d && usage.seven_day)
      parts.push(`7d: ${Math.round(usage.seven_day.utilization)}%`)
    if (settings.tray.showOauth && usage.seven_day_oauth_apps)
      parts.push(`OAuth: ${Math.round(usage.seven_day_oauth_apps.utilization)}%`)
    if (settings.tray.showOpus && usage.seven_day_opus)
      parts.push(`Opus: ${Math.round(usage.seven_day_opus.utilization)}%`)
    if (settings.tray.showSonnet && usage.seven_day_sonnet)
      parts.push(`Sonnet: ${Math.round(usage.seven_day_sonnet.utilization)}%`)
    const tip = parts.length > 0
      ? `Claude Usage HUD${isStale ? ' ⚠' : ''}\n${parts.join('\n')}`
      : 'Claude Usage HUD'
    tray.setToolTip(tip)
  } else {
    // macOS: メニューバーにテキスト表示
    const parts: string[] = []
    if (settings.tray.show5h && usage.five_hour)
      parts.push(`5h:${Math.round(usage.five_hour.utilization)}%`)
    if (settings.tray.show7d && usage.seven_day)
      parts.push(`7d:${Math.round(usage.seven_day.utilization)}%`)
    if (settings.tray.showOauth && usage.seven_day_oauth_apps)
      parts.push(`oa:${Math.round(usage.seven_day_oauth_apps.utilization)}%`)
    if (settings.tray.showOpus && usage.seven_day_opus)
      parts.push(`op:${Math.round(usage.seven_day_opus.utilization)}%`)
    if (settings.tray.showSonnet && usage.seven_day_sonnet)
      parts.push(`snt:${Math.round(usage.seven_day_sonnet.utilization)}%`)
    tray.setTitle(parts.length > 0 ? parts.join(' ') + (isStale ? '~' : '') : '--')
  }
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
    autoHideMenuBar: true,
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

  try {
    const webResult = await claudeWebFetcher.fetchData()
    if (webResult.usage) {
      lastUsage = webResult.usage
      if (webResult.profile) lastProfile = webResult.profile
      lastSuccessAt = new Date()
      saveUsageHistory(webResult.usage)
      updateTray(webResult.usage, settings, false)
      checkAlerts(webResult.usage, settings)
      sendToHud(false)
      log('doUpdate: web fetch OK')
      return
    }
    log('doUpdate: web fetch returned no data (loginStatus:', webResult.loginStatus, ')')
  } catch (err) {
    log('doUpdate: web fetch error:', err)
  }

  // データ取得失敗: キャッシュがあれば stale 表示
  if (lastUsage) {
    updateTray(lastUsage, settings, true)
    sendToHud(true)
  } else {
    if (process.platform !== 'win32') tray?.setTitle('--')
  }
}

function scheduleUpdates(): void {
  if (updateTimer) clearInterval(updateTimer)

  const settings = loadSettings()
  const intervalMs = (settings.updateIntervalMinutes ?? 5) * 60 * 1000

  // 起動直後の即時呼び出しは429になりやすいので3秒後に初回実行
  setTimeout(doUpdate, 3000)
  updateTimer = setInterval(doUpdate, intervalMs)
}

// ---- Alerts ----

function checkAlerts(usage: UsageData, settings: Settings): void {
  const checks: Array<[keyof typeof settings.alerts, string]> = [
    ['five_hour',            '5-hour'],
    ['seven_day',            '7-day'],
    ['seven_day_oauth_apps', '7-day OAuth Apps'],
    ['seven_day_opus',       '7-day Opus'],
    ['seven_day_sonnet',     '7-day Sonnet'],
  ]
  for (const [key, label] of checks) {
    const entry = usage[key as keyof UsageData]
    const threshold = settings.alerts?.[key]
    if (entry && threshold && (entry as { utilization: number }).utilization >= threshold) {
      new Notification({
        title: 'Claude Usage HUD',
        body: `${label} usage is at ${Math.round((entry as { utilization: number }).utilization)}% (threshold: ${threshold}%)`
      }).show()
    }
  }
  const extraThreshold = settings.alerts?.extra_usage
  if (extraThreshold && usage.extra_usage?.is_enabled && usage.extra_usage.utilization >= extraThreshold) {
    new Notification({
      title: 'Claude Usage HUD',
      body: `Extra usage is at ${Math.round(usage.extra_usage.utilization)}% (threshold: ${extraThreshold}%)`
    }).show()
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
    if (s.viewMode === 'compact') {
      const { w, h } = getWindowSize('compact', s)
      hudWindow.setSize(w, h)
    }
    // 言語変更等を HUD に即時反映
    hudWindow.webContents.send('settings-changed', s)
  }
})
ipcMain.handle('set-view-mode', (_e, mode: ViewMode) => switchViewMode(mode))
ipcMain.handle('refresh', () => doUpdate())
ipcMain.handle('open-settings', () => openSettingsWindow())
ipcMain.handle('close-hud', () => hudWindow?.hide())
ipcMain.handle('auto-detect-token', () => getTokenFromCredentials())
ipcMain.handle('open-external', (_e, url: string) => shell.openExternal(url))
ipcMain.handle('show-login-window', () => claudeWebFetcher.showLoginWindow())
ipcMain.handle('hide-login-window', () => claudeWebFetcher.hideLoginWindow())
ipcMain.handle('get-login-status', () => claudeWebFetcher.getLoginStatus())

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
    app.setName('Claude Usage HUD')
    app.dock?.hide()

    claudeWebFetcher.setLogCallback(log)

    // 起動時にキャッシュ済み orgUuid を復元
    const initialSettings = loadSettings()
    if (initialSettings.orgUuid) {
      claudeWebFetcher.setInitialOrgUuid(initialSettings.orgUuid)
      log('Restored cached orgUuid:', initialSettings.orgUuid)
    }

    // ログイン状態が変化したら Settings ウィンドウに通知
    claudeWebFetcher.setStatusChangeCallback((status) => {
      log('Login status changed:', status)
      settingsWindow?.webContents.send('login-status-changed', status)
    })

    // orgUuid が発見・変更されたら設定ファイルに保存
    claudeWebFetcher.setOrgUuidChangedCallback((uuid) => {
      log('orgUuid discovered/changed, saving:', uuid)
      const s = loadSettings()
      s.orgUuid = uuid
      saveSettings(s)
    })

    createTray()
    scheduleUpdates()
  })

  app.on('before-quit', () => {
    claudeWebFetcher.destroy()
  })

  app.on('window-all-closed', (e) => { e.preventDefault() })
}
