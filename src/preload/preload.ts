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
  }
})
