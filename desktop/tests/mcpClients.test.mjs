import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  connectMcpClient,
  detectMcpClients,
  disconnectMcpClient,
} from '../electron/mcpClients.ts'

const SERVER_ENTRY = {
  command: 'uv',
  args: ['--directory', '/tmp/SnapSort', 'run', 'python', 'backend/mcp_server.py'],
}

test('detectMcpClients resolves paths and status across clients', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-mcp-clients-'))
  try {
    fs.mkdirSync(path.join(tmpHome, '.cursor'), { recursive: true })
    fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true })

    const before = detectMcpClients(SERVER_ENTRY, { homeDir: tmpHome, platform: 'linux' })
    const byId = Object.fromEntries(before.map((c) => [c.id, c]))
    assert.equal(byId['cursor'].installed, true)
    assert.equal(byId['cursor'].connected, false)
    assert.equal(byId['claude-code'].installed, true)
    assert.equal(byId['claude-desktop'].installed, false)
    assert.equal(byId['vscode'].installed, false)
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  }
})

test('connectMcpClient merges safely with backup and preserves existing servers', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-mcp-merge-'))
  try {
    const claudeDir = path.join(tmpHome, '.config', 'Claude')
    const claudeCfg = path.join(claudeDir, 'claude_desktop_config.json')
    fs.mkdirSync(claudeDir, { recursive: true })
    fs.writeFileSync(
      claudeCfg,
      JSON.stringify(
        {
          theme: 'dark',
          mcpServers: {
            otherTool: { command: 'npx', args: ['other-mcp'] },
          },
        },
        null,
        2,
      ),
    )

    const res = connectMcpClient('claude-desktop', SERVER_ENTRY, { homeDir: tmpHome, platform: 'linux' })
    assert.equal(res.ok, true)
    assert.ok(res.backupPath && fs.existsSync(res.backupPath))

    const updated = JSON.parse(fs.readFileSync(claudeCfg, 'utf8'))
    assert.equal(updated.theme, 'dark')
    assert.deepEqual(updated.mcpServers.otherTool, { command: 'npx', args: ['other-mcp'] })
    assert.deepEqual(updated.mcpServers.snapsort, SERVER_ENTRY)

    if (process.platform !== 'win32') {
      const mode = fs.statSync(claudeCfg).mode & 0o777
      assert.equal(mode, 0o600)
    }

    const detected = detectMcpClients(SERVER_ENTRY, { homeDir: tmpHome, platform: 'linux' })
    const claudeStatus = detected.find((c) => c.id === 'claude-desktop')
    assert.equal(claudeStatus.connected, true)
    assert.equal(claudeStatus.upToDate, true)

    // Out-of-date args detected cleanly
    const staleDetected = detectMcpClients(
      { command: 'uv', args: ['--other'] },
      { homeDir: tmpHome, platform: 'linux' },
    )
    const staleStatus = staleDetected.find((c) => c.id === 'claude-desktop')
    assert.equal(staleStatus.connected, true)
    assert.equal(staleStatus.upToDate, false)

    // Disconnect removes only snapsort
    const disc = disconnectMcpClient('claude-desktop', { homeDir: tmpHome, platform: 'linux' })
    assert.equal(disc.ok, true)
    const afterDisc = JSON.parse(fs.readFileSync(claudeCfg, 'utf8'))
    assert.equal(afterDisc.mcpServers.snapsort, undefined)
    assert.deepEqual(afterDisc.mcpServers.otherTool, { command: 'npx', args: ['other-mcp'] })
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  }
})

test('connectMcpClient writes VS Code servers schema and refuses corrupt JSON', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-mcp-vscode-'))
  try {
    const vsRes = connectMcpClient('vscode', SERVER_ENTRY, {
      homeDir: tmpHome,
      platform: 'darwin',
    })
    assert.equal(vsRes.ok, true)
    const vsPath = path.join(tmpHome, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
    const vsJson = JSON.parse(fs.readFileSync(vsPath, 'utf8'))
    assert.deepEqual(vsJson.servers.snapsort, {
      type: 'stdio',
      command: SERVER_ENTRY.command,
      args: SERVER_ENTRY.args,
    })

    // Corrupt JSON refusal
    const cursorCfg = path.join(tmpHome, '.cursor', 'mcp.json')
    fs.mkdirSync(path.dirname(cursorCfg), { recursive: true })
    fs.writeFileSync(cursorCfg, '{ broken json !!!')
    const badRes = connectMcpClient('cursor', SERVER_ENTRY, { homeDir: tmpHome, platform: 'linux' })
    assert.equal(badRes.ok, false)
    assert.match(badRes.error, /invalid JSON/i)
    assert.equal(fs.readFileSync(cursorCfg, 'utf8'), '{ broken json !!!')
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  }
})

