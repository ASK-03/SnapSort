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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      // API call is handled in a useEffect in the main component
    }
  };

  return (
    <header className="h-20 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-8 bg-white dark:bg-[#0f1115]">
      <form onSubmit={handleSearch} className="flex-1 max-w-2xl flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={18} />
          <input 
            ref={inputRef}
            type="text"
            placeholder="Search for anything..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 dark:bg-[#1a1d24] border border-slate-200 dark:border-slate-800 rounded-xl py-3 pl-12 pr-12 text-sm text-slate-900 dark:text-slate-200 focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 bg-white dark:bg-slate-800 text-slate-400 dark:text-slate-400 text-[10px] px-2 py-1 rounded font-medium border border-slate-200 dark:border-slate-700">
            {shortcutText}
          </div>
        </div>
      </form>

      <button 
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className="ml-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </header>
  );
};
