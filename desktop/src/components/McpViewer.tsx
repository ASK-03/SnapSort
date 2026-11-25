import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { getImageUrl, getPreviewUrl } from '../api';
import { useAppStore } from '../store';

/** Minimal distraction-free overlay for inspecting photos opened via MCP. */
export const McpViewer = () => {
  const { mcpViewerSession, setMcpViewerSession } = useAppStore();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [mcpViewerSession]);

  const paths = mcpViewerSession?.paths ?? [];
  const total = paths.length;
  const currentPath = total > 0 ? paths[Math.min(index, total - 1)] : null;

  const close = useCallback(() => {
    setMcpViewerSession(null);
  }, [setMcpViewerSession]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(total - 1, i + 1));
  }, [total]);

  useEffect(() => {
    if (!currentPath) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentPath, close, goPrev, goNext]);

  if (!mcpViewerSession || !currentPath) return null;

  const filename = currentPath.split(/[\\/]/).pop() || currentPath;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mcpViewerSession.query || 'SnapSort Viewer'}
      className="fixed inset-0 z-50 bg-bg text-text flex flex-col select-none"
    >
      <header className="h-12 px-4 border-b border-border flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium text-text truncate">
            {mcpViewerSession.query ? `"${mcpViewerSession.query}"` : 'SnapSort Viewer'}
          </span>
          <span className="text-xs text-text-mute tabular-nums shrink-0">
            {index + 1} / {total}
          </span>
          <span className="text-xs font-mono text-text-dim truncate">{filename}</span>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close viewer"
          className="pressable p-1.5 rounded-lg bg-surface-hi border border-border text-text-dim hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={16} />
        </button>
      </header>

      <div className="relative flex-1 min-h-0 flex items-center justify-center p-4">
        {total > 1 && index > 0 && (
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous photo"
            className="pressable absolute left-4 z-10 p-2 rounded-full bg-surface/90 border border-border text-text hover:bg-surface-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronLeft size={20} />
          </button>
        )}

        <img
          src={getImageUrl(currentPath)}
          alt={filename}
          className="max-h-full max-w-full object-contain rounded-lg"
        />

        {total > 1 && index < total - 1 && (
          <button
            type="button"
            onClick={goNext}
            aria-label="Next photo"
            className="pressable absolute right-4 z-10 p-2 rounded-full bg-surface/90 border border-border text-text hover:bg-surface-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronRight size={20} />
          </button>
        )}
      </div>

      {total > 1 && (
        <div className="h-20 px-4 border-t border-border bg-surface flex items-center justify-center gap-2 overflow-x-auto shrink-0">
          {paths.map((p, idx) => (
            <button
              key={p}
              type="button"
              onClick={() => setIndex(idx)}
              aria-label={`View photo ${idx + 1}`}
              className={`h-14 w-14 rounded-md overflow-hidden border-2 flex-shrink-0 transition-opacity ${
                idx === index ? 'border-accent opacity-100' : 'border-transparent opacity-60 hover:opacity-90'
              }`}
            >
              <img
                src={getPreviewUrl(p)}
                alt=""
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
