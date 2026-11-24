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
  Plus,
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
    viewMode,
    setViewMode,
    isScanning,
    setIsScanning,
    scanningFolder,
    setScanningFolder,
    progress,
    stats,
    images,
    folderFilter,
    setFolderFilter,
    searchQuery,
    setSelectedPerson,
  } = useAppStore();

  const handleSelectFolder = async () => {
    const folderPath = await window.electronAPI?.openDirectory();
    if (folderPath) {
      setScanningFolder(basename(folderPath));
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
    setFolderFilter(!searchQuery.trim() && folderFilter === dir ? null : dir);
    setViewMode('photos');
  };

  const navItems = [
    { id: 'photos' as const, label: 'All Photos', icon: ImageIcon, count: stats.photos },
    { id: 'faces' as const, label: 'Faces', icon: UserCircle, count: stats.faces },
    { id: 'people' as const, label: 'People', icon: Users, count: stats.people },
  ];

  const bottomNavItems = [
    { id: 'settings' as const, label: 'Settings', icon: Settings },
    { id: 'about' as const, label: 'About', icon: Info },
  ];

  const ratio = progress.total > 0 ? Math.min(1, Math.max(0, progress.processed / progress.total)) : 0;
  const percent = Math.round(ratio * 100);

  return (
    <aside className="w-60 bg-surface border-r border-border flex flex-col h-full text-sm select-none" aria-label="Library navigation">
      <nav className="px-3 pt-4 space-y-0.5 flex-shrink-0" aria-label="Primary sections">
        {navItems.map((item) => {
          const isActive = !searchQuery.trim() && viewMode === item.id && !folderFilter;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                setFolderFilter(null);
                setSelectedPerson(null);
                setViewMode(item.id);
              }}
              className={`pressable flex items-center gap-2.5 w-full px-3 py-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                isActive
                  ? 'bg-accent-soft text-accent'
                  : 'text-text-dim hover:text-text hover:bg-surface-hi'
              }`}
            >
              <item.icon size={17} strokeWidth={1.75} className={isActive ? 'text-accent' : 'text-text-mute'} />
              <span className="flex-1 text-left font-medium">{item.label}</span>
              <span className={`text-xs font-medium tabular-nums ${isActive ? 'text-accent' : 'text-text-mute'}`}>
                {item.count.toLocaleString()}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Folders */}
      <div className="flex-1 min-h-0 flex flex-col mt-5">
        <div className="pb-2 px-3 pl-6 flex items-center justify-between flex-shrink-0">
          <span className="text-xs font-medium text-text-mute">Folders</span>
          <button
            type="button"
            onClick={handleSelectFolder}
            aria-label="Add folder"
            title="Add folder"
            className="pressable inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-text-dim bg-bg border border-border hover:bg-surface-hi hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Plus size={12} strokeWidth={2} aria-hidden="true" />
            <span>Add</span>
          </button>
        </div>

        {folders.length > 0 ? (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 space-y-0.5">
            {folders.map(([dir, count]) => {
              const isActive = !searchQuery.trim() && viewMode === 'photos' && folderFilter === dir;
              return (
                <button
                  key={dir}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => openFolder(dir)}
                  className={`pressable flex items-center gap-2.5 w-full px-3 py-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    isActive ? 'bg-accent-soft text-accent' : 'text-text-dim hover:text-text hover:bg-surface-hi'
                  }`}
                  title={dir}
                >
                  <Folder size={14} strokeWidth={1.75} className={isActive ? 'text-accent' : 'text-text-mute'} />
                  <span className="flex-1 text-left truncate text-[13px] font-medium">{basename(dir)}</span>
                  <span className={`text-xs tabular-nums ${isActive ? 'text-accent' : 'text-text-mute'}`}>
                    {count.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 min-h-0" />
        )}
      </div>

      {/* Scan progress (only rendered while scanning) */}
      {isScanning && (
        <div role="status" aria-live="polite" className="reveal-soft p-3 mx-3 mb-2 bg-surface-hi rounded-lg border border-border flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-text">
            <span className="inline-flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" aria-hidden="true" />
              <span className="truncate">
                {scanningFolder ? `Scanning ${scanningFolder}…` : 'Scanning…'}
              </span>
            </span>
            <span className="tabular-nums text-text-dim flex-shrink-0">{percent}%</span>
          </div>
          <div className="w-full bg-border rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-accent h-full w-full rounded-full origin-left transition-transform duration-200 ease-out-ui"
              style={{ transform: `scaleX(${ratio})` }}
            />
          </div>
          <div className="flex justify-between text-xs text-text-dim tabular-nums">
            <span>{progress.processed.toLocaleString()} / {progress.total.toLocaleString()}</span>
            <span>On device</span>
          </div>
        </div>
      )}

      <div className="px-3 pb-3 flex-shrink-0">
        <div className="my-2 border-t border-border mx-1" />
        <div className="space-y-0.5">
          {bottomNavItems.map((item) => {
            const isActive = !searchQuery.trim() && viewMode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                  setFolderFilter(null);
                  setSelectedPerson(null);
                  setViewMode(item.id);
                }}
                className={`pressable flex items-center gap-2.5 w-full px-3 py-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isActive
                    ? 'bg-accent-soft text-accent'
                    : 'text-text-dim hover:text-text hover:bg-surface-hi'
                }`}
              >
                <item.icon size={17} strokeWidth={1.75} className={isActive ? 'text-accent' : 'text-text-mute'} />
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
