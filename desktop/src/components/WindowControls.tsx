import { useEffect, useState } from 'react';

export const WindowControls = ({ variant = 'toolbar' }: { variant?: 'toolbar' | 'viewer' }) => {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const api = window.electronAPI;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!api?.isWindowMaximized || isMac) return;
    let mounted = true;
    api.isWindowMaximized().then((val) => {
      if (mounted) setMaximized(val);
    }).catch(() => {});
    const unsubscribe = api.onWindowMaximizedChange?.((val) => setMaximized(val));
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [api, isMac]);

  if (isMac || !api?.minimizeWindow) return null;

  const hoverClass = variant === 'viewer' ? 'hover:bg-viewer-control-hover' : 'hover:bg-surface-hi';
  const baseBtn = `pressable w-7 h-7 rounded-lg grid place-items-center text-text-dim hover:text-text ${hoverClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`;

  return (
    <div className="flex items-center gap-1 shrink-0">
      <span className="w-px h-4 bg-border mx-1 shrink-0" aria-hidden="true" />
      <button
        type="button"
        aria-label="Minimize window"
        title="Minimize"
        onClick={() => api.minimizeWindow()}
        className={baseBtn}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M2.5 6.5h7" />
        </svg>
      </button>

      <button
        type="button"
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={() => api.toggleMaximizeWindow()}
        className={baseBtn}
      >
        {maximized ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2.2" y="3.8" width="6" height="6" rx="1.2" />
            <path d="M4.2 3.8V3.2A1.2 1.2 0 0 1 5.4 2h3.4A1.2 1.2 0 0 1 10 3.2v3.4a1.2 1.2 0 0 1-1.2 1.2h-.6" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <rect x="2.3" y="2.3" width="7.4" height="7.4" rx="1.5" />
          </svg>
        )}
      </button>

      <button
        type="button"
        aria-label="Close window"
        title="Close"
        onClick={() => api.closeWindow()}
        className="pressable w-7 h-7 rounded-lg grid place-items-center text-text-dim hover:bg-danger hover:text-on-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </button>
    </div>
  );
};
