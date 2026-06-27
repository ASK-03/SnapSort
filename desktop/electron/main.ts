import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn, exec, ChildProcess } from 'child_process'
import net from 'net'

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

function checkPythonInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const pythonExecutable = process.platform === 'win32' ? 'python' : 'python3';
    exec(`${pythonExecutable} --version`, (error) => {
      resolve(!error);
    });
  });
}

function startPythonBackend(port: number) {
  const isWin = process.platform === 'win32';
  const pythonExecutable = isWin ? 'python' : 'python3';
  
  const backendDir = app.isPackaged 
    ? path.join(process.resourcesPath, 'backend') 
    : path.join(__dirname, '../../backend');
  const apiScript = path.join(backendDir, 'api.py');
  
  const cwd = app.isPackaged 
    ? process.resourcesPath 
    : path.join(__dirname, '../../');

  console.log(`Starting Python backend on port ${port}...`)
  console.log(`Executable: ${pythonExecutable}`)
  console.log(`Script: ${apiScript}`)

  pythonProcess = spawn(pythonExecutable, [apiScript, '--port', port.toString()], {
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
    // Frameless window option for a modern look (optional)
    // titleBarStyle: 'hidden',
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
  const hasPython = await checkPythonInstalled();
  if (!hasPython) {
    dialog.showErrorBox(
      'Python Required',
      'SnapSort requires Python 3.10+ to be installed on your system to run its AI backend. Please install Python and try again.'
    );
    app.quit();
    return;
  }

  try {
    backendPort = await getFreePort();
  } catch (e) {
    console.warn("Failed to get free port, using default 8000", e);
  }
  startPythonBackend(backendPort)
  
  // Expose the dynamic backend port to the frontend
  ipcMain.handle('getBackendPort', () => backendPort)
  
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
