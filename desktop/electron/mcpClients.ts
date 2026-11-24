import * as fs from 'fs'
import os from 'os'
import path from 'path'

export type McpClientId = 'claude-desktop' | 'cursor' | 'claude-code' | 'vscode'

export interface McpServerEntry {
  command: string
  args: string[]
}

export interface McpEnvOptions {
  homeDir?: string
  platform?: NodeJS.Platform
  appData?: string
}

export interface McpClientStatus {
  id: McpClientId
  name: string
  configPath: string
  installed: boolean
  connected: boolean
  upToDate: boolean
}

export interface McpClientActionResult {
  ok: boolean
  clientId: McpClientId
  configPath: string
  backupPath?: string
  error?: string
}

interface ClientDef {
  id: McpClientId
  name: string
  rootKey: 'mcpServers' | 'servers'
  needsTypeField: boolean
  resolvePath: (home: string, platform: NodeJS.Platform, appData: string) => string
  detectInstalled: (configPath: string, home: string) => boolean
}

const CLIENT_DEFS: ClientDef[] = [
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    rootKey: 'mcpServers',
    needsTypeField: false,
    resolvePath: (home, platform, appData) => {
      if (platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      }
      if (platform === 'win32') {
        return path.join(appData, 'Claude', 'claude_desktop_config.json')
      }
      return path.join(home, '.config', 'Claude', 'claude_desktop_config.json')
    },
    detectInstalled: (configPath) => fs.existsSync(configPath) || fs.existsSync(path.dirname(configPath)),
  },
  {
    id: 'cursor',
    name: 'Cursor',
    rootKey: 'mcpServers',
    needsTypeField: false,
    resolvePath: (home) => path.join(home, '.cursor', 'mcp.json'),
    detectInstalled: (configPath) => fs.existsSync(configPath) || fs.existsSync(path.dirname(configPath)),
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    rootKey: 'mcpServers',
    needsTypeField: false,
    resolvePath: (home) => path.join(home, '.claude.json'),
    detectInstalled: (configPath, home) => fs.existsSync(configPath) || fs.existsSync(path.join(home, '.claude')),
  },
  {
    id: 'vscode',
    name: 'VS Code',
    rootKey: 'servers',
    needsTypeField: true,
    resolvePath: (home, platform, appData) => {
      if (platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
      }
      if (platform === 'win32') {
        return path.join(appData, 'Code', 'User', 'mcp.json')
      }
      return path.join(home, '.config', 'Code', 'User', 'mcp.json')
    },
    detectInstalled: (configPath) => fs.existsSync(configPath) || fs.existsSync(path.dirname(configPath)),
  },
]

function resolveEnv(envOpts?: McpEnvOptions) {
  const home = envOpts?.homeDir ?? os.homedir()
  const platform = envOpts?.platform ?? process.platform
  const appData = envOpts?.appData ?? process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming')
  return { home, platform, appData }
}

function getClientDef(clientId: McpClientId): ClientDef {
  const found = CLIENT_DEFS.find((d) => d.id === clientId)
  if (!found) {
    throw new Error(`Unknown MCP client: ${clientId}`)
  }
  return found
}

function readJsonObject(configPath: string): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (!fs.existsSync(configPath)) {
    return { ok: true, data: {} }
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf8').trim()
    if (!raw) {
      return { ok: true, data: {} }
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: 'Existing config file must contain a JSON object at top level.' }
    }
    return { ok: true, data: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, error: 'Existing config file contains invalid JSON. Fix it manually before connecting.' }
  }
}

function writeJsonAtomic(configPath: string, data: Record<string, unknown>, platform: NodeJS.Platform): void {
  const dir = path.dirname(configPath)
  fs.mkdirSync(dir, { recursive: true })
  const tmpPath = path.join(dir, `.tmp-snapsort-${process.pid}-${Date.now()}.json`)
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmpPath, configPath)
  if (platform !== 'win32') {
    try {
      fs.chmodSync(configPath, 0o600)
    } catch {
      // ignore chmod errors
    }
  }
}

