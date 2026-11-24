import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  setWindowTheme: (theme: 'light' | 'dark' | 'viewer' | 'viewerLight') => ipcRenderer.send('window:set-control-theme', theme),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximizedChange: (cb: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, val: boolean) => cb(val)
    ipcRenderer.on('window:maximized-changed', handler)
    return () => ipcRenderer.removeListener('window:maximized-changed', handler)
  },
  showApplicationMenu: (x: number, y: number) => ipcRenderer.send('window:show-menu', x, y),
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  getBackendPort: () => ipcRenderer.invoke('getBackendPort'),
  getBackendConfig: () => ipcRenderer.invoke('getBackendConfig'),
  getMcpPolicy: () => ipcRenderer.invoke('mcp:getPolicy'),
  saveMcpPolicy: (policy: Record<string, unknown>) => ipcRenderer.invoke('mcp:savePolicy', policy),
  addMcpApprovedFolder: () => ipcRenderer.invoke('mcp:addApprovedFolder'),
  getMcpClientConfig: () => ipcRenderer.invoke('mcp:getClientConfig'),
  getMcpAuditLog: () => ipcRenderer.invoke('mcp:getAuditLog'),
  stopMcpHeadless: () => ipcRenderer.invoke('mcp:stopHeadless'),
})
