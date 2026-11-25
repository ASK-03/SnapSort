import { app, BrowserWindow, ipcMain, dialog, Menu, session, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn, execFile, ChildProcess } from 'child_process'
import crypto from 'crypto'
import http from 'http'
import net from 'net'
import * as fs from 'fs'
import {
  connectMcpClient,
  detectMcpClients,
  disconnectMcpClient,
  type McpClientId,
  type McpServerEntry,
} from './mcpClients'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_VERSION = '3.1.0'

let mainWindow: BrowserWindow | null = null
let pythonProcess: ChildProcess | null = null
let backendPort = 8000
let backendToken = ''
let backendInstanceId = ''
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let viewerPollTimer: ReturnType<typeof setInterval> | null = null
let isDetaching = false

interface McpViewerRequest {
  id: string
  paths: string[]
  query?: string | null
}

let pendingViewerRequest: McpViewerRequest | null = null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

interface McpPolicy {
  version: number
  mcp_enabled: boolean
  headless_enabled: boolean
  allow_agent_scan: boolean
  allow_viewer_open: boolean
  allow_launch_desktop: boolean
  allow_previews: boolean
  max_preview_images: number
  max_headless_scan_images: number
  approved_roots: string[]
}

const DEFAULT_POLICY: McpPolicy = {
  version: 1,
  mcp_enabled: false,
  headless_enabled: false,
  allow_agent_scan: false,
  allow_viewer_open: true,
  allow_launch_desktop: false,
  allow_previews: false,
  max_preview_images: 5,
  max_headless_scan_images: 5000,
  approved_roots: [],
}

function getDataDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'data')
  }
  return path.resolve(__dirname, '../../data')
}

function getModelsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'models')
  }
  return path.resolve(__dirname, '../../models')
}

function getRuntimeFilePath(): string {
  return path.join(getDataDir(), 'mcp-runtime.json')
}

function getPolicyFilePath(): string {
  return path.join(getDataDir(), 'mcp-policy.json')
}

function getAuditFilePath(): string {
  return path.join(getDataDir(), 'mcp-audit.log')
}

function writeJsonAtomicPrivate(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmpPath = path.join(dir, `.tmp-${process.pid}-${Date.now()}.json`)
  const payload = JSON.stringify(data, null, 2)
  fs.writeFileSync(tmpPath, payload, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmpPath, filePath)
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(filePath, 0o600)
    } catch {
      // ignore chmod errors
    }
  }
}

function normalizePolicy(raw: Partial<McpPolicy> | null | undefined): McpPolicy {
  const rootsRaw = Array.isArray(raw?.approved_roots) ? raw.approved_roots : []
  const seen = new Set<string>()
  const approved_roots: string[] = []
  for (const r of rootsRaw) {
    if (typeof r !== 'string' || !r.trim()) continue
    try {
      const real = fs.existsSync(r.trim()) ? fs.realpathSync(r.trim()) : path.resolve(r.trim())
      const key = process.platform === 'win32' ? real.toLowerCase() : real
      if (!seen.has(key)) {
        seen.add(key)
        approved_roots.push(real)
      }
    } catch {
      // ignore invalid path
    }
  }
  const cap = Number(raw?.max_headless_scan_images ?? DEFAULT_POLICY.max_headless_scan_images)
  const maxPreview = Number(raw?.max_preview_images ?? DEFAULT_POLICY.max_preview_images)
  return {
    version: 1,
    mcp_enabled: Boolean(raw?.mcp_enabled),
    headless_enabled: Boolean(raw?.headless_enabled),
    allow_agent_scan: Boolean(raw?.allow_agent_scan),
    allow_viewer_open: raw?.allow_viewer_open !== undefined ? Boolean(raw.allow_viewer_open) : true,
    allow_launch_desktop: Boolean(raw?.allow_launch_desktop),
    allow_previews: Boolean(raw?.allow_previews),
    max_preview_images: Number.isFinite(maxPreview) ? Math.max(1, Math.min(10, Math.round(maxPreview))) : 5,
    max_headless_scan_images: Number.isFinite(cap) ? Math.max(1, Math.min(100000, Math.round(cap))) : 5000,
    approved_roots,
  }
}

