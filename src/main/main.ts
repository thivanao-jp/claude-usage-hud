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
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'http'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { loadSettings, saveSettings, Settings, ViewMode } from './settings'
import { UsageData, ProfileData, UsageEntry, BetaProvidersData } from './claudeApi'
import { WEEKLY_FIELD_DEFS } from './fieldDefs'
import { saveUsageHistory, getUsageHistory } from './db'
import { getTokenFromCredentials } from './credentials'
import { ClaudeWebFetcher } from './claudeWebFetcher'
import { GitHubCopilotFetcher } from './githubCopilotFetcher'
import { CodexFetcher } from './codexFetcher'
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
let updateCheckTimer: ReturnType<typeof setInterval> | null = null
let updateDownloaded = false

const claudeWebFetcher = new ClaudeWebFetcher()
const copilotFetcher = new GitHubCopilotFetcher()
const codexFetcher = new CodexFetcher()

let lastUsage: UsageData | null = null
let lastProfile: ProfileData | null = null
let lastSuccessAt: Date | null = null
let lastBeta: BetaProvidersData = { copilot: null, codex: null }

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
const DETAIL_H_BASE = 580
const DETAIL_BETA_H = 88  // βカード1枚あたりの追加高さ
const COMPACT_W = 320
const COMPACT_BAR_H = 46   // 1本のバーの高さ（ペースライン含む）
const COMPACT_BTN_H = 28   // ボタン行の高さ
const COMPACT_PAD = 8      // 上下パディング合計

function getCompactHeight(settings: Settings): number {
  const showFields = settings.tray.showFields ?? {}
  const bp = settings.betaProviders ?? {}
  const count = [
    settings.tray.show5h,
    ...WEEKLY_FIELD_DEFS.map(f => showFields[f.key] ?? false),
    settings.tray.showExtra,
    bp.copilot?.enabled ?? false,
    bp.codex?.enabled ?? false,
  ].filter(Boolean).length || 1
  return COMPACT_BTN_H + COMPACT_BAR_H * count + COMPACT_PAD
}

function getDetailHeight(settings: Settings): number {
  const bp = settings.betaProviders ?? {}
  const betaCount = [bp.copilot?.enabled, bp.codex?.enabled].filter(Boolean).length
  return DETAIL_H_BASE + betaCount * DETAIL_BETA_H
}

function getWindowSize(mode: ViewMode, settings: Settings): { w: number; h: number } {
  return mode === 'compact'
    ? { w: COMPACT_W, h: getCompactHeight(settings) }
    : { w: DETAIL_W, h: getDetailHeight(settings) }
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

function buildContextMenu(): Menu {
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: 'Show / Hide', click: () => toggleHudWindow() },
    { label: 'Compact', click: () => switchViewMode('compact') },
    { label: 'Detail', click: () => switchViewMode('detail') },
    { label: 'Settings', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: 'Refresh Now', click: () => doUpdate() },
    { label: 'Check for Updates', click: () => { autoUpdater.checkForUpdates().catch(e => log('manual update check error:', e)) } },
  ]

  if (updateDownloaded) {
    items.push({ type: 'separator' })
    items.push({ label: '✦ Restart to Update', click: () => autoUpdater.quitAndInstall() })
  }

  items.push({ type: 'separator' })
  items.push({ label: 'Quit', click: () => app.quit() })

  return Menu.buildFromTemplate(items)
}

