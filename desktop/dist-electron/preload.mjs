let electron = require("electron");
//#region electron/preload.ts
electron.contextBridge.exposeInMainWorld("electronAPI", {
	openDirectory: () => electron.ipcRenderer.invoke("dialog:openDirectory"),
	getBackendPort: () => electron.ipcRenderer.invoke("getBackendPort")
});
//#endregion
