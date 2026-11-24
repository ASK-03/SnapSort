import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  setWindowTheme: (theme: 'light' | 'dark' | 'viewer' | 'viewerLight') => ipcRenderer.send('window:set-control-theme', theme),
  showApplicationMenu: (x: number, y: number) => ipcRenderer.send('window:show-menu', x, y),
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  getBackendPort: () => ipcRenderer.invoke('getBackendPort')
})
