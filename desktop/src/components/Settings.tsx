import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import type { McpAuditEntry, McpClientId, McpClientStatus, McpPolicy } from '../electron';
import { Bot, Check, Copy, Cpu, Plug, Plus, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';

const ToggleRow = ({
  title,
  description,
  enabled,
  disabled,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) => (
  <div className="flex items-center justify-between gap-4">
    <div>
      <h4 className="text-text font-medium text-sm">{title}</h4>
      <p className="text-xs text-text-mute mt-1">{description}</p>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={title}
      disabled={disabled}
      onClick={onToggle}
      className={`w-11 h-6 p-1 rounded-full relative flex-shrink-0 transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        enabled ? 'bg-accent' : 'bg-surface-hi border border-border'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`block w-4 h-4 rounded-full transition-transform duration-150 motion-reduce:transition-none ${
          enabled ? 'translate-x-5 bg-on-accent' : 'translate-x-0 bg-text-dim'
        }`}
      />
    </button>
  </div>
);

const ActiveBadge = () => (
  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-hi border border-border text-xs font-medium text-success shrink-0">
    <span className="w-1.5 h-1.5 rounded-full bg-success" aria-hidden="true" />
    Local · Active
  </span>
);

export const Settings = () => {
  const { viewMode } = useAppStore();
  const [policy, setPolicy] = useState<McpPolicy | null>(null);
  const [clientConfig, setClientConfig] = useState<string>('');
  const [clients, setClients] = useState<McpClientStatus[]>([]);
  const [clientNotice, setClientNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [auditEntries, setAuditEntries] = useState<McpAuditEntry[]>([]);
  const [copied, setCopied] = useState(false);

  const refreshMcpState = async () => {
    if (!window.electronAPI?.getMcpPolicy) return;
    try {
      const [pol, cfg, audit, detected] = await Promise.all([
        window.electronAPI.getMcpPolicy(),
        window.electronAPI.getMcpClientConfig(),
        window.electronAPI.getMcpAuditLog(),
        window.electronAPI.listMcpClients ? window.electronAPI.listMcpClients() : Promise.resolve([]),
      ]);
      setPolicy(pol);
      setClientConfig(cfg.configJson);
      setAuditEntries(audit);
      setClients(detected);
    } catch (err) {
      console.error('Failed to load MCP settings:', err);
    }
  };

  useEffect(() => {
    if (viewMode === 'settings') {
      void refreshMcpState();
    }
  }, [viewMode]);

  if (viewMode !== 'settings') return null;

  const updatePolicy = async (patch: Partial<McpPolicy>) => {
    if (!policy || !window.electronAPI?.saveMcpPolicy) return;
    const saved = await window.electronAPI.saveMcpPolicy({ ...policy, ...patch });
    setPolicy(saved);
  };

  const handleAddFolder = async () => {
    if (!window.electronAPI?.addMcpApprovedFolder) return;
    const saved = await window.electronAPI.addMcpApprovedFolder();
    setPolicy(saved);
  };

  const handleRemoveFolder = async (folder: string) => {
    if (!policy) return;
    await updatePolicy({
      approved_roots: policy.approved_roots.filter((r) => r !== folder),
    });
  };

  const handleConnectClient = async (client: McpClientStatus) => {
    if (!window.electronAPI?.connectMcpClient) return;
    const res = await window.electronAPI.connectMcpClient(client.id);
    setClients(res.clients);
    setPolicy(res.policy);
    if (res.result.ok) {
      setClientNotice({
        kind: 'ok',
        text: `Connected ${client.name} (${res.result.configPath}). Restart ${client.name} to load SnapSort tools.`,
      });
    } else {
      setClientNotice({
        kind: 'error',
        text: res.result.error || `Failed to connect ${client.name}.`,
      });
    }
  };

  const handleDisconnectClient = async (clientId: McpClientId, name: string) => {
    if (!window.electronAPI?.disconnectMcpClient) return;
    const res = await window.electronAPI.disconnectMcpClient(clientId);
    setClients(res.clients);
    if (res.result.ok) {
      setClientNotice({ kind: 'ok', text: `Disconnected SnapSort from ${name}.` });
    } else {
      setClientNotice({ kind: 'error', text: res.result.error || `Failed to disconnect ${name}.` });
    }
  };

  const handleCopyConfig = async () => {
    if (!clientConfig) return;
    await navigator.clipboard.writeText(clientConfig);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleRevoke = async () => {
    if (!window.electronAPI?.stopMcpHeadless) return;
    const saved = await window.electronAPI.stopMcpHeadless();
    setPolicy(saved);
  };

  return (
    <div className="flex-1 flex flex-col bg-bg text-text h-full overflow-y-auto p-8">
      <div className="max-w-3xl w-full mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight mb-6 text-text">Settings</h1>

        <div className="space-y-6">
          <section className="bg-surface border border-border rounded-xl p-6">
            <div className="flex items-center gap-2.5 mb-4">
              <Cpu size={18} className="text-accent" aria-hidden="true" />
              <h2 className="text-base font-semibold text-text">Indexing & AI</h2>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-text font-medium text-sm">Face Recognition</h3>
                  <p className="text-xs text-text-mute mt-1">
                    Automatically group similar faces locally using YuNet and SFace.
                  </p>
                </div>
                <ActiveBadge />
              </div>

              <div className="border-t border-border pt-4 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-text font-medium text-sm">CLIP Semantic Search</h3>
                  <p className="text-xs text-text-mute mt-1">OpenAI ViT-B/32 quantized ONNX model running locally.</p>
                </div>
                <ActiveBadge />
              </div>
            </div>
          </section>

          <section className="bg-surface border border-border rounded-xl p-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2.5">
                <Bot size={18} className="text-accent" aria-hidden="true" />
                <h2 className="text-base font-semibold text-text">MCP & AI Agent Access</h2>
              </div>
              {policy?.mcp_enabled && (
                <button
                  type="button"
                  onClick={handleRevoke}
                  className="pressable bg-danger/10 text-danger hover:bg-danger/20 px-3 py-1.5 rounded-lg text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Stop Headless & Revoke
                </button>
              )}
            </div>

            <div className="mb-5 p-3.5 rounded-lg bg-surface-hi border border-border flex items-start gap-3">
              <ShieldAlert size={18} className="text-text-dim flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-text-dim leading-relaxed">
                SnapSort indexes and searches 100% locally. Cloud-backed MCP clients (such as Claude Desktop)
                receive tool responses, including local file paths, person names, and previews if enabled.
              </p>
            </div>

            {policy ? (
              <div className="space-y-4">
                <ToggleRow
                  title="Enable MCP Access"
                  description="Allow local MCP clients to search this library over stdio."
                  enabled={policy.mcp_enabled}
                  onToggle={() => void updatePolicy({ mcp_enabled: !policy.mcp_enabled })}
                />

                <div className="border-t border-border pt-4">
                  <ToggleRow
                    title="Allow Headless Background Access"
                    description="Let AI clients auto-start SnapSort headless when the desktop app is closed."
                    enabled={policy.headless_enabled}
                    disabled={!policy.mcp_enabled}
                    onToggle={() => void updatePolicy({ headless_enabled: !policy.headless_enabled })}
                  />
                </div>

                <div className="border-t border-border pt-4">
                  <ToggleRow
                    title="Allow Agent Folder Scanning"
                    description="Allow agents to scan and index photos strictly inside approved folders below."
                    enabled={policy.allow_agent_scan}
                    disabled={!policy.mcp_enabled}
                    onToggle={() => void updatePolicy({ allow_agent_scan: !policy.allow_agent_scan })}
                  />
                </div>

                <div className="border-t border-border pt-4 space-y-3">
                  <div>
                    <h3 className="text-text font-medium text-sm">Preview & Viewing Options</h3>
                    <p className="text-xs text-text-mute mt-0.5">
                      Choose whether agents display matching photos privately in SnapSort or inspect image pixels directly.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-lg bg-surface-hi border border-border space-y-3">
                    <p className="text-[11px] font-medium text-text-dim">Option 1 · SnapSort Minimal Viewer (Private)</p>
                    <ToggleRow
                      title="Allow Opening Minimal Viewer"
                      description="Let agents open search results in SnapSort's minimal viewer without sending pixels to the AI."
                      enabled={policy.allow_viewer_open}
                      disabled={!policy.mcp_enabled}
                      onToggle={() => void updatePolicy({ allow_viewer_open: !policy.allow_viewer_open })}
                    />
                    <div className="border-t border-border pt-3">
                      <ToggleRow
                        title="Allow Starting SnapSort When Closed"
                        description="Let agents launch SnapSort to show photos when you confirm."
                        enabled={policy.allow_launch_desktop}
                        disabled={!policy.mcp_enabled || !policy.allow_viewer_open}
                        onToggle={() => void updatePolicy({ allow_launch_desktop: !policy.allow_launch_desktop })}
                      />
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-surface-hi border border-border space-y-3">
                    <p className="text-[11px] font-medium text-text-dim">Option 2 · AI Image Access (Sends Pixels to AI)</p>
                    <ToggleRow
                      title="Allow AI Image Inspection"
                      description="Allow agents to inspect downscaled EXIF-stripped previews only after you confirm in chat."
                      enabled={policy.allow_previews}
                      disabled={!policy.mcp_enabled}
                      onToggle={() => void updatePolicy({ allow_previews: !policy.allow_previews })}
                    />
                    {policy.allow_previews && (
                      <div className="border-t border-border pt-3 flex items-center justify-between gap-4">
                        <div>
                          <label htmlFor="max-preview-select" className="text-text font-medium text-xs">
                            Max images per burst
                          </label>
                          <p className="text-[11px] text-text-mute mt-0.5">
                            Caps how many photos an agent can inspect per minute.
                          </p>
                        </div>
                        <select
                          id="max-preview-select"
                          value={policy.max_preview_images}
                          disabled={!policy.mcp_enabled}
                          onChange={(e) => void updatePolicy({ max_preview_images: Number(e.target.value) })}
                          className="bg-surface border border-border rounded-md px-2.5 py-1 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {[1, 2, 3, 5, 8, 10].map((n) => (
                            <option key={n} value={n}>
                              {n} {n === 1 ? 'image' : 'images'}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div>
                      <h3 className="text-text font-medium text-sm">Approved Folders</h3>
                      <p className="text-xs text-text-mute mt-0.5">
                        Agents can only scan or browse inside folders added here.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleAddFolder()}
                      className="pressable inline-flex items-center gap-1.5 bg-accent hover:opacity-95 text-on-accent px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Plus size={14} /> Add Folder
                    </button>
                  </div>

                  {policy.approved_roots.length === 0 ? (
                    <p className="text-xs text-text-mute py-2">No approved folders configured yet.</p>
                  ) : (
                    <ul className="space-y-1.5 mt-2">
                      {policy.approved_roots.map((folder) => (
                        <li
                          key={folder}
                          className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-hi border border-border text-xs text-text"
                        >
                          <span className="truncate font-mono">{folder}</span>
                          <button
                            type="button"
                            onClick={() => void handleRemoveFolder(folder)}
                            aria-label={`Remove folder ${folder}`}
                            className="pressable text-text-mute hover:text-danger p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            title="Remove folder"
                          >
                            <Trash2 size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {clients.length > 0 && (
                  <div className="border-t border-border pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Plug size={15} className="text-accent" aria-hidden="true" />
                      <h3 className="text-text font-medium text-sm">Quick Connect AI Clients</h3>
                    </div>
                    <p className="text-xs text-text-mute mb-3">
                      Automatically register SnapSort in your installed MCP clients (backs up existing configs first).
                    </p>

                    {clientNotice && (
                      <div
                        role="status"
                        className={`mb-3 p-2.5 rounded-lg text-xs border ${
                          clientNotice.kind === 'ok'
                            ? 'bg-surface-hi border-success/40 text-success'
                            : 'bg-danger/10 border-danger/40 text-danger'
                        }`}
                      >
                        {clientNotice.text}
                      </div>
                    )}

                    <div className="space-y-2">
                      {clients.map((client) => (
                        <div
                          key={client.id}
                          className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-surface-hi border border-border"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-text">{client.name}</span>
                              {client.connected ? (
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface border border-border text-success font-medium">
                                  {client.upToDate ? 'Connected' : 'Update Available'}
                                </span>
                              ) : client.installed ? (
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent-soft text-accent font-medium">
                                  Detected
                                </span>
                              ) : (
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface border border-border text-text-mute font-medium">
                                  Not detected
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] font-mono text-text-mute truncate mt-0.5">{client.configPath}</p>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            {(!client.connected || !client.upToDate) && (
                              <button
                                type="button"
                                onClick={() => void handleConnectClient(client)}
                                className="pressable bg-accent hover:opacity-95 text-on-accent px-2.5 py-1 rounded-md text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                {client.connected ? 'Update' : 'Connect'}
                              </button>
                            )}
                            {client.connected && (
                              <button
                                type="button"
                                onClick={() => void handleDisconnectClient(client.id, client.name)}
                                className="pressable bg-surface border border-border text-text-dim hover:text-danger px-2.5 py-1 rounded-md text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                Disconnect
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {clientConfig && (
                  <div className="border-t border-border pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-text font-medium text-sm">Manual MCP Client JSON</h3>
                      <button
                        type="button"
                        onClick={() => void handleCopyConfig()}
                        className="pressable inline-flex items-center gap-1.5 bg-surface-hi border border-border text-text hover:bg-bg px-3 py-1.5 rounded-lg text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                        {copied ? 'Copied' : 'Copy JSON'}
                      </button>
                    </div>
                    <pre className="p-3 rounded-lg bg-surface-hi border border-border text-[11px] font-mono text-text-dim overflow-x-auto">
                      {clientConfig}
                    </pre>
                  </div>
                )}

                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-text font-medium text-sm">Recent MCP Activity</h3>
                    <button
                      type="button"
                      onClick={() => void refreshMcpState()}
                      className="pressable inline-flex items-center gap-1 text-xs text-text-mute hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-1.5 py-0.5"
                    >
                      <RefreshCw size={12} /> Refresh
                    </button>
                  </div>
                  {auditEntries.length === 0 ? (
                    <p className="text-xs text-text-mute">No MCP activity recorded yet.</p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {auditEntries.slice(0, 10).map((entry, idx) => (
                        <div
                          key={`${entry.ts}-${idx}`}
                          className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded bg-surface-hi border border-border"
                        >
                          <span className="font-mono text-text">{entry.tool}</span>
                          <span className={entry.ok ? 'text-success' : 'text-danger'}>
                            {entry.ok ? 'ok' : (entry.error || 'error')}
                          </span>
                          <span className="text-text-mute tabular-nums">{entry.ts}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-text-mute">MCP settings are available in the Electron desktop app.</p>
            )}
          </section>

          <section className="bg-surface border border-border rounded-xl p-6">
            <h2 className="text-base font-semibold text-text mb-4">Support</h2>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-text font-medium text-sm">Report a Bug</h3>
                <p className="text-xs text-text-mute mt-1">Found an issue? Let us know on GitHub.</p>
              </div>
              <a
                href="https://github.com/ASK-03/SnapSort/issues/new"
                target="_blank"
                rel="noopener noreferrer"
                className="pressable bg-surface-hi border border-border text-text hover:bg-bg px-4 py-2 rounded-lg text-xs font-medium shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Open GitHub Issue
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
