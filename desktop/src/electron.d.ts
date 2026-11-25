interface Window {
  electronAPI?: {
    openDirectory(): Promise<string | null>;
    getBackendPort(): Promise<number>;
    setWindowTheme(theme: 'light' | 'dark' | 'viewer' | 'viewerLight'): void;
    minimizeWindow(): void;
    toggleMaximizeWindow(): void;
    closeWindow(): void;
    isWindowMaximized(): Promise<boolean>;
    onWindowMaximizedChange(cb: (maximized: boolean) => void): () => void;
    showApplicationMenu(x: number, y: number): void;
  };
}