test('Antigravity and Antigravity IDE detection, symlink preservation, and disabled handling', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-mcp-agy-'))
  try {
    // 1. Legacy fallback when only ~/.gemini/antigravity exists
    const legacyDir = path.join(tmpHome, '.gemini', 'antigravity')
    fs.mkdirSync(legacyDir, { recursive: true })
    const legacyDetected = detectMcpClients(SERVER_ENTRY, { homeDir: tmpHome, platform: 'linux' })
    const legacyAgy = legacyDetected.find((c) => c.id === 'antigravity')
    assert.equal(legacyAgy.installed, true)
    assert.equal(legacyAgy.configPath, path.join(legacyDir, 'mcp_config.json'))

    // 2. Shared ~/.gemini/config/mcp_config.json with symlink from antigravity/mcp_config.json
    const sharedDir = path.join(tmpHome, '.gemini', 'config')
    const sharedCfg = path.join(sharedDir, 'mcp_config.json')
    const legacyCfg = path.join(legacyDir, 'mcp_config.json')
    const ideDir = path.join(tmpHome, '.gemini', 'antigravity-ide')
    fs.mkdirSync(sharedDir, { recursive: true })
    fs.mkdirSync(ideDir, { recursive: true })
    fs.writeFileSync(sharedCfg, JSON.stringify({ mcpServers: { existing: { command: 'echo', args: ['hi'] } } }))
    fs.symlinkSync(sharedCfg, legacyCfg)

    const connAgy = connectMcpClient('antigravity', SERVER_ENTRY, { homeDir: tmpHome, platform: 'linux' })
    assert.equal(connAgy.ok, true)
    assert.equal(connAgy.configPath, sharedCfg)
    assert.equal(fs.lstatSync(legacyCfg).isSymbolicLink(), true)

    const agyJson = JSON.parse(fs.readFileSync(sharedCfg, 'utf8'))
    assert.deepEqual(agyJson.mcpServers.snapsort, {
      command: SERVER_ENTRY.command,
      args: SERVER_ENTRY.args,
      disabled: false,
    })
    assert.deepEqual(agyJson.mcpServers.existing, { command: 'echo', args: ['hi'] })

    // Mark disabled: true -> upToDate should become false
    agyJson.mcpServers.snapsort.disabled = true
    fs.writeFileSync(sharedCfg, JSON.stringify(agyJson))
    const disabledStatus = detectMcpClients(SERVER_ENTRY, { homeDir: tmpHome, platform: 'linux' }).find(
      (c) => c.id === 'antigravity',
    )
    assert.equal(disabledStatus.connected, true)
    assert.equal(disabledStatus.upToDate, false)

    // Antigravity IDE connect & disconnect
    const connIde = connectMcpClient('antigravity-ide', SERVER_ENTRY, { homeDir: tmpHome, platform: 'linux' })
    assert.equal(connIde.ok, true)
    const ideCfg = path.join(ideDir, 'mcp_config.json')
    assert.equal(JSON.parse(fs.readFileSync(ideCfg, 'utf8')).mcpServers.snapsort.disabled, false)

    const discIde = disconnectMcpClient('antigravity-ide', { homeDir: tmpHome, platform: 'linux' })
    assert.equal(discIde.ok, true)
    assert.equal(JSON.parse(fs.readFileSync(ideCfg, 'utf8')).mcpServers.snapsort, undefined)
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  }
})

test('agy CLI mcp list reads connectMcpClient and disconnectMcpClient output', (t) => {
  try {
    execFileSync('agy', ['--help'], { stdio: 'ignore' })
  } catch {
    t.skip('agy CLI not installed in PATH')
    return
  }

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'snapsort-agy-cli-'))
  try {
    fs.mkdirSync(path.join(tmpHome, '.gemini', 'config'), { recursive: true })
    const res = connectMcpClient('antigravity', SERVER_ENTRY, { homeDir: tmpHome, platform: 'linux' })
    assert.equal(res.ok, true)

    const listOut = execFileSync('agy', ['mcp', 'list'], {
      env: { ...process.env, HOME: tmpHome },
      encoding: 'utf8',
    })
    assert.match(listOut, /snapsort/)
    assert.match(listOut, /stdio/)
    assert.match(listOut, /enabled/)

    const disc = disconnectMcpClient('antigravity', { homeDir: tmpHome, platform: 'linux' })
    assert.equal(disc.ok, true)
    const afterOut = execFileSync('agy', ['mcp', 'list'], {
      env: { ...process.env, HOME: tmpHome },
      encoding: 'utf8',
    })
    assert.match(afterOut, /No MCP servers configured/)
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  }
})
