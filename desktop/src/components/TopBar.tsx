import { useAppStore } from '../store';
import { Search, Sun, Moon } from 'lucide-react';

import { useEffect, useRef } from 'react';

export const TopBar = () => {
  const { searchQuery, setSearchQuery, theme, setTheme } = useAppStore();
  const inputRef = useRef<HTMLInputElement>(null);

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const shortcutText = isMac ? '⌘K' : 'Ctrl+K';

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <header className="h-20 border-b border-border flex items-center justify-between px-8 bg-bg">
      <div className="flex-1 max-w-2xl flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text-mute" size={16} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search your photos — people, places, things…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface-hi border border-border rounded-xl py-2.5 pl-11 pr-14 text-sm text-text focus:outline-none focus:border-accent transition-colors duration-250 ease-apple placeholder:text-text-mute"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 bg-bg text-text-mute text-[10px] px-2 py-1 rounded font-medium border border-border">
            {shortcutText}
          </div>
        </div>
      </div>

      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className="ml-4 p-3 rounded-xl border border-border text-text-dim hover:bg-surface-hi transition-colors duration-250 ease-apple"
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </header>
  );
};