function loadPolicy(): McpPolicy {
  const filePath = getPolicyFilePath()
  if (!fs.existsSync(filePath)) return { ...DEFAULT_POLICY }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return normalizePolicy(raw)
  } catch {
    return { ...DEFAULT_POLICY }
  }
}

function savePolicy(raw: Partial<McpPolicy>): McpPolicy {
  const policy = normalizePolicy(raw)
  writeJsonAtomicPrivate(getPolicyFilePath(), policy)
  return policy
}

function readRuntimeInfo(): Record<string, unknown> | null {
  const filePath = getRuntimeFilePath()
  if (!fs.existsSync(filePath)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

function removeRuntimeIfMatches(instanceId: string): void {
  if (!instanceId) return
  const info = readRuntimeInfo()
  if (info && info['instance_id'] === instanceId) {
    try {
      fs.unlinkSync(getRuntimeFilePath())
    } catch {
      // ignore
    }
  }
}

function backendHttpJson(
  port: number,
  token: string,
  method: string,
  reqPath: string,
  body?: Record<string, unknown>,
  timeoutMs = 2000,
): Promise<{ status: number; data: Record<string, unknown> | null }> {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : undefined
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: reqPath,
        method,
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed: Record<string, unknown> | null = null
          try {
            parsed = text ? JSON.parse(text) : null
          } catch {
            parsed = null
          }
          resolve({ status: res.statusCode ?? 500, data: parsed })
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, data: null })
    })
    req.on('error', () => resolve({ status: 0, data: null }))
    if (payload) req.write(payload)
    req.end()
  })
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close((err) => {
        if (err) reject(err)
        else resolve(port)
      })
    })
    srv.on('error', reject)
  })
}

function getDevPython(): string {
  const isWin = process.platform === 'win32'
  const projectPython = path.resolve(__dirname, '../../.venv', isWin ? 'Scripts/python.exe' : 'bin/python')
  return fs.existsSync(projectPython) ? projectPython : (isWin ? 'python' : 'python3')
}

function checkDevPython(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(getDevPython(), ['-c', 'import fastapi'], (error) => {
      if (error) console.error(error.message)
      resolve(!error)
    })
  })
}

async function tryAttachExistingBackend(): Promise<boolean> {
  const info = readRuntimeInfo()
  if (!info) return false
  const port = Number(info['port'])
  const token = String(info['token'] ?? '')
  const instanceId = String(info['instance_id'] ?? '')
  if (!port || !token || !instanceId) return false

  const statusRes = await backendHttpJson(port, token, 'GET', '/api/status')
  if (statusRes.status !== 200 || !statusRes.data?.['initialised']) return false

  const dataDir = getDataDir()
  const expectedDir = fs.existsSync(dataDir) ? fs.realpathSync(dataDir) : path.resolve(dataDir)
  const actualDir = String(statusRes.data['data_dir'] ?? '')
  if (actualDir !== expectedDir || statusRes.data['instance_id'] !== instanceId) {
    return false
  }

  if (statusRes.data['app_version'] !== APP_VERSION) {
    await backendHttpJson(port, token, 'POST', '/api/shutdown')
    await new Promise((r) => setTimeout(r, 400))
    return false
  }

  const attachRes = await backendHttpJson(port, token, 'POST', '/api/client/attach', {
    desktop_pid: process.pid,
  })
  if (attachRes.status !== 200) return false

  backendPort = port
  backendToken = token
  backendInstanceId = instanceId
  console.log(`Attached to existing backend on port ${backendPort} (instance=${backendInstanceId})`)
  return true
}

