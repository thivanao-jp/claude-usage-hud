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
import { tmpdir } from 'os'
import { appendFileSync, mkdirSync, statSync, renameSync, writeFileSync } from 'fs'
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'http'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { loadSettings, saveSettings, Settings, ViewMode, UltraPosition } from './settings'
import { UsageData, ProfileData, UsageEntry, BetaProvidersData } from './claudeApi'
import { WEEKLY_FIELD_DEFS } from './fieldDefs'
import { saveUsageHistory, getUsageHistory, debugSeedHistory, debugClearHistory, saveCodexUsageHistory, getCodexPaceHistory } from './db'
import { getTokenFromCredentials } from './credentials'
import { ClaudeWebFetcher } from './claudeWebFetcher'
import { GitHubCopilotFetcher } from './githubCopilotFetcher'
import { CodexFetcher } from './codexFetcher'
import { createBarIcon } from './trayIcon'
import { pollCcUsage, getCcPaceData, getBootstrapEstimate, CcPaceData, HistoryPoint, BOOTSTRAP_LOOKBACK_MS } from './ccPaceMeter'
import { calculateCodexPace } from './codexPaceMeter'
import { getPricingCatalogSnapshot, initializeModelPricing } from './modelPricing'
import { buildLocalUsagePayload } from './localUsagePayload'

// ---- Screenshot / Debug Mock Mode ----
// README用スクリーンショット生成のための開発専用モード。パッケージ済みアプリでは絶対に有効化されない。
const SCREENSHOT_MODE = !app.isPackaged && process.env.HUD_SCREENSHOT_MODE === '1'
// toLocaleDateString/toLocaleTimeString は OS ロケールに従うため、README用スクショの日付表記を
// 言語版と一致させたい場合は HUD_SCREENSHOT_LOCALE=ja-JP のように明示指定する（未指定時は英語）
const SCREENSHOT_LOCALE = process.env.HUD_SCREENSHOT_LOCALE ?? 'en-US'
if (SCREENSHOT_MODE) {
  // 実ユーザーの Application Support データ（トークン・履歴・設定）を絶対に触らないよう隔離する
  // ロケール毎に別プロファイルにする（Chromium は Local State に app_locale をキャッシュするため、
  // 同じ userData を使い回すと --lang / LANG を変えても古いロケールが残ってしまう）
  app.setPath('userData', join(tmpdir(), `claude-usage-hud-screenshot-${SCREENSHOT_LOCALE}`))
  // Chromium の --lang は 'ja-JP' のような地域付きコードを認識せず既定(en-US)へフォールバックするため、
  // 言語コードのみ('ja'/'en')を渡す
  app.commandLine.appendSwitch('lang', SCREENSHOT_LOCALE.split('-')[0])
  // toLocaleDateString 等 V8/ICU の既定ロケール解決は --lang スイッチだけでは効かず LANG/LC_ALL を見るため、両方設定する
  const posixLocale = `${SCREENSHOT_LOCALE.replace('-', '_')}.UTF-8`
  process.env.LANG = posixLocale
  process.env.LC_ALL = posixLocale
}

const EMPTY_USAGE: UsageData = {
  five_hour: null, seven_day: null, seven_day_oauth_apps: null, seven_day_opus: null,
  seven_day_fable: null, seven_day_sonnet: null, seven_day_cowork: null, seven_day_omelette: null,
  iguana_necktie: null, omelette_promotional: null, cinder_cove: null, tangelo: null,
  nimbus_quill: null, amber_ladder: null, extra_usage: null,
}

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
let pricingCatalogTimer: ReturnType<typeof setInterval> | null = null
let updateDownloaded = false
let dragRestoreTimer: ReturnType<typeof setTimeout> | null = null

const claudeWebFetcher = new ClaudeWebFetcher()
const copilotFetcher = new GitHubCopilotFetcher()
const codexFetcher = new CodexFetcher()

let lastUsage: UsageData | null = null
let lastProfile: ProfileData | null = null
let lastSuccessAt: Date | null = null
let lastBeta: BetaProvidersData = { copilot: null, codex: null }
let lastCcPace: CcPaceData = getCcPaceData(null, null)
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

