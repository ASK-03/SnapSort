import { ChevronDown, Moon, Search, Sun, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { api } from '../api';

export const TopBar = () => {
  const { searchQuery, setSearchQuery, theme, setTheme } = useAppStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [exampleName, setExampleName] = useState('');
  const viewerOpen = useAppStore((state) => Boolean(state.lightboxImage));
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const hasAppMenu = !isMac && Boolean(window.electronAPI);
  const themeAction = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  useEffect(() => {
    window.electronAPI?.setWindowTheme(theme);
  }, [theme]);

  const showExample = focused && !searchQuery && !viewerOpen;
  useEffect(() => {
    if (!showExample) return;
    const controller = new AbortController();
    api.get<{ faces: { name: string | null }[] }>('/faces', { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) {
          setExampleName(data.faces.find((face) => face.name?.trim())?.name?.trim() ?? '');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setExampleName('');
      });
    return () => controller.abort();
  }, [showExample]);

  useEffect(() => {
    if (viewerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewerOpen]);

  const toggleTheme = () => {
    const root = document.documentElement;
    root.classList.add('theme-switching');
    setTheme(theme === 'dark' ? 'light' : 'dark');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => root.classList.remove('theme-switching'));
    });
  };

  const wordmark = (
    <>
      <img src="./snapsort-logo.png" alt="" draggable={false} width={20} height={20} />
      <span>SnapSort</span>
    </>
  );

  return (
    <header className="window-toolbar window-drag" inert={viewerOpen}>
      <div className="window-leading">
        {hasAppMenu ? (
          <button
            type="button"
            className="window-brand window-tool pressable"
            title="Application menu"
            aria-label="SnapSort application menu"
            aria-haspopup="menu"
            onClick={(event) => {
              const { left, bottom } = event.currentTarget.getBoundingClientRect();
              window.electronAPI?.showApplicationMenu(left, bottom);
            }}
          >
            {wordmark}
            <ChevronDown size={12} className="text-text-dim" />
          </button>
        ) : (
          <div className="window-brand">{wordmark}</div>
        )}
      </div>

      <div role="search" className="window-search window-interactive relative">
        <label className="flex h-full min-w-0 flex-1 cursor-text items-center gap-2 px-2.5">
          <Search size={14} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            name="library-search"
            autoComplete="off"
            aria-label="Search your photos"
            placeholder={showExample ? `Try “${exampleName ? `${exampleName} at the beach` : 'a dog on the beach'}”` : 'Search your library'}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                setSearchQuery('');
              }
            }}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {!searchQuery && <kbd aria-hidden="true">{isMac ? '⌘K' : 'Ctrl K'}</kbd>}
        </label>
        {searchQuery && (
          <button
            type="button"
            className="window-tool pressable mr-0.5 grid h-6 w-6 shrink-0 place-items-center rounded"
            aria-label="Clear search"
            title="Clear search"
            onClick={() => {
              setSearchQuery('');
              inputRef.current?.focus();
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="window-actions">
        <button
          type="button"
          className="window-tool pressable"
          aria-label={themeAction}
          title={themeAction}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
};