function entriesEqual(existing: unknown, expected: Record<string, unknown>): boolean {
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
    return false
  }
  const obj = existing as Record<string, unknown>
  if (obj['command'] !== expected['command']) return false
  if (expected['type'] && obj['type'] !== expected['type']) return false
  const existingArgs = Array.isArray(obj['args']) ? obj['args'] : null
  const expectedArgs = Array.isArray(expected['args']) ? expected['args'] : null
  if (!existingArgs || !expectedArgs || existingArgs.length !== expectedArgs.length) {
    return false
  }
  return expectedArgs.every((val, idx) => existingArgs[idx] === val)
}

function buildTargetEntry(def: ClientDef, serverEntry: McpServerEntry): Record<string, unknown> {
  return def.needsTypeField
    ? { type: 'stdio', command: serverEntry.command, args: [...serverEntry.args] }
    : { command: serverEntry.command, args: [...serverEntry.args] }
}

export function detectMcpClients(serverEntry: McpServerEntry, envOpts?: McpEnvOptions): McpClientStatus[] {
  const { home, platform, appData } = resolveEnv(envOpts)
  return CLIENT_DEFS.map((def) => {
    const configPath = def.resolvePath(home, platform, appData)
    const installed = def.detectInstalled(configPath, home)
    const expected = buildTargetEntry(def, serverEntry)
    let connected = false
    let upToDate = false

    const parsed = readJsonObject(configPath)
    if (parsed.ok) {
      const container = parsed.data[def.rootKey]
      if (typeof container === 'object' && container !== null && !Array.isArray(container)) {
        const entry = (container as Record<string, unknown>)['snapsort']
        if (entry !== undefined) {
          connected = true
          upToDate = entriesEqual(entry, expected)
        }
      }
    }

    return {
      id: def.id,
      name: def.name,
      configPath,
      installed,
      connected,
      upToDate,
    }
  })
}

export function connectMcpClient(
  clientId: McpClientId,
  serverEntry: McpServerEntry,
  envOpts?: McpEnvOptions,
): McpClientActionResult {
  const def = getClientDef(clientId)
  const { home, platform, appData } = resolveEnv(envOpts)
  const configPath = def.resolvePath(home, platform, appData)
  const parsed = readJsonObject(configPath)
  if (!parsed.ok) {
    return { ok: false, clientId, configPath, error: parsed.error }
  }

  let backupPath: string | undefined
  if (fs.existsSync(configPath)) {
    backupPath = `${configPath}.snapsort.bak`
    fs.copyFileSync(configPath, backupPath)
  }

  const root = { ...parsed.data }
  const existingContainer = root[def.rootKey]
  if (existingContainer !== undefined && (typeof existingContainer !== 'object' || existingContainer === null || Array.isArray(existingContainer))) {
    return {
      ok: false,
      clientId,
      configPath,
      error: `Expected "${def.rootKey}" in ${configPath} to be a JSON object.`,
    }
  }

  const nextContainer = {
    ...((existingContainer as Record<string, unknown> | undefined) ?? {}),
    snapsort: buildTargetEntry(def, serverEntry),
  }
  root[def.rootKey] = nextContainer
  writeJsonAtomic(configPath, root, platform)

  return { ok: true, clientId, configPath, backupPath }
}

export function disconnectMcpClient(clientId: McpClientId, envOpts?: McpEnvOptions): McpClientActionResult {
  const def = getClientDef(clientId)
  const { home, platform, appData } = resolveEnv(envOpts)
  const configPath = def.resolvePath(home, platform, appData)
  if (!fs.existsSync(configPath)) {
    return { ok: true, clientId, configPath }
  }

  const parsed = readJsonObject(configPath)
  if (!parsed.ok) {
    return { ok: false, clientId, configPath, error: parsed.error }
  }

  const root = { ...parsed.data }
  const existingContainer = root[def.rootKey]
  if (typeof existingContainer !== 'object' || existingContainer === null || Array.isArray(existingContainer)) {
    return { ok: true, clientId, configPath }
  }

  const containerCopy = { ...(existingContainer as Record<string, unknown>) }
  if (!Object.prototype.hasOwnProperty.call(containerCopy, 'snapsort')) {
    return { ok: true, clientId, configPath }
  }

  const backupPath = `${configPath}.snapsort.bak`
  fs.copyFileSync(configPath, backupPath)
  delete containerCopy['snapsort']
  root[def.rootKey] = containerCopy
  writeJsonAtomic(configPath, root, platform)

  return { ok: true, clientId, configPath, backupPath }
}