function getCompactHeight(settings: Settings, ccPace?: CcPaceData | null, beta?: BetaProvidersData | null): number {
  const showFields = settings.tray.showFields ?? {}
  const bp = settings.betaProviders ?? {}
  const count = [
    settings.tray.show5h,
    ...WEEKLY_FIELD_DEFS.map(f => showFields[f.key] ?? false),
    settings.tray.showExtra,
    bp.copilot?.enabled ?? false,
    settings.codex?.enabled && (settings.tray.showCodexPrimary ?? true),
    settings.codex?.enabled && (settings.tray.showCodexSecondary ?? true),
    // 残高行はクレジットを持つアカウントでのみ出るので、データ確認後にだけ数える
    settings.codex?.enabled && (settings.tray.showCodexCredits ?? true) && (beta?.codex?.hasCredits ?? false),
  ].filter(Boolean).length || 1
  const ccPaceExtra = (settings.tray.show5h && ccPace?.available && ccPace.burnRateCostPerMin != null) ? COMPACT_CCPACE_H : 0
  const codexPaceExtra = (settings.codex?.enabled && (settings.tray.showCodexPrimary ?? true)
    && beta?.codex?.pace?.available && beta.codex.pace.burnRatePercentPerMin != null) ? COMPACT_CCPACE_H : 0
  return COMPACT_BTN_H + COMPACT_BAR_H * count + COMPACT_PAD + ccPaceExtra + codexPaceExtra
}

function getDetailHeight(settings: Settings, beta?: BetaProvidersData | null): number {
  const bp = settings.betaProviders ?? {}
  // 残高カードはクレジットを持つアカウントでのみ出る（詳細表示はトレイのトグルに従わない）
  const codexCredits = settings.codex?.enabled && beta?.codex?.hasCredits ? 1 : 0
  const betaCount = (bp.copilot?.enabled ? 1 : 0) + (settings.codex?.enabled ? 2 : 0) + codexCredits
  const codexPaceExtra = beta?.codex?.pace?.available ? 18 : 0
  const resetCreditsExtra = (beta?.codex?.rateLimitResetCreditsAvailable ?? 0) > 0 ? 14 : 0
  return DETAIL_H_BASE + betaCount * DETAIL_BETA_H + codexPaceExtra + resetCreditsExtra
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
  if (settings.codex?.enabled) {
    // 5h bar: only when data confirms it exists
    if ((settings.tray.showCodexPrimary ?? true) && (!beta || !beta.codex || beta.codex.fiveHourUtilization != null)) count++
    if (settings.tray.showCodexSecondary ?? true) count++
    // 残高行はクレジットを持つアカウントでのみ出るので、データ確認後にだけ数える
    if ((settings.tray.showCodexCredits ?? true) && beta?.codex?.hasCredits) count++
  }
  count = Math.max(count, 1)
  return ULTRA_HANDLE_H + count * ULTRA_BAR_H - 2 + ULTRA_PAD
}