function createTray(): void {
  const iconPath = is.dev
    ? join(__dirname, '../../resources/tray-icon.png')
    : join(process.resourcesPath, 'resources', 'tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('Claude Usage HUD')

  tray.on('click', () => toggleHudWindow())
  tray.on('right-click', () => tray!.popUpContextMenu(buildContextMenu()))
}

function updateTray(usage: UsageData, settings: Settings, isStale: boolean): void {
  if (!tray) return

  const showFields = settings.tray.showFields ?? {}
  const usageRecord = usage as unknown as Record<string, UsageEntry | null>

  // Windows: バーチャートアイコンを動的生成
  // macOS:  setTitle() でメニューバーにテキスト表示（setImage は機能しない）
  if (process.platform === 'win32') {
    const icon = createBarIcon(usage, settings, isStale)
    if (!icon.isEmpty()) tray.setImage(icon)
    // ツールチップに数値を表示
    const parts: string[] = []
    if (settings.tray.show5h && usage.five_hour)
      parts.push(`5h: ${Math.round(usage.five_hour.utilization)}%`)
    for (const field of WEEKLY_FIELD_DEFS) {
      const entry = usageRecord[field.key]
      if (showFields[field.key] && entry)
        parts.push(`${field.shortLabel}: ${Math.round(entry.utilization)}%`)
    }
    const tip = parts.length > 0
      ? `Claude Usage HUD${isStale ? ' ⚠' : ''}\n${parts.join('\n')}`
      : 'Claude Usage HUD'
    tray.setToolTip(tip)
  } else {
    // macOS: メニューバーにテキスト表示
    const parts: string[] = []
    if (settings.tray.show5h && usage.five_hour)
      parts.push(`5h:${Math.round(usage.five_hour.utilization)}%`)
    for (const field of WEEKLY_FIELD_DEFS) {
      const entry = usageRecord[field.key]
      if (showFields[field.key] && entry)
        parts.push(`${field.shortLabel.toLowerCase()}:${Math.round(entry.utilization)}%`)
    }
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
    beta: lastBeta,
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

async function doUpdateBeta(): Promise<void> {
  const settings = loadSettings()
  const bp = settings.betaProviders ?? {}
  const results: BetaProvidersData = { copilot: null, codex: null }

  if (bp.copilot?.enabled) {
    try {
      results.copilot = await copilotFetcher.fetchData()
      log('doUpdateBeta: copilot=', results.copilot)
    } catch (e) {
      log('doUpdateBeta: copilot error:', e)
    }
  }

  if (bp.codex?.enabled) {
    try {
      results.codex = await codexFetcher.fetchData()
      log('doUpdateBeta: codex=', results.codex)
    } catch (e) {
      log('doUpdateBeta: codex error:', e)
    }
  }

  lastBeta = results
  sendToHud(lastUsage == null)
}

function scheduleUpdates(): void {
  if (updateTimer) clearInterval(updateTimer)

  const settings = loadSettings()
  const intervalMs = (settings.updateIntervalMinutes ?? 5) * 60 * 1000

  // 起動直後の即時呼び出しは429になりやすいので3秒後に初回実行
  setTimeout(doUpdate, 3000)
  // Beta providers は Claude より少し遅らせて起動直後の負荷を分散
  setTimeout(doUpdateBeta, 8000)
  updateTimer = setInterval(() => { doUpdate(); doUpdateBeta() }, intervalMs)
}

// ---- Alerts ----

function checkAlerts(usage: UsageData, settings: Settings): void {
  const usageRecord = usage as unknown as Record<string, UsageEntry | null>

  // 5-hour
  const fiveHourThreshold = settings.alerts?.['five_hour']
  if (fiveHourThreshold && usage.five_hour && usage.five_hour.utilization >= fiveHourThreshold) {
    new Notification({
      title: 'Claude Usage HUD',
      body: `5-hour usage is at ${Math.round(usage.five_hour.utilization)}% (threshold: ${fiveHourThreshold}%)`
    }).show()
  }

  // Weekly fields (dynamic)
  for (const field of WEEKLY_FIELD_DEFS) {
    const entry = usageRecord[field.key]
    const threshold = settings.alerts?.[field.key]
    if (entry && threshold && entry.utilization >= threshold) {
      new Notification({
        title: 'Claude Usage HUD',
        body: `${field.labelEn} usage is at ${Math.round(entry.utilization)}% (threshold: ${threshold}%)`
      }).show()
    }
  }

  // Extra usage
  const extraThreshold = settings.alerts?.['extra_usage']
  if (extraThreshold && usage.extra_usage?.is_enabled && usage.extra_usage.utilization != null && usage.extra_usage.utilization >= extraThreshold) {
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
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin ?? false })
  scheduleUpdates()
  if (hudWindow && !hudWindow.isDestroyed()) {
    const s = loadSettings()
    hudWindow.setAlwaysOnTop(s.window.alwaysOnTop)
    hudWindow.setOpacity(s.window.opacity / 100)
    const { w, h } = getWindowSize(s.viewMode, s)
    hudWindow.setSize(w, h)
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
ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('check-for-updates', () => autoUpdater.checkForUpdates().catch(e => log('update check error:', e)))
ipcMain.handle('install-update', () => autoUpdater.quitAndInstall())
// Beta providers
ipcMain.handle('get-beta-data', () => lastBeta)
ipcMain.handle('get-copilot-login-status', () => copilotFetcher.getLoginStatus())
ipcMain.handle('get-codex-login-status', () => codexFetcher.getLoginStatus())
ipcMain.handle('show-copilot-login-window', () => copilotFetcher.showLoginWindow())
ipcMain.handle('hide-copilot-login-window', () => copilotFetcher.hideLoginWindow())
ipcMain.handle('show-codex-login-window', () => codexFetcher.showLoginWindow())
ipcMain.handle('hide-codex-login-window', () => codexFetcher.hideLoginWindow())

// ---- App Lifecycle ----

// ---- Auto Updater ----

function broadcastToWindows(channel: string, ...args: unknown[]): void {
  for (const win of [hudWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

function setupAutoUpdater(): void {
  if (is.dev) {
    log('autoUpdater: skipped in dev mode')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    log('autoUpdater: checking for update')
    broadcastToWindows('update-status', { state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    log('autoUpdater: update available', info.version)
    broadcastToWindows('update-status', { state: 'available', version: info.version })
    new Notification({
      title: 'Claude Usage HUD',
      body: `v${info.version} が利用可能です。バックグラウンドでダウンロードしています...`
    }).show()
  })

  autoUpdater.on('update-not-available', () => {
    log('autoUpdater: up to date')
    broadcastToWindows('update-status', { state: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    broadcastToWindows('update-status', { state: 'downloading', percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    log('autoUpdater: update downloaded', info.version)
    updateDownloaded = true
    broadcastToWindows('update-status', { state: 'downloaded', version: info.version })
    new Notification({
      title: 'Claude Usage HUD',
      body: `v${info.version} のダウンロード完了。トレイメニューから再起動して適用できます。`
    }).show()
  })

  autoUpdater.on('error', (err) => {
    log('autoUpdater: error', err.message)
    broadcastToWindows('update-status', { state: 'error', message: err.message })
  })

  // 起動30秒後に初回チェック、その後4時間ごと
  const scheduleUpdateCheck = (): void => {
    if (updateCheckTimer) clearInterval(updateCheckTimer)
    const settings = loadSettings()
    if (!(settings.autoUpdate ?? true)) return

    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(e => log('autoUpdater initial check error:', e))
      updateCheckTimer = setInterval(() => {
        const s = loadSettings()
        if (s.autoUpdate ?? true) {
          autoUpdater.checkForUpdates().catch(e => log('autoUpdater periodic check error:', e))
        }
      }, 4 * 60 * 60 * 1000)
    }, 30 * 1000)
  }

  scheduleUpdateCheck()
}

// ---- Local API Server (localhost only, for Claude Code skill integration) ----

const LOCAL_API_PORT = 49485

function startLocalApiServer(): void {
  const server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET' || req.url !== '/usage') {
      res.writeHead(404)
      res.end('Not Found')
      return
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify({
      five_hour: lastUsage?.five_hour ?? null,
      seven_day: lastUsage?.seven_day ?? null,
      extra_usage: lastUsage?.extra_usage ?? null,
      last_updated: lastSuccessAt?.toISOString() ?? null,
    }))
  })

  server.listen(LOCAL_API_PORT, '127.0.0.1', () => {
    log(`Local API server listening on http://127.0.0.1:${LOCAL_API_PORT}/usage`)
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log(`Local API port ${LOCAL_API_PORT} already in use, skipping`)
    } else {
      log('Local API server error:', err)
    }
  })
}

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
    copilotFetcher.setLogCallback(log)
    codexFetcher.setLogCallback(log)
    copilotFetcher.setStatusChangeCallback((status) => {
      log('copilot login status changed:', status)
    })
    codexFetcher.setStatusChangeCallback((status) => {
      log('codex login status changed:', status)
    })

    // 起動時にキャッシュ済み orgUuid を復元
    const initialSettings = loadSettings()

    // システム側の launch-at-login 状態を設定ファイルに同期
    const systemLaunchAtLogin = app.getLoginItemSettings().openAtLogin
    if (systemLaunchAtLogin !== (initialSettings.launchAtLogin ?? false)) {
      initialSettings.launchAtLogin = systemLaunchAtLogin
      saveSettings(initialSettings)
    }
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
    startLocalApiServer()
    setupAutoUpdater()
  })

  app.on('before-quit', () => {
    claudeWebFetcher.destroy()
    copilotFetcher.destroy()
    codexFetcher.destroy()
  })

  app.on('window-all-closed', (e) => { e.preventDefault() })
}
