import { BrowserWindow as e, app as t, dialog as n, ipcMain as r } from "electron";
import i from "path";
import { fileURLToPath as a } from "url";
import { spawn as o } from "child_process";
//#region electron/main.ts
var s = i.dirname(a(import.meta.url)), c, l = null, u = process.env.VITE_DEV_SERVER_URL;
function d() {
	let e = i.join(s, "../../env/bin/python3"), t = i.join(s, "../../api.py");
	console.log("Starting Python backend..."), console.log(`Executable: ${e}`), console.log(`Script: ${t}`), l = o(e, [t], {
		cwd: i.join(s, "../../"),
		stdio: "pipe"
	}), l.stdout?.on("data", (e) => {
		console.log(`[Python] ${e.toString()}`);
	}), l.stderr?.on("data", (e) => {
		console.error(`[Python] ${e.toString()}`);
	}), l.on("close", (e) => {
		console.log(`Python process exited with code ${e}`), l = null;
	});
}
function f() {
	l &&= (console.log("Killing Python backend..."), l.kill("SIGINT"), null);
}
function p() {
	c = new e({
		width: 1200,
		height: 800,
		webPreferences: { preload: i.join(s, "preload.js") }
	}), u ? c.loadURL(u) : c.loadFile(i.join(s, "../dist/index.html"));
}
t.on("window-all-closed", () => {
	process.platform !== "darwin" && (t.quit(), c = null);
}), t.on("will-quit", () => {
	f();
}), t.whenReady().then(() => {
	d(), setTimeout(p, 1e3), r.handle("dialog:openDirectory", async () => {
		if (!c) return null;
		let { canceled: e, filePaths: t } = await n.showOpenDialog(c, { properties: ["openDirectory"] });
		return e ? null : t[0];
	});
});
//#endregion
export {};
