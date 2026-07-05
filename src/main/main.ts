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
import { appendFileSync, mkdirSync, statSync, renameSync } from 'fs'
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'http'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { loadSettings, saveSettings, Settings, ViewMode, UltraPosition } from './settings'
import { UsageData, ProfileData, UsageEntry, BetaProvidersData } from './claudeApi'
import { WEEKLY_FIELD_DEFS } from './fieldDefs'
import { saveUsageHistory, getUsageHistory } from './db'
import { getTokenFromCredentials } from './credentials'
import { ClaudeWebFetcher } from './claudeWebFetcher'
import { GitHubCopilotFetcher } from './githubCopilotFetcher'
import { CodexFetcher } from './codexFetcher'
import { GeminiFetcher } from './geminiFetcher'
import { createBarIcon } from './trayIcon'
import { pollCcUsage, getCcPaceData, getBootstrapEstimate, CcPaceData, HistoryPoint, BOOTSTRAP_LOOKBACK_MS } from './ccPaceMeter'

// stdoutがバッファリングされることがあるため、ログは直接ファイルに書き込む
// app.getPath('logs') はプラットフォームに応じた適切なディレクトリを返す
// macOS: ~/Library/Logs/<appName>/  Windows: %APPDATA%\<appName>\logs\
const LOG_DIR = app.getPath('logs')
const LOG_PATH = join(LOG_DIR, 'claude-usage-hud.log')
const LOG_MAX_BYTES = 5 * 1024 * 1024 // 5MB を超えたら起動時にローテーション
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
let dragRestoreTimer: ReturnType<typeof setTimeout> | null = null

const claudeWebFetcher = new ClaudeWebFetcher()
const copilotFetcher = new GitHubCopilotFetcher()
const codexFetcher = new CodexFetcher()
const geminiFetcher = new GeminiFetcher()

let lastUsage: UsageData | null = null
let lastProfile: ProfileData | null = null
let lastSuccessAt: Date | null = null
let lastBeta: BetaProvidersData = { copilot: null, codex: null, gemini: null }
let lastCcPace: CcPaceData = { available: false, paceTokensInBlock: null, burnRatePerMin: null, burnRateCostPerMin: null, minutesToLimit: null, minutesToReset: null, estimatedLimitTokens: null, estimatedLimitUsd: null, calibratedNow: false, sampleCount: 0 }
let ccPaceTimer: ReturnType<typeof setInterval> | null = null

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
const COMPACT_BAR_H = 38   // 1本のバーの高さ（ペースライン含む、bar=28+margin=4+pace=4+gap=2）
const COMPACT_BTN_H = 28   // ボタン行の高さ
const COMPACT_PAD = 8      // 上下パディング合計
const COMPACT_CCPACE_H = 14 // cc-pace-meter 行の追加高さ（5hバーの下）
const ULTRA_W = 160
const ULTRA_BAR_H = 18     // 16px bar + 2px margin
const ULTRA_HANDLE_H = 4
const ULTRA_PAD = 4        // bottom padding

function getCompactHeight(settings: Settings, ccPace?: CcPaceData | null): number {
  const showFields = settings.tray.showFields ?? {}
  const bp = settings.betaProviders ?? {}
  const count = [
    settings.tray.show5h,
    ...WEEKLY_FIELD_DEFS.map(f => showFields[f.key] ?? false),
    settings.tray.showExtra,
    bp.copilot?.enabled ?? false,
    bp.codex?.enabled ?? false,  // 5h bar
    bp.codex?.enabled ?? false,  // 7d bar (Codex is always 2 bars)
    bp.gemini?.enabled ?? false,  // Pro bar
    bp.gemini?.enabled ?? false,  // Flash bar
  ].filter(Boolean).length || 1
  const ccPaceExtra = (settings.tray.show5h && ccPace?.available && ccPace.burnRatePerMin != null) ? COMPACT_CCPACE_H : 0
  return COMPACT_BTN_H + COMPACT_BAR_H * count + COMPACT_PAD + ccPaceExtra
}

