import { useEffect, useRef } from 'react';
import { useAppStore } from '../store';
import { FolderOpen, UserCircle, Pencil, Heart, Trash2 } from 'lucide-react';
import { withViewTransition } from '../lib/viewTransition';

export const ContextMenu = () => {
  const { contextMenu, setContextMenu, setLightboxImage } = useAppStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('click', close);
    // Capture phase: must run BEFORE a right-click on a different card's own
    // bubble-phase onContextMenu handler, otherwise this listener (added by
    // the PREVIOUS open) fires after and immediately nulls out the menu the
    // new right-click just opened.
    window.addEventListener('contextmenu', close, { capture: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close, { capture: true });
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu, setContextMenu]);

  if (!contextMenu) return null;

  const items = [
    { label: 'Open', icon: FolderOpen, enabled: true, onClick: () => withViewTransition(() => setLightboxImage(contextMenu.imagePath)) },
    { label: 'Reprocess faces', icon: UserCircle, enabled: false },
    { label: 'Rename', icon: Pencil, enabled: false },
    { label: 'Add to favorites', icon: Heart, enabled: false },
  ];

  return (
    <div
      ref={ref}
      style={{ top: contextMenu.y, left: contextMenu.x }}
      className="fixed z-[60] w-52 bg-surface-hi border border-border rounded-xl shadow-2xl shadow-black/40 p-1.5 flex flex-col gap-0.5 origin-top-left animate-[ctxmenu_200ms_cubic-bezier(0.32,0.72,0,1)]"
      onClick={(e) => e.stopPropagation()}
    >
      <style>{`@keyframes ctxmenu { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }`}</style>
      {items.map((item) => (
        <button
          key={item.label}
          disabled={!item.enabled}
          onClick={() => { item.onClick?.(); setContextMenu(null); }}
          title={item.enabled ? undefined : 'Coming soon'}
          className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-left transition-colors duration-150 ${
            item.enabled ? 'text-text hover:bg-surface' : 'text-text-mute cursor-not-allowed opacity-50'
          }`}
        >
          <item.icon size={14} />
          {item.label}
        </button>
      ))}
      <div className="h-px bg-border my-1 mx-1" />
      <button
        disabled
        title="Coming soon"
        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-left text-red-400/50 cursor-not-allowed opacity-60"
      >
        <Trash2 size={14} />
        Delete
      </button>
    </div>
  );
};
