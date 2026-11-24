import { app, BrowserWindow, ipcMain, dialog, Menu, session, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn, execFile, ChildProcess } from 'child_process'
import net from 'net'
import * as fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null
let pythonProcess: ChildProcess | null = null
let backendPort = 8000;

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    srv.on('error', reject);
  });
}

function getDevPython(): string {
  const isWin = process.platform === 'win32';
  const projectPython = path.resolve(__dirname, '../../.venv', isWin ? 'Scripts/python.exe' : 'bin/python');
  return fs.existsSync(projectPython) ? projectPython : (isWin ? 'python' : 'python3');
}

function checkDevPython(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(getDevPython(), ['-c', 'import fastapi'], (error) => {
      if (error) console.error(error.message);
      resolve(!error);
    });
  });
}

function startPythonBackend(port: number) {
  const isWin = process.platform === 'win32';
  let pythonExecutable: string;
  let args: string[];
  let cwd: string;

  if (app.isPackaged) {
    // In production, execute the compiled PyInstaller binary
    const binaryName = isWin ? 'api.exe' : 'api';
    pythonExecutable = path.join(process.resourcesPath, 'backend', binaryName);
    
    // Ensure the binary is executable on Unix systems
    if (!isWin) {
      try {
        fs.chmodSync(pythonExecutable, '755');
      } catch (e) {
        console.error('Failed to set executable permissions on backend binary', e);
      }
    }
    
    // User-writable data directory for DB + indexes
    const dataDir = path.join(app.getPath('userData'), 'data');
    // Models are bundled inside the app resources
    const modelsDir = path.join(process.resourcesPath, 'models');
    
    args = ['--port', port.toString(), '--data-dir', dataDir, '--models-dir', modelsDir];
    cwd = process.resourcesPath;
  } else {
    pythonExecutable = getDevPython();
    const apiScript = path.join(__dirname, '../../backend/api.py');
    args = [apiScript, '--port', port.toString()];
    cwd = path.join(__dirname, '../../');
  }

  console.log(`Starting Python backend on port ${port}...`)
  console.log(`Executable: ${pythonExecutable}`)
  console.log(`Args: ${args.join(' ')}`)

  pythonProcess = spawn(pythonExecutable, args, {
    cwd: cwd,
    stdio: 'pipe'
  })

  pythonProcess.stdout?.on('data', (data) => {
    console.log(`[Python] ${data.toString()}`)
  })

  pythonProcess.stderr?.on('data', (data) => {
    console.error(`[Python] ${data.toString()}`)
  })

  pythonProcess.on('close', (code) => {
    console.log(`Python process exited with code ${code}`)
    pythonProcess = null
  })
}

function stopPythonBackend() {
  if (pythonProcess) {
    console.log('Killing Python backend...')
    pythonProcess.kill('SIGINT')
    pythonProcess = null
  }
}

// Use opaque surfaces: on Linux a transparent overlay can inherit the system
// titlebar color even when SnapSort is using the opposite theme.
const titleBarColors = {
  light: { color: '#F5F4F1', symbolColor: '#484B50' },
  dark: { color: '#1E1F22', symbolColor: '#DDDFE3' },
  viewer: { color: '#0D0E10', symbolColor: '#ECEDEE' },
  viewerLight: { color: '#FFFFFF', symbolColor: '#484B50' },
}

const windowBgColors: Record<keyof typeof titleBarColors, string> = {
  light: '#FAF9F6',
  dark: '#141517',
  viewer: '#0A0B0C',
  viewerLight: '#F6F5F1',
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: windowBgColors.dark,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin'
      ? true
      : { height: 44, ...titleBarColors.dark },
    ...(process.platform === 'darwin' && { trafficLightPosition: { x: 12, y: 13 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })
  if (process.platform !== 'darwin') mainWindow.setMenuBarVisibility(false)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isLocal = url.startsWith('file://') || (VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL))
    if (!isLocal && /^https?:\/\//i.test(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // mainWindow.loadFile('dist/index.html')
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    mainWindow = null
  }
})

app.on('will-quit', () => {
  stopPythonBackend()
})

app.whenReady().then(async () => {
  if (!app.isPackaged) {
    if (!(await checkDevPython())) {
      dialog.showErrorBox(
        'SnapSort backend setup required',
        'Could not load FastAPI. Run "uv sync --locked --python 3.12" from the SnapSort repository root, then restart the dev server.'
      );
      app.quit();
      return;
    }
  }

  try {
    backendPort = await getFreePort();
  } catch (e) {
    console.warn("Failed to get free port, using default 8000", e);
  }
  startPythonBackend(backendPort)
  
  // Expose the dynamic backend port to the frontend
  ipcMain.handle('getBackendPort', () => backendPort)

  ipcMain.on('window:set-control-theme', (event, theme: keyof typeof titleBarColors) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !Object.hasOwn(titleBarColors, theme)) return
    mainWindow.setBackgroundColor(windowBgColors[theme])
    if (process.platform !== 'darwin') {
      mainWindow.setTitleBarOverlay(titleBarColors[theme])
    }
  })

  ipcMain.on('window:show-menu', (event, x: number, y: number) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    const zoom = event.sender.getZoomFactor()
    Menu.getApplicationMenu()?.popup({
      window: mainWindow, x: Math.round(x * zoom), y: Math.round(y * zoom),
    })
  })
  
  // Wait a little bit for FastAPI to start before showing the window,
  // or handle connection retries in the React frontend.
  setTimeout(createWindow, 1000)

  ipcMain.handle('dialog:openDirectory', async () => {
    if (!mainWindow) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    if (canceled) {
      return null
    } else {
      return filePaths[0]
    }
  })
})