function getDetailHeight(settings: Settings): number {
  const bp = settings.betaProviders ?? {}
  // Codex は 5h + 7d で2枚、Gemini は Pro + Flash で2枚
  const betaCount = (bp.copilot?.enabled ? 1 : 0) + (bp.codex?.enabled ? 2 : 0) + (bp.gemini?.enabled ? 2 : 0)
  return DETAIL_H_BASE + betaCount * DETAIL_BETA_H
}

function getUltraHeight(settings: Settings, usage?: UsageData | null, beta?: BetaProvidersData | null): number {
  const showFields = settings.tray.showFields ?? {}
  const bp = settings.betaProviders ?? {}
  const usageRecord = usage as Record<string, UsageEntry | null> | null | undefined
  let count = 0
  if (settings.tray.show5h) count++
  for (const f of WEEKLY_FIELD_DEFS) {
    // count only if enabled AND (data not yet loaded OR data present)
    if ((showFields[f.key] ?? false) && (!usageRecord || usageRecord[f.key] != null)) count++
  }
  if (settings.tray.showExtra && (!usage || usage.extra_usage != null)) count++
  if (bp.copilot?.enabled && (!beta || beta.copilot != null)) count++
  if (bp.codex?.enabled) {
    // 5h bar: only when data confirms it exists
    if (!beta || !beta.codex || beta.codex.fiveHourUtilization != null) count++
    count++ // 7d bar always present when codex enabled
  }
  if (bp.gemini?.enabled) {
    if (!beta || !beta.gemini || beta.gemini.pro   != null) count++
    if (!beta || !beta.gemini || beta.gemini.flash != null) count++
  }
  count = Math.max(count, 1)
  return ULTRA_HANDLE_H + count * ULTRA_BAR_H - 2 + ULTRA_PAD
}

function getWindowSize(mode: ViewMode, settings: Settings, usage?: UsageData | null, beta?: BetaProvidersData | null, ccPace?: CcPaceData | null): { w: number; h: number } {
  if (mode === 'ultra')   return { w: ULTRA_W, h: getUltraHeight(settings, usage, beta) }
  if (mode === 'compact') return { w: COMPACT_W, h: getCompactHeight(settings, ccPace) }
  return { w: DETAIL_W, h: getDetailHeight(settings) }
}

function getUltraSnapPosition(pos: UltraPosition, w: number, existingWin?: BrowserWindow | null): { x: number; y: number } {
  let bounds: Electron.Rectangle
  if (existingWin && !existingWin.isDestroyed()) {
    const [wx, wy] = existingWin.getPosition()
    const [ww, wh] = existingWin.getSize()
    bounds = screen.getDisplayNearestPoint({ x: wx + Math.round(ww / 2), y: wy + Math.round(wh / 2) }).workArea
  } else {
    bounds = getActiveDisplayBounds()
  }
  const { x: dx, y: dy, width } = bounds
  const margin = 8
  switch (pos) {
    case 'top-left':   return { x: dx + margin, y: dy + margin }
    case 'top-right':  return { x: dx + width - w - margin, y: dy + margin }
    case 'top-center': return { x: dx + Math.round((width - w) / 2), y: dy + margin }
    default:           return { x: dx + width - w - margin, y: dy + margin }
  }
}

// ---- HUD Window ----

function getSavedPosition(mode: ViewMode, settings: Settings): { x: number; y: number } | null {
  const cx = mode === 'compact' ? settings.window.compactX : settings.window.detailX
  const cy = mode === 'compact' ? settings.window.compactY : settings.window.detailY
  if (cx != null && cy != null && isPositionOnSomeDisplay(cx, cy)) return { x: cx, y: cy }
  return null
}

