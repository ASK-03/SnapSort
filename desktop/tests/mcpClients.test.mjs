import assert from 'node:assert/strict'
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
