import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  shell,
  Notification
} from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { loadSettings, saveSettings, Settings } from './settings'
import { fetchUsage, fetchProfile, UsageData, ProfileData } from './claudeApi'
import { saveUsageHistory, getUsageHistory } from './db'
import { getTokenFromCredentials } from './credentials'

let tray: Tray | null = null
let detailWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let updateTimer: ReturnType<typeof setInterval> | null = null
let lastUsage: UsageData | null = null
let lastProfile: ProfileData | null = null

// ---- Tray ----

function createTray(): void {
  const iconPath = join(__dirname, '../../resources/tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setTitle('--')
  tray.setToolTip('Claude Usage HUD')

  tray.on('click', () => toggleDetailWindow())
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Show Detail', click: () => toggleDetailWindow() },
      { label: 'Settings', click: () => openSettingsWindow() },
      { type: 'separator' },
      { label: 'Refresh Now', click: () => doUpdate() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
    tray!.popUpContextMenu(menu)
  })
}

function updateTrayTitle(usage: UsageData, settings: Settings): void {
  if (!tray) return

  const parts: string[] = []
  if (settings.tray.show5h && usage.five_hour) {
    parts.push(`5h:${Math.round(usage.five_hour.utilization)}%`)
  }
  if (settings.tray.show7d && usage.seven_day) {
    parts.push(`7d:${Math.round(usage.seven_day.utilization)}%`)
  }
  if (settings.tray.showOauth && usage.seven_day_oauth_apps) {
    parts.push(`oa:${Math.round(usage.seven_day_oauth_apps.utilization)}%`)
  }
  if (settings.tray.showOpus && usage.seven_day_opus) {
    parts.push(`op:${Math.round(usage.seven_day_opus.utilization)}%`)
  }

  tray.setTitle(parts.length > 0 ? parts.join(' ') : '--')
}

// ---- Detail Window ----

function createDetailWindow(): BrowserWindow {
  const settings = loadSettings()
  const win = new BrowserWindow({
    width: 360,
    height: 580,
    x: settings.window.x ?? undefined,
    y: settings.window.y ?? undefined,
    frame: false,
    transparent: true,
    alwaysOnTop: settings.window.alwaysOnTop,
    skipTaskbar: true,
    resizable: true,
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
    const [x, y] = win.getPosition()
    const s = loadSettings()
    s.window.x = x
    s.window.y = y
    saveSettings(s)
  })

  win.on('closed', () => {
    detailWindow = null
  })

  return win
}

function toggleDetailWindow(): void {
  if (detailWindow) {
    if (detailWindow.isVisible()) {
      detailWindow.hide()
    } else {
      detailWindow.show()
      detailWindow.focus()
    }
  } else {
    detailWindow = createDetailWindow()
    detailWindow.show()
  }
}

// ---- Settings Window ----

function openSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 520,
    title: 'Settings',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    settingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/settings`)
  } else {
    settingsWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'settings' })
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

// ---- Data Update ----

async function doUpdate(): Promise<void> {
  const settings = loadSettings()
  if (!settings.token) return

  try {
    const [usage, profile] = await Promise.all([
      fetchUsage(settings.token),
      fetchProfile(settings.token)
    ])
    lastUsage = usage
    lastProfile = profile

    saveUsageHistory(usage)
    updateTrayTitle(usage, settings)
    checkAlerts(usage, settings)

    if (detailWindow && !detailWindow.isDestroyed()) {
      detailWindow.webContents.send('usage-update', { usage, profile })
    }
  } catch (err) {
    console.error('Update failed:', err)
    if (tray) tray.setTitle('ERR')
  }
}

function scheduleUpdates(): void {
  if (updateTimer) clearInterval(updateTimer)
  const settings = loadSettings()
  const intervalMs = (settings.updateIntervalMinutes ?? 5) * 60 * 1000
  doUpdate()
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
  if (detailWindow && !detailWindow.isDestroyed()) {
    const s = loadSettings()
    detailWindow.setAlwaysOnTop(s.window.alwaysOnTop)
    detailWindow.setOpacity(s.window.opacity / 100)
  }
})
ipcMain.handle('refresh', () => doUpdate())
ipcMain.handle('open-settings', () => openSettingsWindow())
ipcMain.handle('close-detail', () => detailWindow?.hide())
ipcMain.handle('auto-detect-token', () => getTokenFromCredentials())

ipcMain.handle('open-external', (_e, url: string) => {
  shell.openExternal(url)
})

// ---- App Lifecycle ----

// 多重起動防止
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 2つ目の起動試行があったら既存のウィンドウを前面に出す
    if (detailWindow && !detailWindow.isDestroyed()) {
      detailWindow.show()
      detailWindow.focus()
    }
  })

  app.whenReady().then(() => {
    app.dock?.hide() // macOS: ドックに表示しない
    createTray()
    scheduleUpdates()
  })

  app.on('window-all-closed', (e) => {
    e.preventDefault() // トレイアプリなのでウィンドウが全部閉じても終了しない
  })
}
