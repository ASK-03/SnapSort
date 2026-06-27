import { BrowserWindow, app, dialog, ipcMain } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import net from "net";
//#region electron/main.ts
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var mainWindow;
var pythonProcess = null;
var backendPort = 8e3;
var VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
function getFreePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, "127.0.0.1", () => {
			const port = srv.address().port;
			srv.close((err) => {
				if (err) reject(err);
				else resolve(port);
			});
		});
		srv.on("error", reject);
	});
}
function startPythonBackend(port) {
	const pythonExecutable = path.join(__dirname, "../../env/bin/python3");
	const apiScript = path.join(__dirname, "../../backend/api.py");
	console.log(`Starting Python backend on port ${port}...`);
	console.log(`Executable: ${pythonExecutable}`);
	console.log(`Script: ${apiScript}`);
	pythonProcess = spawn(pythonExecutable, [
		apiScript,
		"--port",
		port.toString()
	], {
		cwd: path.join(__dirname, "../../"),
		stdio: "pipe"
	});
	pythonProcess.stdout?.on("data", (data) => {
		console.log(`[Python] ${data.toString()}`);
	});
	pythonProcess.stderr?.on("data", (data) => {
		console.error(`[Python] ${data.toString()}`);
	});
	pythonProcess.on("close", (code) => {
		console.log(`Python process exited with code ${code}`);
		pythonProcess = null;
	});
}
function stopPythonBackend() {
	if (pythonProcess) {
		console.log("Killing Python backend...");
		pythonProcess.kill("SIGINT");
		pythonProcess = null;
	}
}
function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		webPreferences: { preload: path.join(__dirname, "preload.mjs") }
	});
	if (VITE_DEV_SERVER_URL) mainWindow.loadURL(VITE_DEV_SERVER_URL);
	else mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
}
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
		mainWindow = null;
	}
});
app.on("will-quit", () => {
	stopPythonBackend();
});
app.whenReady().then(async () => {
	try {
		backendPort = await getFreePort();
	} catch (e) {
		console.warn("Failed to get free port, using default 8000", e);
	}
	startPythonBackend(backendPort);
	ipcMain.handle("getBackendPort", () => backendPort);
	setTimeout(createWindow, 1e3);
	ipcMain.handle("dialog:openDirectory", async () => {
		if (!mainWindow) return null;
		const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
		if (canceled) return null;
		else return filePaths[0];
	});
});
//#endregion
export {};
