
import { useAppStore } from '../store';
import { scanFolder } from '../api';
import { 
  Image as ImageIcon, 
  UserCircle, 
  Users, 
  Search, 
  Settings, 
  FileText, 
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
    { id: 'search', label: 'Search', icon: Search },
  ];

  const bottomNavItems = [
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'logs', label: 'Logs', icon: FileText },
    { id: 'about', label: 'About', icon: Info },
  ];

  return (
    <aside className="w-64 bg-[#0f1115] border-r border-slate-800 flex flex-col h-full text-sm">
      {/* Logo */}
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white">
          <ImageIcon size={18} />
        </div>
        <h1 className="text-xl font-semibold text-white">SnapSort</h1>
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
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setViewMode(item.id as any)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
              viewMode === item.id 
                ? 'bg-blue-600/10 text-blue-500' 
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <item.icon size={18} />
              <span>{item.label}</span>
            </div>
            {item.count !== undefined && (
              <span className={`text-xs ${viewMode === item.id ? 'text-blue-500' : 'text-slate-500'}`}>
                {item.count.toLocaleString()}
              </span>
            )}
          </button>
        ))}

        <div className="my-6 border-t border-slate-800 mx-3"></div>

        {bottomNavItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setViewMode(item.id as any)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              viewMode === item.id 
                ? 'bg-blue-600/10 text-blue-500' 
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <item.icon size={18} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Progress / Status */}
      <div className="p-4 m-4 bg-[#1a1d24] rounded-xl border border-slate-800">
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-2 h-2 rounded-full ${isScanning ? 'bg-green-500 animate-pulse' : 'bg-slate-500'}`}></div>
          <span className="text-xs font-medium text-slate-300">
            {isScanning ? 'AI Processing' : 'Idle'}
          </span>
        </div>
        <div className="w-full bg-slate-800 rounded-full h-1.5 mb-2">
          <div 
            className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progress.total > 0 ? (progress.processed / progress.total) * 100 : 0}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-slate-500">
          <span>{progress.processed.toLocaleString()} / {progress.total.toLocaleString()}</span>
          <span>{progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0}%</span>
        </div>
      </div>
    </aside>
  );
};
