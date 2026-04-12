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
  onUsageUpdate: (cb: (data: unknown) => void) => {
    ipcRenderer.on('usage-update', (_e, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('usage-update')
  },
  onModeChanged: (cb: (mode: string) => void) => {
    ipcRenderer.on('mode-changed', (_e, mode) => cb(mode))
    return () => ipcRenderer.removeAllListeners('mode-changed')
  }
})
