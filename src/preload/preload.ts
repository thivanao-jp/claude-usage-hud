import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  getUsage: () => ipcRenderer.invoke('get-usage'),
  getHistory: (days: number) => ipcRenderer.invoke('get-history', days),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s: unknown) => ipcRenderer.invoke('save-settings', s),
  refresh: () => ipcRenderer.invoke('refresh'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  closeDetail: () => ipcRenderer.invoke('close-detail'),
  autoDetectToken: () => ipcRenderer.invoke('auto-detect-token'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  onUsageUpdate: (cb: (data: unknown) => void) => {
    ipcRenderer.on('usage-update', (_e, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('usage-update')
  }
})