function startPythonBackend(port: number, token: string, instanceId: string): void {
  const isWin = process.platform === 'win32'
  const dataDir = getDataDir()
  const modelsDir = getModelsDir()
  fs.mkdirSync(dataDir, { recursive: true })

  let pythonExecutable: string
  let args: string[]
  let cwd: string

  if (app.isPackaged) {
    const binaryName = isWin ? 'api.exe' : 'api'
    pythonExecutable = path.join(process.resourcesPath, 'backend', binaryName)
    if (!isWin) {
      try {
        fs.chmodSync(pythonExecutable, '755')
      } catch (e) {
        console.error('Failed to set executable permissions on backend binary', e)
      }
    }
    args = [
      '--port', port.toString(),
      '--data-dir', dataDir,
      '--models-dir', modelsDir,
      '--instance-id', instanceId,
    ]
    cwd = process.resourcesPath
  } else {
    pythonExecutable = getDevPython()
    const apiScript = path.join(__dirname, '../../backend/api.py')
    args = [
      apiScript,
      '--port', port.toString(),
      '--data-dir', dataDir,
      '--models-dir', modelsDir,
      '--instance-id', instanceId,
    ]
    cwd = path.join(__dirname, '../../')
  }

  console.log(`Starting Python backend on port ${port}...`)
  pythonProcess = spawn(pythonExecutable, args, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      SNAPSORT_API_TOKEN: token,
      SNAPSORT_INSTANCE_ID: instanceId,
      SNAPSORT_DESKTOP_PID: String(process.pid),
      SNAPSORT_DATA_DIR: dataDir,
      SNAPSORT_MODELS_DIR: modelsDir,
      SNAPSORT_PORT: port.toString(),
    },
  })

  pythonProcess.stdout?.on('data', (data) => {
    console.log(`[Python] ${data.toString()}`)
  })

  pythonProcess.stderr?.on('data', (data) => {
    console.error(`[Python] ${data.toString()}`)
  })

  const spawnedInstance = instanceId
  pythonProcess.on('close', (code) => {
    console.log(`Python process exited with code ${code}`)
    removeRuntimeIfMatches(spawnedInstance)
    pythonProcess = null
  })
}

async function detachOrStopBackend(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (viewerPollTimer) {
    clearInterval(viewerPollTimer)
    viewerPollTimer = null
  }
  if (!backendToken || !backendPort) return

  const res = await backendHttpJson(backendPort, backendToken, 'POST', '/api/client/detach', undefined, 1500)
  if (res.status === 200 && res.data?.['action'] === 'continuing_headless') {
    console.log('Detached cleanly; backend continuing in headless mode for active work.')
    pythonProcess = null
    return
  }

  if (pythonProcess) {
    console.log('Stopping Python backend...')
    try {
      pythonProcess.kill('SIGTERM')
    } catch {
      // ignore
    }
    removeRuntimeIfMatches(backendInstanceId)
    pythonProcess = null
  }
}

async function waitForBackendReady(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await backendHttpJson(backendPort, backendToken, 'GET', '/api/status', undefined, 1000)
    if (res.status === 200 && res.data?.['initialised']) return
    await new Promise((r) => setTimeout(r, 200))
  }
}

function getMcpServerEntry(): McpServerEntry {
  const dataDir = getDataDir()
  const modelsDir = getModelsDir()
  if (app.isPackaged) {
    const isWin = process.platform === 'win32'
    const adapterBin = path.join(process.resourcesPath, 'backend', isWin ? 'mcp_server.exe' : 'mcp_server')
    const backendBin = path.join(process.resourcesPath, 'backend', isWin ? 'api.exe' : 'api')
    return {
      command: adapterBin,
      args: [
        '--data-dir', dataDir,
        '--models-dir', modelsDir,
        '--backend-bin', backendBin,
      ],
    }
  }

  const repoRoot = path.resolve(__dirname, '../../')
  return {
    command: 'uv',
    args: [
      '--directory', repoRoot,
      'run', 'python', 'backend/mcp_server.py',
      '--data-dir', dataDir,
      '--models-dir', modelsDir,
    ],
  }
}

