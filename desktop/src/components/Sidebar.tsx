
import { useAppStore } from '../store';
import { scanFolder } from '../api';
import { 
  Image as ImageIcon, 
  UserCircle, 
  Users, 
  Settings,
  Info
} from 'lucide-react';

export const Sidebar = () => {
  const { viewMode, setViewMode, isScanning, setIsScanning, progress, stats } = useAppStore();

  const handleSelectFolder = async () => {
    // @ts-ignore
    const folderPath = await window.electronAPI.openDirectory();
    if (folderPath) {
      setIsScanning(true);
      await scanFolder(folderPath);
    }
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
    <aside className="w-64 bg-slate-50 dark:bg-[#0f1115] border-r border-slate-200 dark:border-slate-800 flex flex-col h-full text-sm">
      {/* Logo */}
      <div className="p-6 flex items-center gap-3">
        <img src="/snapsort-logo.png" alt="SnapSort Logo" className="w-8 h-8 rounded-lg" />
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">SnapSort</h1>
      </div>

      <div className="px-4 mb-6">
        <button 
          onClick={handleSelectFolder}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg transition-colors font-medium"
        >
          Select Folder
        </button>
      </div>

      {/* Main Nav */}
      <div className="px-3 space-y-1 flex-1">
        {navItems.map((item) => {
          const isActive = viewMode === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setViewMode(item.id as any)}
              className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl transition-colors ${
                isActive 
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' 
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800/50'
              }`}
            >
              <item.icon size={18} className={isActive ? 'text-white' : 'text-slate-500 dark:text-slate-500'} />
              <span className="flex-1 text-left font-medium">{item.label}</span>
              {item.count !== undefined && (
                <span className={`text-xs ${isActive ? 'text-blue-200' : 'text-slate-400 dark:text-slate-600 font-medium'}`}>
                  {item.count.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}

        <div className="my-6 border-t border-slate-200 dark:border-slate-800 mx-3"></div>

        {bottomNavItems.map((item) => {
          const isActive = viewMode === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setViewMode(item.id as any)}
              className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl transition-colors ${
                isActive 
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' 
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800/50'
              }`}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Progress / Status */}
      <div className="p-4 m-4 bg-white dark:bg-[#1a1d24] rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm dark:shadow-none">
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-2 h-2 rounded-full ${isScanning ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)] animate-pulse' : 'bg-slate-400 dark:bg-slate-500'}`}></div>
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            {isScanning ? 'Scanning...' : 'Idle'}
          </span>
        </div>
        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 mb-2 overflow-hidden">
          <div 
            className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" 
            style={{ width: `${percent}%` }}
          ></div>
        </div>
        <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-500 font-medium">
          <span>{progress.processed.toLocaleString()} / {progress.total.toLocaleString()}</span>
          <span>{percent}%</span>
        </div>
      </div>
    </aside>
  );
};
