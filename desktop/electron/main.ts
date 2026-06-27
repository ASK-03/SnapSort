import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn, ChildProcess } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null
let pythonProcess: ChildProcess | null = null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function startPythonBackend() {
  // In development, we run the python script from the parent folder
  const pythonExecutable = path.join(__dirname, '../../env/bin/python3')
  const apiScript = path.join(__dirname, '../../api.py')

  console.log('Starting Python backend...')
  console.log(`Executable: ${pythonExecutable}`)
  console.log(`Script: ${apiScript}`)

  pythonProcess = spawn(pythonExecutable, [apiScript], {
    cwd: path.join(__dirname, '../../'),
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
      preload: path.join(__dirname, 'preload.js'),
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

app.whenReady().then(() => {
  startPythonBackend()
  
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
