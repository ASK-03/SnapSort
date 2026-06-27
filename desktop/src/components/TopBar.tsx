import { useAppStore } from '../store';
import { Search, Filter, Minus, Maximize, X } from 'lucide-react';

export const TopBar = () => {
  const { searchQuery, setSearchQuery } = useAppStore();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      // API call is handled in a useEffect in the main component
    }
  };

  return (
    <header className="h-20 border-b border-slate-800 flex items-center justify-between px-8 bg-[#0f1115]">
      <form onSubmit={handleSearch} className="flex-1 max-w-2xl flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input 
            type="text"
            placeholder="Search for anything..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#1a1d24] border border-slate-800 rounded-xl py-3 pl-12 pr-12 text-sm text-slate-200 focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-500"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 bg-slate-800 text-slate-400 text-[10px] px-2 py-1 rounded font-medium border border-slate-700">
            ⌘K
          </div>
        </div>
        <button type="button" className="p-3 bg-[#1a1d24] border border-slate-800 rounded-xl text-slate-400 hover:text-slate-200 transition-colors">
          <Filter size={18} />
        </button>
      </form>

      <div className="flex items-center gap-4 text-slate-400">
        <button className="hover:text-slate-200"><Minus size={18} /></button>
        <button className="hover:text-slate-200"><Maximize size={16} /></button>
        <button className="hover:text-slate-200"><X size={18} /></button>
      </div>
    </header>
  );
};
