export interface McpPolicy {
  version: number;
  mcp_enabled: boolean;
  headless_enabled: boolean;
  allow_agent_scan: boolean;
  allow_previews: boolean;
  max_headless_scan_images: number;
  approved_roots: string[];
}

export interface McpAuditEntry {
  ts: string;
  tool: string;
  summary: Record<string, unknown>;
  ok: boolean;
  error?: string | null;
}

export type McpClientId = 'claude-desktop' | 'cursor' | 'claude-code' | 'vscode';

export interface McpClientStatus {
  id: McpClientId;
  name: string;
  configPath: string;
  installed: boolean;
  connected: boolean;
  upToDate: boolean;
}

export interface McpClientActionResult {
  ok: boolean;
  clientId: McpClientId;
  configPath: string;
  backupPath?: string;
  error?: string;
}

declare global {
  interface Window {
    electronAPI?: {
      openDirectory(): Promise<string | null>;
      getBackendPort(): Promise<number>;
      getBackendConfig(): Promise<{ port: number; token: string }>;
      getMcpPolicy(): Promise<McpPolicy>;
      saveMcpPolicy(policy: Partial<McpPolicy>): Promise<McpPolicy>;
      addMcpApprovedFolder(): Promise<McpPolicy>;
      getMcpClientConfig(): Promise<{ configJson: string; isPackaged: boolean; dataDir: string }>;
      listMcpClients(): Promise<McpClientStatus[]>;
      connectMcpClient(clientId: McpClientId): Promise<{
        result: McpClientActionResult;
        clients: McpClientStatus[];
        policy: McpPolicy;
      }>;
      disconnectMcpClient(clientId: McpClientId): Promise<{
        result: McpClientActionResult;
        clients: McpClientStatus[];
      }>;
      getMcpAuditLog(): Promise<McpAuditEntry[]>;
      stopMcpHeadless(): Promise<McpPolicy>;
      setWindowTheme(theme: 'light' | 'dark' | 'viewer' | 'viewerLight'): void;
      minimizeWindow(): void;
      toggleMaximizeWindow(): void;
      closeWindow(): void;
      isWindowMaximized(): Promise<boolean>;
      onWindowMaximizedChange(cb: (maximized: boolean) => void): () => void;
      showApplicationMenu(x: number, y: number): void;
    };
  }
}