function getWindowSize(mode: ViewMode, settings: Settings, usage?: UsageData | null, beta?: BetaProvidersData | null, ccPace?: CcPaceData | null): { w: number; h: number } {
  if (mode === 'ultra')   return { w: ULTRA_W, h: getUltraHeight(settings, usage, beta) }
  if (mode === 'compact') return { w: COMPACT_W, h: getCompactHeight(settings, ccPace, beta) }
  return { w: DETAIL_W, h: getDetailHeight(settings, beta) }
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
    const { w } = getWindowSize('ultra', s)
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
  const codex = lastBeta.codex

  // Windows: バーチャートアイコンを動的生成
  // macOS:  setTitle() でメニューバーにテキスト表示（setImage は機能しない）
  if (process.platform === 'win32') {
    const icon = createBarIcon(usage, settings, isStale, codex)
    if (!icon.isEmpty()) tray.setImage(icon)
    // ツールチップに数値を表示
    const parts: string[] = []
    if (settings.tray.show5h && usage.five_hour)
      parts.push(`Claude 5h: ${Math.round(usage.five_hour.utilization)}%`)
    for (const field of WEEKLY_FIELD_DEFS) {
      const entry = usageRecord[field.key]
      if (showFields[field.key] && entry)
        parts.push(`Claude ${field.shortLabel}: ${Math.round(entry.utilization)}%`)
    }
    if (settings.codex?.enabled && settings.tray.showCodexPrimary && codex?.fiveHourUtilization != null)
      parts.push(`Codex ${formatCodexWindow(codex.primaryWindowMinutes)}: ${Math.round(codex.fiveHourUtilization)}%`)
    if (settings.codex?.enabled && settings.tray.showCodexSecondary && (codex?.secondaryWindowMinutes != null || codex?.fiveHourUtilization == null) && codex)
      parts.push(`Codex ${formatCodexWindow(codex.secondaryWindowMinutes)}: ${Math.round(codex.utilization)}%`)
    const tip = parts.length > 0
      ? `Claude Usage HUD${isStale ? ' ⚠' : ''}\n${parts.join('\n')}`
      : 'Claude Usage HUD'
    tray.setToolTip(tip)
  } else {
    // macOS: メニューバーはアイコンだけにして横幅を節約し、詳細はホバー時のツールチップへ。
    const parts: string[] = []
    if (settings.tray.show5h && usage.five_hour)
      parts.push(`Cl5h:${Math.round(usage.five_hour.utilization)}%`)
    for (const field of WEEKLY_FIELD_DEFS) {
      const entry = usageRecord[field.key]
      if (showFields[field.key] && entry)
        parts.push(`Cl${field.shortLabel.toLowerCase()}:${Math.round(entry.utilization)}%`)
    }
    if (settings.codex?.enabled && settings.tray.showCodexPrimary && codex?.fiveHourUtilization != null)
      parts.push(`Cdx${formatCodexWindow(codex.primaryWindowMinutes)}:${Math.round(codex.fiveHourUtilization)}%`)
    if (settings.codex?.enabled && settings.tray.showCodexSecondary && (codex?.secondaryWindowMinutes != null || codex?.fiveHourUtilization == null) && codex)
      parts.push(`Cdx${formatCodexWindow(codex.secondaryWindowMinutes)}:${Math.round(codex.utilization)}%`)
    const tip = parts.length > 0
      ? `Claude Usage HUD${isStale ? ' ⚠' : ''}\n${parts.join('\n')}`
      : 'Claude Usage HUD'
    tray.setTitle('')
    tray.setToolTip(tip)
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
  if (SCREENSHOT_MODE) return
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
    settings.ccPaceCalibration?.lastResetsAt ?? null,
    lastSuccessAt?.getTime() ?? null
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
  if (SCREENSHOT_MODE) return
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
  if (SCREENSHOT_MODE) return
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

  if (settings.codex?.enabled) {
    try {
      const codex = await codexFetcher.fetchData()
      if (codex) {
        const observedAt = Date.now()
        saveCodexUsageHistory(codex, observedAt)
        const history = getCodexPaceHistory(observedAt - 60 * 60 * 1000)
        codex.pace = calculateCodexPace(
          codex.fiveHourUtilization,
          codex.fiveHourResetDate,
          history,
          observedAt
        )
      }
      results.codex = codex
      log('doUpdateBeta: codex=', results.codex)
    } catch (e) {
      log('doUpdateBeta: codex error:', e)
    }
  }

  lastBeta = results
  if (lastUsage) updateTray(lastUsage, settings, false)
  checkCodexAlerts(results.codex, settings)
  sendToHud(lastUsage == null)
}

function checkCodexAlerts(codex: BetaProvidersData['codex'], settings: Settings): void {
  if (!codex) return
  const primaryThreshold = settings.alerts['codex_primary']
  if (primaryThreshold && codex.fiveHourUtilization != null && codex.fiveHourUtilization >= primaryThreshold) {
    new Notification({ title: 'Claude Usage HUD', body: `Codex ${formatCodexWindow(codex.primaryWindowMinutes)} usage is at ${Math.round(codex.fiveHourUtilization)}% (threshold: ${primaryThreshold}%)` }).show()
  }
  const secondaryThreshold = settings.alerts['codex_secondary']
  if (secondaryThreshold && (codex.secondaryWindowMinutes != null || codex.fiveHourUtilization == null) && codex.utilization >= secondaryThreshold) {
    new Notification({ title: 'Claude Usage HUD', body: `Codex ${formatCodexWindow(codex.secondaryWindowMinutes)} usage is at ${Math.round(codex.utilization)}% (threshold: ${secondaryThreshold}%)` }).show()
  }
}

function formatCodexWindow(minutes: number | null): string {
  if (minutes == null) return '%'
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
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
ipcMain.handle('get-pricing-catalog', () => getPricingCatalogSnapshot())
ipcMain.handle('refresh-pricing-catalog', async () => {
  await initializeModelPricing(app.getPath('userData'), log)
  return getPricingCatalogSnapshot()
})
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
ipcMain.handle('show-copilot-login-window', () => copilotFetcher.showLoginWindow())
ipcMain.handle('hide-copilot-login-window', () => copilotFetcher.hideLoginWindow())
ipcMain.handle('show-codex-login-window', () => codexFetcher.showLoginWindow())
ipcMain.handle('hide-codex-login-window', () => codexFetcher.hideLoginWindow())

// デバッグ専用: 任意の使用率・リセット時刻を注入する（パッケージ済みビルドでは常に拒否）。
// スクリーンショット撮影や表示崩れ確認のため、DevTools コンソールから
// window.api.debugSetMockUsage({ usage: { five_hour: { utilization: 90, resets_at: ... } } }) のように呼び出す。
ipcMain.handle('debug-set-mock-usage', (_e, payload: {
  usage?: Partial<UsageData>
  profile?: ProfileData
  beta?: BetaProvidersData
  ccPace?: CcPaceData
}) => {
  if (app.isPackaged) return { ok: false, error: 'debug mock is unavailable in packaged builds' }
  if (payload.usage) lastUsage = { ...EMPTY_USAGE, ...(lastUsage ?? {}), ...payload.usage }
  if (payload.profile) lastProfile = payload.profile
  if (payload.beta) lastBeta = payload.beta
  if (payload.ccPace) lastCcPace = payload.ccPace
  lastSuccessAt = new Date()
  sendToHud(false)
  return { ok: true }
})

// ---- App Lifecycle ----

// ---- Auto Updater ----

function broadcastToWindows(channel: string, ...args: unknown[]): void {
  for (const win of [hudWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

// 単価表(modelPricing.json)はGitHub raw経由でも配信されるため、アプリのバージョンアップ無しに
// 半日おきの再チェックだけで新モデル・新単価に追随できる。
const PRICING_CATALOG_RECHECK_MS = 12 * 60 * 60 * 1000

function schedulePricingCatalogRefresh(): void {
  if (pricingCatalogTimer) clearInterval(pricingCatalogTimer)
  pricingCatalogTimer = setInterval(async () => {
    const before = getPricingCatalogSnapshot().status
    const status = await initializeModelPricing(app.getPath('userData'), log)
    if (status.updatedAt !== before.updatedAt || status.source !== before.source) {
      log('Pricing catalog refreshed:', status)
      broadcastToWindows('pricing-catalog-updated', getPricingCatalogSnapshot())
    }
  }, PRICING_CATALOG_RECHECK_MS)
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
    res.end(JSON.stringify(buildLocalUsagePayload({
      usage: lastUsage,
      lastUpdated: lastSuccessAt?.toISOString() ?? null,
      beta: lastBeta,
      claudePace: lastCcPace,
    })))
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

// ---- Screenshot Mode (README用の画面キャプチャ生成、開発専用) ----
//
// Usage: HUD_SCREENSHOT_MODE=1 npm run dev
// docs/screenshots/*.png に compact/ultra/detail/settings の4枚を書き出して自動終了する。
// SCREENSHOT_MODE が false のときはこの関数群は一切呼ばれない。

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isoInHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

function buildScreenshotSettings(base: Settings): Settings {
  return {
    ...base,
    viewMode: 'compact',
    theme: 'dark',
    language: SCREENSHOT_LOCALE.startsWith('ja') ? 'ja' : 'en',
    tray: {
      ...base.tray,
      show5h: true,
      showExtra: true,
      showFields: {
        seven_day: true,
        seven_day_oauth_apps: true,
        seven_day_opus: true,
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
    window: { ...base.window, ultraPosition: 'top-right' },
    betaProviders: { copilot: { enabled: true } },
    codex: { enabled: true },
    alerts: { five_hour: 90, seven_day: 90 },
  }
}

function buildScreenshotUsage(): UsageData {
  return {
    ...EMPTY_USAGE,
    five_hour: { utilization: 62, resets_at: isoInHours(1.8) },
    seven_day: { utilization: 41, resets_at: isoInHours(3.2 * 24) },
    seven_day_oauth_apps: { utilization: 28, resets_at: isoInHours(3.2 * 24) },
    seven_day_opus: { utilization: 15, resets_at: isoInHours(3.2 * 24) },
    extra_usage: { is_enabled: true, monthly_limit: 2000, used_credits: 164, utilization: 8.2, currency: 'USD' },
  }
}

function buildScreenshotProfile(): ProfileData {
  return {
    account: { display_name: 'Demo User', email: 'demo@example.com', has_claude_max: true, has_claude_pro: true },
    organization: { uuid: 'demo-org', name: 'Demo Workspace', rate_limit_tier: 'default_max_5x' },
  }
}

function buildScreenshotBeta(): BetaProvidersData {
  return {
    copilot: { used: 220, limit: 500, utilization: 44, resetDate: isoInHours(12 * 24), planType: 'business' },
    codex: {
      used: 52, limit: 100, utilization: 52, resetDate: isoInHours(2 * 24), unit: '7d',
      fiveHourUtilization: 35, fiveHourResetDate: isoInHours(2.1),
      primaryWindowMinutes: 300, secondaryWindowMinutes: 10080, planType: 'plus',
      creditBalance: 222.68, creditsUnlimited: false, hasCredits: true,
      rateLimitResetCreditsAvailable: 2,
      pace: {
        provider: 'codex', source: 'codex-rate-limit-delta', available: true,
        burnRatePercentPerMin: 0.18, minutesToLimit: 361, minutesToReset: 126,
        sampleWindowMinutes: 15, sampleCount: 4,
      },
    },
  }
}

function buildScreenshotCcPace(): CcPaceData {
  return {
    provider: 'claude', source: 'claude-code-jsonl',
    available: true, paceTokensInBlock: 148_000, burnRatePerMin: 1250, burnRateCostPerMin: 0.42,
    minutesToLimit: 95, minutesToReset: 140, estimatedLimitTokens: 620_000, estimatedLimitUsd: 18.5,
    calibratedNow: false, sampleCount: 6,
    pricingCatalog: { source: 'bundled', updatedAt: '2026-08-26', reference: 'https://platform.claude.com/docs/en/about-claude/pricing' },
    pricingFallbackModels: [], unpricedModels: [],
  }
}

/** 直近7日分、2時間おきの合成履歴（5hはノコギリ波、週次系はゆるやかな右肩上がり）。 */
function buildScreenshotHistory(): { recordedAt: string; usage: UsageData }[] {
  const points: { recordedAt: string; usage: UsageData }[] = []
  const totalHours = 7 * 24
  const stepHours = 2
  for (let h = totalHours; h >= 0; h -= stepHours) {
    const t = Date.now() - h * 60 * 60 * 1000
    const progress = (totalHours - h) / totalHours // 0 (7日前) -> 1 (現在)
    const fiveHourPhase = ((totalHours - h) % 5) / 5 // 0 -> 1 のノコギリ波（5hごとにリセット）
    const five = Math.min(96, Math.round(8 + fiveHourPhase * 80 + Math.random() * 5))
    const sevenDay = Math.min(88, Math.round(4 + progress * 44 + Math.random() * 4))
    const oauth = Math.min(80, Math.round(3 + progress * 30 + Math.random() * 3))
    const opus = Math.min(55, Math.round(progress * 18 + Math.random() * 3))
    const extra = Math.min(35, Math.round(progress * 9 + Math.random() * 2))
    points.push({
      recordedAt: new Date(t).toISOString().slice(0, 19).replace('T', ' '),
      usage: {
        ...EMPTY_USAGE,
        five_hour: { utilization: five, resets_at: null },
        seven_day: { utilization: sevenDay, resets_at: null },
        seven_day_oauth_apps: { utilization: oauth, resets_at: null },
        seven_day_opus: { utilization: opus, resets_at: null },
        extra_usage: { is_enabled: true, monthly_limit: 2000, used_credits: 0, utilization: extra, currency: 'USD' },
      },
    })
  }
  return points
}

async function captureWindow(win: BrowserWindow, filePath: string, waitMs = 400): Promise<void> {
  await sleep(waitMs)
  const image = await win.webContents.capturePage()
  writeFileSync(filePath, image.toPNG())
  log('screenshot saved:', filePath)
}

// SettingsView/DetailView 自身が overflowY:auto の 100vh コンテナなので、body ではなく #root 直下の実コンテンツ高さを見る
async function measureContentHeight(win: BrowserWindow): Promise<number> {
  return win.webContents.executeJavaScript(
    '(document.getElementById("root")?.firstElementChild?.scrollHeight ?? document.body.scrollHeight)'
  ) as Promise<number>
}

/**
 * ウィンドウ固定サイズより中身が縦に伸びる画面（設定・使用履歴チャート展開時）を、全体が収まる高さまでリサイズしてから撮る。
 * macOS はウィンドウの高さを画面のワークエリア内に収まるようクランプするため（実測: 高さ1700超の要求が~1014pt相当まで
 * クランプされた）、それを超える高さが必要な場合はページ全体が1枚に収まるようズームを下げてから撮影する
 * （言語によって文言の折り返しでコンテンツの高さが変わり、日本語版だけワークエリアを超えて途中で切れることがあった）。
 */
async function captureFullPage(win: BrowserWindow, filePath: string): Promise<void> {
  await sleep(400)
  const [w] = win.getContentSize()
  win.setPosition(win.getPosition()[0], 0)
  const maxDip = Math.max(560, screen.getDisplayMatching(win.getBounds()).workAreaSize.height - 20)

  const contentHeight = await measureContentHeight(win) // zoom=1 の実測CSS px高さ（ズームを変えてもこの値自体はほぼ変わらない）
  let zoom = 1
  let targetHeight = Math.ceil(contentHeight)
  if (targetHeight > maxDip) {
    zoom = Math.max(0.5, (maxDip - 10) / contentHeight)
    win.webContents.setZoomFactor(zoom)
    await sleep(200)
    targetHeight = Math.min(maxDip, Math.ceil(contentHeight * zoom))
  }
  win.setContentSize(w, targetHeight)
  await sleep(250)
  await captureWindow(win, filePath, 250)
  if (zoom !== 1) win.webContents.setZoomFactor(1)
}

async function clickButtonContaining(win: BrowserWindow, candidates: string[]): Promise<void> {
  await win.webContents.executeJavaScript(`
    (() => {
      const candidates = ${JSON.stringify(candidates)};
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && candidates.some(c => b.textContent.includes(c)));
      if (btn) btn.click();
    })();
  `)
}

/** 固定 sleep だけに頼らず、DOM に要素が現れるまでポーリングする（見つからなければ timeoutMs で諦める）。 */
async function waitForSelector(win: BrowserWindow, selector: string, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const found = await win.webContents.executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`)
    if (found) return true
    await sleep(100)
  }
  return false
}

async function runScreenshotMode(): Promise<void> {
  const outDir = join(app.getAppPath(), 'docs', 'screenshots', SCREENSHOT_LOCALE.startsWith('ja') ? 'ja' : 'en')
  mkdirSync(outDir, { recursive: true })

  const settings = buildScreenshotSettings(loadSettings())
  saveSettings(settings)

  lastUsage = buildScreenshotUsage()
  lastProfile = buildScreenshotProfile()
  lastBeta = buildScreenshotBeta()
  lastCcPace = buildScreenshotCcPace()
  lastSuccessAt = new Date()
  debugClearHistory() // 隔離プロファイルを使い回した場合に前回実行分の合成履歴が残らないようにする
  debugSeedHistory(buildScreenshotHistory())

  hudWindow = createHudWindow()
  hudWindow.show()
  await sleep(500)
  sendToHud(false) // lastSuccessAt 等をレンダラーへ push（初回 getUsage() には含まれないため）
  await sleep(100)
  await captureWindow(hudWindow, join(outDir, 'compact.png'))

  switchViewMode('ultra')
  await captureWindow(hudWindow, join(outDir, 'ultra.png'))

  switchViewMode('detail')
  await sleep(300)
  await clickButtonContaining(hudWindow, ['Usage History', '使用履歴'])
  // 固定 sleep だけに頼らず、getHistory() の IPC 往復 + Recharts のレイアウトが終わって
  // 実際にグラフの線が描画されるまで待ってから撮影する
  await waitForSelector(hudWindow, '.recharts-line')
  await sleep(200)
  // 履歴チャートを開くとウィンドウ固定サイズより中身が縦に伸びるため、撮影時だけ全体が入る高さへ広げる
  await captureFullPage(hudWindow, join(outDir, 'detail.png'))

  openSettingsWindow()
  await sleep(500)
  if (settingsWindow) await captureFullPage(settingsWindow, join(outDir, 'settings.png'))

  log('Screenshot mode complete:', outDir)
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

  app.whenReady().then(async () => {
    app.setName('Claude Usage HUD')
    app.dock?.hide()

    if (SCREENSHOT_MODE) {
      await runScreenshotMode()
      app.quit()
      return
    }

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
    await initializeModelPricing(app.getPath('userData'), log)
    schedulePricingCatalogRefresh()

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
  })

  app.on('window-all-closed', (e) => { e.preventDefault() })
}
