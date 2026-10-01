import { useMemo } from 'react';
import { useAppStore } from '../store';
import { scanFolder } from '../api';
import {
  Image as ImageIcon,
  UserCircle,
  Users,
  Settings,
  Info,
  Folder,
} from 'lucide-react';

const dirname = (path: string) => {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join('/') || '/';
};

const basename = (path: string) => {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
};

export const Sidebar = () => {
  const {
    viewMode, setViewMode, isScanning, setIsScanning, progress, stats,
    images, folderFilter, setFolderFilter, setSearchQuery, setSelectedPerson,
  } = useAppStore();

  const handleSelectFolder = async () => {
    // @ts-ignore
    const folderPath = await window.electronAPI.openDirectory();
    if (folderPath) {
      setIsScanning(true);
      await scanFolder(folderPath);
    }
  };

  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const path of images) {
      const dir = dirname(path);
      counts.set(dir, (counts.get(dir) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [images]);

  const openFolder = (dir: string) => {
    setSearchQuery('');
    setFolderFilter(folderFilter === dir ? null : dir);
    setViewMode('photos');
  };

  const navItems = [
    { id: 'photos', label: 'All Photos', icon: ImageIcon, count: stats.photos },
    { id: 'faces', label: 'Faces', icon: UserCircle, count: stats.faces },
    { id: 'people', label: 'People', icon: Users, count: stats.people },
  ];

  const bottomNavItems = [
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'about', label: 'About', icon: Info },
  ];

  const percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <aside className="w-64 bg-surface border-r border-border flex flex-col h-full text-sm">
      {/* Logo */}
      <div className="p-6 flex items-center gap-3">
        <img src="./snapsort-logo.png" alt="SnapSort Logo" className="w-8 h-8 rounded-lg" />
        <h1 className="text-xl font-semibold text-text">SnapSort</h1>
      </div>

      <div className="px-4 mb-6">
        <button
          onClick={handleSelectFolder}
          className="w-full flex items-center justify-center gap-2 bg-accent hover:brightness-110 text-bg py-2.5 rounded-lg transition-all duration-150 font-medium"
        >
          Select Folder
        </button>
      </div>

      {/* Main Nav — fixed, never scrolls */}
      <div className="px-3 space-y-1 flex-shrink-0">
        {navItems.map((item) => {
          const isActive = viewMode === item.id && !folderFilter;
          return (
            <button
              key={item.id}
              onClick={() => { setFolderFilter(null); setSelectedPerson(null); setViewMode(item.id as any); }}
              className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl transition-colors duration-150 ${
                isActive
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-dim hover:text-text hover:bg-surface-hi'
              }`}
            >
              <item.icon size={18} className={isActive ? 'text-accent' : 'text-text-mute'} />
              <span className="flex-1 text-left font-medium">{item.label}</span>
              {item.count !== undefined && (
                <span className={`text-xs font-medium ${isActive ? 'text-accent' : 'text-text-mute'}`}>
                  {item.count.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Folders — its own scrollable region, like a file explorer, so it
          never pushes the nav/settings items off screen. */}
      {folders.length > 0 && (
        <div className="flex-1 min-h-0 flex flex-col mt-3">
          <div className="pt-2 pb-2 px-7 text-[11px] font-semibold tracking-wide text-text-mute flex-shrink-0">
            FOLDERS
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 space-y-0.5">
            {folders.map(([dir, count]) => {
              const isActive = folderFilter === dir;
              return (
                <button
                  key={dir}
                  onClick={() => openFolder(dir)}
                  className={`flex items-center gap-2.5 w-full px-4 py-2 rounded-lg transition-colors duration-150 ${
                    isActive ? 'bg-accent/15 text-accent' : 'text-text-dim hover:text-text hover:bg-surface-hi'
                  }`}
                  title={dir}
                >
                  <Folder size={14} className={isActive ? 'text-accent' : 'text-text-mute'} />
                  <span className="flex-1 text-left truncate text-[13px]">{basename(dir)}</span>
                  <span className="text-[11px] text-text-mute">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {folders.length === 0 && <div className="flex-1 min-h-0" />}

      <div className="px-3 flex-shrink-0">
        <div className="my-3 border-t border-border mx-3"></div>
        {bottomNavItems.map((item) => {
          const isActive = viewMode === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setViewMode(item.id as any)}
              className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl transition-colors duration-150 ${
                isActive
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-dim hover:text-text hover:bg-surface-hi'
              }`}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Progress / Status */}
      <div className="p-4 m-4 bg-surface-hi rounded-xl border border-border">
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-2 h-2 rounded-full ${isScanning ? 'bg-accent shadow-[0_0_8px_rgba(59,130,246,0.5)] animate-pulse' : 'bg-success'}`}></div>
          <span className="text-xs font-medium text-text-dim">
            {isScanning ? 'Scanning…' : 'Idle'}
          </span>
        </div>
        <div className="w-full bg-border rounded-full h-1.5 mb-2 overflow-hidden">
          <div
            className="bg-accent h-1.5 rounded-full transition-all duration-320 ease-apple"
            style={{ width: `${percent}%` }}
          ></div>
        </div>
        <div className="flex justify-between text-[10px] text-text-mute font-medium">
          <span>{progress.processed.toLocaleString()} / {progress.total.toLocaleString()}</span>
          <span>{percent}%</span>
        </div>
      </div>
    </aside>
  );
};
