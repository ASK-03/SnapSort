interface Window {
  electronAPI?: {
    openDirectory(): Promise<string | null>;
    getBackendPort(): Promise<number>;
    setWindowTheme(theme: 'light' | 'dark' | 'viewer'): void;
    showApplicationMenu(x: number, y: number): void;
  };
}