function buildClientConfig(): { configJson: string; isPackaged: boolean; dataDir: string } {
  const dataDir = getDataDir()
  const entry = getMcpServerEntry()
  const cfg = {
    mcpServers: {
      snapsort: entry,
    },
  }
  return { configJson: JSON.stringify(cfg, null, 2), isPackaged: app.isPackaged, dataDir }
}

type WindowTheme = 'light' | 'dark' | 'viewer' | 'viewerLight'

const windowBgColors: Record<WindowTheme, string> = {
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
    ...(process.platform === 'darwin' && {
      titleBarOverlay: true,
      trafficLightPosition: { x: 12, y: 14 },
    }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })
  if (process.platform !== 'darwin') mainWindow.setMenuBarVisibility(false)

  const emitMaximized = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized())
  }
  mainWindow.on('maximize', emitMaximized)
  mainWindow.on('unmaximize', emitMaximized)
  mainWindow.on('enter-full-screen', emitMaximized)
  mainWindow.on('leave-full-screen', emitMaximized)

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
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    mainWindow = null
  }
})

app.on('before-quit', (event) => {
  if (isDetaching) return
  event.preventDefault()
  isDetaching = true
  detachOrStopBackend().finally(() => {
    app.quit()
  })
})

app.whenReady().then(async () => {
  if (!app.isPackaged) {
    if (!(await checkDevPython())) {
      dialog.showErrorBox(
        'SnapSort backend setup required',
        'Could not load FastAPI. Run "uv sync --locked --python 3.12" from the SnapSort repository root, then restart the dev server.'
      )
      app.quit()
      return
    }
  }

  const attached = await tryAttachExistingBackend()
  if (!attached) {
    try {
      backendPort = await getFreePort()
    } catch (e) {
      console.warn('Failed to get free port, using default 8000', e)
    }
    backendToken = crypto.randomBytes(32).toString('base64url')
    backendInstanceId = crypto.randomUUID()
    startPythonBackend(backendPort, backendToken, backendInstanceId)
    await waitForBackendReady()
  }

  // Inject bearer token on Electron media/API requests without leaking secrets in URLs
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://127.0.0.1:*/*'] },
    (details, callback) => {
      if (backendToken && details.url.startsWith(`http://127.0.0.1:${backendPort}/`)) {
        details.requestHeaders['Authorization'] = `Bearer ${backendToken}`
      }
      callback({ requestHeaders: details.requestHeaders })
    },
  )

  heartbeatTimer = setInterval(() => {
    if (backendToken && backendPort) {
      void backendHttpJson(backendPort, backendToken, 'POST', '/api/client/heartbeat')
    }
  }, 15000)

  const writeDesktopLaunchMetadata = (): void => {
    const appDir = path.resolve(__dirname, '..')
    writeJsonAtomicPrivate(path.join(getDataDir(), 'desktop-launch.json'), {
      command: process.execPath,
      args: app.isPackaged ? [] : [appDir],
      cwd: app.isPackaged ? path.dirname(process.execPath) : appDir,
    })
  }
  writeDesktopLaunchMetadata()

  const pollViewerRequest = async (): Promise<void> => {
    if (!backendToken || !backendPort) return
    const pol = loadPolicy()
    if (!pol.mcp_enabled || !pol.allow_viewer_open) return
    const res = await backendHttpJson(backendPort, backendToken, 'GET', '/api/client/viewer/pending', undefined, 1500)
    const rawReq = res.status === 200 ? res.data?.['request'] : null
    if (
      rawReq &&
      typeof rawReq === 'object' &&
      Array.isArray((rawReq as McpViewerRequest).paths) &&
      (rawReq as McpViewerRequest).paths.length > 0
    ) {
      const req = rawReq as McpViewerRequest
      pendingViewerRequest = req
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
        mainWindow.webContents.send('mcp:open-viewer', req)
      }
    }
  }

  viewerPollTimer = setInterval(() => {
    void pollViewerRequest()
  }, 1000)

  ipcMain.handle('mcp:consumePendingViewer', async () => {
    if (!pendingViewerRequest) {
      await pollViewerRequest()
    }
    const next = pendingViewerRequest
    pendingViewerRequest = null
    return next
  })

  ipcMain.handle('getBackendPort', () => backendPort)
  ipcMain.handle('getBackendConfig', () => ({ port: backendPort, token: backendToken }))

  ipcMain.handle('mcp:getPolicy', () => loadPolicy())
  ipcMain.handle('mcp:savePolicy', async (_event, nextPolicy: Partial<McpPolicy>) => {
    const saved = savePolicy(nextPolicy)
    await backendHttpJson(backendPort, backendToken, 'POST', '/api/mcp/policy/sync')
    return saved
  })

  ipcMain.handle('mcp:addApprovedFolder', async () => {
    if (!mainWindow) return loadPolicy()
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })
    if (canceled || !filePaths[0]) return loadPolicy()
    const current = loadPolicy()
    const saved = savePolicy({
      ...current,
      approved_roots: [...current.approved_roots, filePaths[0]],
    })
    await backendHttpJson(backendPort, backendToken, 'POST', '/api/mcp/policy/sync')
    return saved
  })

  ipcMain.handle('mcp:getClientConfig', () => buildClientConfig())
  ipcMain.handle('mcp:listClients', () => detectMcpClients(getMcpServerEntry()))
  ipcMain.handle('mcp:connectClient', async (_event, clientId: McpClientId) => {
    const entry = getMcpServerEntry()
    const result = connectMcpClient(clientId, entry)
    let policy = loadPolicy()
    if (result.ok && !policy.mcp_enabled) {
      policy = savePolicy({ ...policy, mcp_enabled: true })
      await backendHttpJson(backendPort, backendToken, 'POST', '/api/mcp/policy/sync')
    }
    return {
      result,
      clients: detectMcpClients(entry),
      policy,
    }
  })
  ipcMain.handle('mcp:disconnectClient', (_event, clientId: McpClientId) => {
    const entry = getMcpServerEntry()
    const result = disconnectMcpClient(clientId)
    return {
      result,
      clients: detectMcpClients(entry),
    }
  })

  ipcMain.handle('mcp:getAuditLog', () => {
    const auditPath = getAuditFilePath()
    if (!fs.existsSync(auditPath)) return []
    try {
      const lines = fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean)
      return lines
        .slice(-30)
        .reverse()
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter(Boolean)
    } catch {
      return []
    }
  })

  ipcMain.handle('mcp:stopHeadless', async () => {
    await backendHttpJson(backendPort, backendToken, 'POST', '/api/mcp/revoke')
    const current = loadPolicy()
    const saved = savePolicy({ ...current, mcp_enabled: false, headless_enabled: false })
    await backendHttpJson(backendPort, backendToken, 'POST', '/api/mcp/policy/sync')
    return saved
  })

  ipcMain.on('window:set-control-theme', (event, theme: WindowTheme) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !Object.hasOwn(windowBgColors, theme)) return
    mainWindow.setBackgroundColor(windowBgColors[theme])
  })

  ipcMain.on('window:minimize', (event) => {
    if (mainWindow && event.sender === mainWindow.webContents) {
      mainWindow.minimize()
    }
  })

  ipcMain.on('window:toggle-maximize', (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })

  ipcMain.on('window:close', (event) => {
    if (mainWindow && event.sender === mainWindow.webContents) {
      mainWindow.close()
    }
  })

  ipcMain.handle('window:is-maximized', () => Boolean(mainWindow?.isMaximized()))

  ipcMain.on('window:show-menu', (event, x: number, y: number) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    const zoom = event.sender.getZoomFactor()
    Menu.getApplicationMenu()?.popup({
      window: mainWindow,
      x: Math.round(x * zoom),
      y: Math.round(y * zoom),
    })
  })

  createWindow()

  ipcMain.handle('dialog:openDirectory', async () => {
    if (!mainWindow) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })
    if (canceled) {
      return null
    }
    return filePaths[0]
  })
})