function saveWindowPosition(mode: ViewMode, px: number, py: number): void {
  if (mode === 'ultra') return  // ultra position is managed by snap, not drag
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

  let pos: { x: number; y: number }
  if (mode === 'ultra') {
    pos = getUltraSnapPosition(settings.window.ultraPosition ?? 'top-right', w)
  } else {
    pos = getSavedPosition(mode, settings) ?? centerOnActiveDisplay(w, h)
  }
  const { x, y } = pos

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

  // ドラッグ中は不透明化（will-move は macOS のみ・ユーザー操作時のみ発火）
  // 復元は renderer の mouseup が主系、2 秒フォールバックを副系とする
  win.on('will-move', () => {
    const s = loadSettings()
    if ((s.window.opacity ?? 100) < 100) {
      if (dragRestoreTimer) { clearTimeout(dragRestoreTimer); dragRestoreTimer = null }
      win.setOpacity(1.0)
    }
  })

  win.on('moved', () => {
    const [px, py] = win.getPosition()
    const s = loadSettings()
    saveWindowPosition(s.viewMode, px, py)
    // フォールバック: renderer の mouseup が届かなかった場合に 2 秒後に復元
    if ((s.window.opacity ?? 100) < 100) {
      if (dragRestoreTimer) clearTimeout(dragRestoreTimer)
      dragRestoreTimer = setTimeout(() => {
        win.setOpacity(loadSettings().window.opacity / 100)
        dragRestoreTimer = null
      }, 2000)
    }
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

  // 現在のモードの位置を保存（compact/detail のみ）
  if (hudWindow && !hudWindow.isDestroyed() && s.viewMode !== 'ultra') {
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

  const { w, h } = getWindowSize(mode, s, lastUsage, lastBeta, lastCcPace)
  hudWindow.setSize(w, h)

  let pos: { x: number; y: number }
  if (mode === 'ultra') {
    pos = getUltraSnapPosition(s.window.ultraPosition ?? 'top-right', w, hudWindow)
  } else {
    pos = getSavedPosition(mode, s) ?? centerOnActiveDisplay(w, h)
  }
  hudWindow.setPosition(pos.x, pos.y)

  hudWindow.webContents.send('mode-changed', mode)
}

function setUltraPosition(pos: UltraPosition): void {
  const s = loadSettings()
  s.window.ultraPosition = pos
  saveSettings(s)
  if (hudWindow && !hudWindow.isDestroyed() && s.viewMode === 'ultra') {
    const { w, h } = getWindowSize('ultra', s)
    const { x, y } = getUltraSnapPosition(pos, w, hudWindow)
    hudWindow.setPosition(x, y)
  }
}

// ---- Tray ----

/**
 * macOS tray アプリでは app.quit() を window-all-closed の preventDefault が
 * ブロックする場合があるため、tray を先に破棄してから quitAndInstall() を呼ぶ。
 */
function quitAndInstall(): void {
  app.removeAllListeners('window-all-closed')
  if (tray && !tray.isDestroyed()) { tray.destroy(); tray = null }
  BrowserWindow.getAllWindows().forEach(win => { try { win.destroy() } catch {} })
  autoUpdater.quitAndInstall(false, true)
}

function buildContextMenu(): Menu {
  const s = loadSettings()
  const ultraPos = s.window.ultraPosition ?? 'top-right'

  const items: Electron.MenuItemConstructorOptions[] = [
    { label: 'Show / Hide', click: () => toggleHudWindow() },
    { type: 'separator' },
    { label: 'Compact', type: 'radio', checked: s.viewMode === 'compact', click: () => switchViewMode('compact') },
    { label: 'Detail',  type: 'radio', checked: s.viewMode === 'detail',  click: () => switchViewMode('detail') },
    { label: 'Ultra',   type: 'radio', checked: s.viewMode === 'ultra',   click: () => switchViewMode('ultra') },
  ]

  if (s.viewMode === 'ultra') {
    items.push({ type: 'separator' })
    items.push({ label: 'Top Left',   type: 'radio', checked: ultraPos === 'top-left',   click: () => setUltraPosition('top-left') })
    items.push({ label: 'Top Center', type: 'radio', checked: ultraPos === 'top-center', click: () => setUltraPosition('top-center') })
    items.push({ label: 'Top Right',  type: 'radio', checked: ultraPos === 'top-right',  click: () => setUltraPosition('top-right') })
  }

  items.push({ type: 'separator' })
  items.push({ label: 'Settings',         click: () => openSettingsWindow() })
  items.push({ label: 'Refresh Now',      click: () => doUpdate() })
  items.push({ label: 'Check for Updates', click: () => { autoUpdater.checkForUpdates().catch(e => log('manual update check error:', e)) } })

  if (updateDownloaded) {
    items.push({ type: 'separator' })
    items.push({ label: '✦ Restart to Update', click: () => quitAndInstall() })
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
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  settingsWindow.once('ready-to-show', () => settingsWindow?.show())

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
  // Re-snap ultra window after each data update so height reflects actual bar count
  const s = loadSettings()
  if (s.viewMode === 'ultra') {
    const { w, h } = getWindowSize('ultra', s, lastUsage, lastBeta)
    hudWindow.setSize(w, h)
    const { x, y } = getUltraSnapPosition(s.window.ultraPosition ?? 'top-right', w, hudWindow)
    hudWindow.setPosition(x, y)
  } else if (s.viewMode === 'compact') {
    const { w, h } = getWindowSize('compact', s, lastUsage, lastBeta, lastCcPace)
    hudWindow.setSize(w, h)
  }
  hudWindow.webContents.send('usage-update', {
    usage: lastUsage,
    profile: lastProfile,
    lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
    isStale,
    beta: lastBeta,
    ccPace: lastCcPace,
  })
}

let ccPaceBootstrapAttempted = false

async function updateCcPace(): Promise<void> {
  const settings = loadSettings()

  // 初回起動時: 過去のJSONL+利用履歴からまとめてキャリブレーションのタネを作る
  if (!ccPaceBootstrapAttempted && !settings.ccPaceCalibration) {
    const resetsAt = lastUsage?.five_hour?.resets_at
    if (resetsAt) {
      await pollCcUsage(BOOTSTRAP_LOOKBACK_MS)
      const history: HistoryPoint[] = getUsageHistory(2)
        .filter(r => r.five_hour != null)
        .map(r => ({
          recordedAt: new Date(r.recorded_at.replace(' ', 'T') + 'Z').getTime(),
          fiveHour: r.five_hour,
        }))
      const bootstrap = getBootstrapEstimate(history, resetsAt)
      log('cc-pace bootstrap:', bootstrap)
      if (bootstrap.sampleCount > 0 && bootstrap.estimatedLimitTokens != null) {
        settings.ccPaceCalibration = {
          estimatedLimitTokens: bootstrap.estimatedLimitTokens,
          estimatedLimitUsd: bootstrap.estimatedLimitUsd ?? undefined,
          sampleCount: bootstrap.sampleCount,
          updatedAt: new Date().toISOString(),
        }
        saveSettings(settings)
      }
      ccPaceBootstrapAttempted = true
    }
  } else {
    await pollCcUsage()
  }

  lastCcPace = getCcPaceData(
    lastUsage?.five_hour?.utilization ?? null,
    lastUsage?.five_hour?.resets_at ?? null,
    settings.ccPaceCalibration?.estimatedLimitTokens ?? null,
    settings.ccPaceCalibration?.estimatedLimitUsd ?? null,
    settings.ccPaceCalibration?.sampleCount ?? 0,
    settings.ccPaceCalibration?.lastResetsAt ?? null
  )
  if (lastCcPace.calibratedNow && lastCcPace.estimatedLimitTokens != null) {
    settings.ccPaceCalibration = {
      estimatedLimitTokens: lastCcPace.estimatedLimitTokens,
      estimatedLimitUsd: lastCcPace.estimatedLimitUsd ?? undefined,
      sampleCount: lastCcPace.sampleCount,
      lastResetsAt: lastUsage?.five_hour?.resets_at ?? undefined,
      updatedAt: new Date().toISOString(),
    }
    saveSettings(settings)
  }
  sendToHud(lastUsage == null)
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
  const results: BetaProvidersData = { copilot: null, codex: null, gemini: null }

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

  if (bp.gemini?.enabled) {
    try {
      results.gemini = await geminiFetcher.fetchData()
      log('doUpdateBeta: gemini=', results.gemini)
    } catch (e) {
      log('doUpdateBeta: gemini error:', e)
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

function scheduleCcPaceUpdates(): void {
  if (ccPaceTimer) clearInterval(ccPaceTimer)
  const run = (): void => { updateCcPace().catch(e => log('updateCcPace error:', e)) }
  setTimeout(run, 1000)
  ccPaceTimer = setInterval(run, 30 * 1000)
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
  app.setLoginItemSettings({
    openAtLogin: settings.launchAtLogin ?? false,
    ...(process.platform === 'win32' ? { path: process.execPath } : {})
  })
  scheduleUpdates()
  if (hudWindow && !hudWindow.isDestroyed()) {
    const s = loadSettings()
    hudWindow.setAlwaysOnTop(s.window.alwaysOnTop)
    hudWindow.setOpacity(s.window.opacity / 100)
    const { w, h } = getWindowSize(s.viewMode, s, lastUsage, lastBeta, lastCcPace)
    hudWindow.setSize(w, h)
    if (s.viewMode === 'ultra') {
      const { x, y } = getUltraSnapPosition(s.window.ultraPosition ?? 'top-right', w, hudWindow)
      hudWindow.setPosition(x, y)
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
ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('check-for-updates', () => autoUpdater.checkForUpdates().catch(e => log('update check error:', e)))
ipcMain.handle('install-update', () => quitAndInstall())
ipcMain.on('set-ignore-mouse-events', (event, ignore: boolean) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  win?.setIgnoreMouseEvents(ignore, { forward: true })
})
ipcMain.on('set-window-opacity', (event, opacity: number) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  win?.setOpacity(opacity)
})
// Beta providers
ipcMain.handle('get-beta-data', () => lastBeta)
ipcMain.handle('get-cc-pace-data', () => lastCcPace)
ipcMain.handle('get-copilot-login-status', () => copilotFetcher.getLoginStatus())
ipcMain.handle('get-codex-login-status', () => codexFetcher.getLoginStatus())
ipcMain.handle('get-gemini-login-status', () => geminiFetcher.getLoginStatus())
ipcMain.handle('show-copilot-login-window', () => copilotFetcher.showLoginWindow())
ipcMain.handle('hide-copilot-login-window', () => copilotFetcher.hideLoginWindow())
ipcMain.handle('show-codex-login-window', () => codexFetcher.showLoginWindow())
ipcMain.handle('hide-codex-login-window', () => codexFetcher.hideLoginWindow())
ipcMain.handle('show-gemini-login-window', () => geminiFetcher.showLoginWindow())
ipcMain.handle('hide-gemini-login-window', () => geminiFetcher.hideLoginWindow())

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
      beta: lastBeta,
      cc_pace: lastCcPace,
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
  // シングルインスタンスロック確定後に実行（二重起動時の敗者プロセスによるレースを避ける）
  try {
    if (statSync(LOG_PATH).size > LOG_MAX_BYTES) {
      renameSync(LOG_PATH, `${LOG_PATH}.old`)
    }
  } catch {}

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
    geminiFetcher.setLogCallback(log)
    copilotFetcher.setStatusChangeCallback((status) => {
      log('copilot login status changed:', status)
    })
    codexFetcher.setStatusChangeCallback((status) => {
      log('codex login status changed:', status)
    })
    geminiFetcher.setStatusChangeCallback((status) => {
      log('gemini login status changed:', status)
    })

    // 起動時にキャッシュ済み orgUuid を復元
    const initialSettings = loadSettings()

    // システム側の launch-at-login 状態を設定ファイルに同期
    const loginItemOpts = process.platform === 'win32' ? { path: process.execPath } : {}
    const systemLaunchAtLogin = app.getLoginItemSettings(loginItemOpts).openAtLogin
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
    hudWindow = createHudWindow()
    hudWindow.show()
    scheduleUpdates()
    scheduleCcPaceUpdates()
    startLocalApiServer()
    setupAutoUpdater()
  })

  app.on('before-quit', () => {
    claudeWebFetcher.destroy()
    copilotFetcher.destroy()
    codexFetcher.destroy()
    geminiFetcher.destroy()
  })

  app.on('window-all-closed', (e) => { e.preventDefault() })
}
