import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  getUsage: () => ipcRenderer.invoke('get-usage'),
  getHistory: (days: number) => ipcRenderer.invoke('get-history', days),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s: unknown) => ipcRenderer.invoke('save-settings', s),
  setViewMode: (mode: string) => ipcRenderer.invoke('set-view-mode', mode),
  refresh: () => ipcRenderer.invoke('refresh'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  closeHud: () => ipcRenderer.invoke('close-hud'),
  autoDetectToken: () => ipcRenderer.invoke('auto-detect-token'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  showLoginWindow: () => ipcRenderer.invoke('show-login-window'),
  hideLoginWindow: () => ipcRenderer.invoke('hide-login-window'),
  getLoginStatus: () => ipcRenderer.invoke('get-login-status'),
  onUsageUpdate: (cb: (data: unknown) => void) => {
    ipcRenderer.on('usage-update', (_e, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('usage-update')
  },
  onModeChanged: (cb: (mode: string) => void) => {
    ipcRenderer.on('mode-changed', (_e, mode) => cb(mode))
    return () => ipcRenderer.removeAllListeners('mode-changed')
  },
  onLoginStatusChanged: (cb: (status: string) => void) => {
    ipcRenderer.on('login-status-changed', (_e, status) => cb(status))
    return () => ipcRenderer.removeAllListeners('login-status-changed')
  },
  onSettingsChanged: (cb: (s: unknown) => void) => {
    ipcRenderer.on('settings-changed', (_e, s) => cb(s))
    return () => ipcRenderer.removeAllListeners('settings-changed')
  },
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (cb: (status: unknown) => void) => {
    ipcRenderer.on('update-status', (_e, status) => cb(status))
    return () => ipcRenderer.removeAllListeners('update-status')
  },
  getPricingCatalog: () => ipcRenderer.invoke('get-pricing-catalog'),
  refreshPricingCatalog: () => ipcRenderer.invoke('refresh-pricing-catalog'),
  onPricingCatalogUpdated: (cb: (snapshot: unknown) => void) => {
    ipcRenderer.on('pricing-catalog-updated', (_e, snapshot) => cb(snapshot))
    return () => ipcRenderer.removeAllListeners('pricing-catalog-updated')
  },
  setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.send('set-ignore-mouse-events', ignore),
  setWindowOpacity: (opacity: number) => ipcRenderer.send('set-window-opacity', opacity),
  // cc-pace-meter
  getCcPaceData: () => ipcRenderer.invoke('get-cc-pace-data'),
  // Beta providers
  getBetaData: () => ipcRenderer.invoke('get-beta-data'),
  getCopilotLoginStatus: () => ipcRenderer.invoke('get-copilot-login-status'),
  getCodexLoginStatus: () => ipcRenderer.invoke('get-codex-login-status'),
  showCopilotLoginWindow: () => ipcRenderer.invoke('show-copilot-login-window'),
  hideCopilotLoginWindow: () => ipcRenderer.invoke('hide-copilot-login-window'),
  showCodexLoginWindow: () => ipcRenderer.invoke('show-codex-login-window'),
  hideCodexLoginWindow: () => ipcRenderer.invoke('hide-codex-login-window'),
  // Debug only (no-ops in packaged builds) — see src/main/main.ts `debug-set-mock-usage`
  debugSetMockUsage: (payload: unknown) => ipcRenderer.invoke('debug-set-mock-usage', payload),
})
