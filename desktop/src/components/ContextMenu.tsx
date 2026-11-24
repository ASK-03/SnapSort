import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FolderOpen, Copy } from 'lucide-react';
import { useAppStore } from '../store';
import { withViewTransition } from '../lib/viewTransition';

export const ContextMenu = () => {
  const { contextMenu, setContextMenu, setLightboxImage } = useAppStore();
  const menuRef = useRef<HTMLDivElement>(null);
  const firstBtnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; origin: string }>({
    top: 0,
    left: 0,
    origin: 'top left',
  });

  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) return;
    const mw = menuRef.current.offsetWidth || 200;
    const mh = menuRef.current.offsetHeight || 88;
    const pad = 8;
    const flipX = contextMenu.x + mw > window.innerWidth - pad;
    const flipY = contextMenu.y + mh > window.innerHeight - pad;
    const left = Math.max(pad, Math.min(window.innerWidth - mw - pad, flipX ? contextMenu.x - mw : contextMenu.x));
    const top = Math.max(pad, Math.min(window.innerHeight - mh - pad, flipY ? contextMenu.y - mh : contextMenu.y));
    setPos({
      top,
      left,
      origin: `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}`,
    });
    firstBtnRef.current?.focus();
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        if (!items.length) return;
        const curr = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? (curr + 1) % items.length : (curr - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close, { capture: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close, { capture: true });
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu, setContextMenu]);

  if (!contextMenu) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Photo actions"
      style={{ top: pos.top, left: pos.left, transformOrigin: pos.origin }}
      className="save-dropdown fixed z-[60] w-52 bg-surface border border-border rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5 overscroll-contain"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={firstBtnRef}
        type="button"
        role="menuitem"
        onClick={() => {
          withViewTransition(() => setLightboxImage(contextMenu.imagePath, contextMenu.paths));
          setContextMenu(null);
        }}
        className="pressable flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium text-left text-text hover:bg-surface-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <FolderOpen size={14} aria-hidden="true" />
        <span>Open</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          void navigator.clipboard?.writeText(contextMenu.imagePath);
          setContextMenu(null);
        }}
        className="pressable flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium text-left text-text hover:bg-surface-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Copy size={14} aria-hidden="true" />
        <span>Copy path</span>
      </button>
    </div>
  );
};
