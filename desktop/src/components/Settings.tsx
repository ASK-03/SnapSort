import { useAppStore } from '../store';
import { Folder } from 'lucide-react';

export const Settings = () => {
  const { viewMode } = useAppStore();

  if (viewMode !== 'settings') return null;

  return (
    <div className="flex-1 flex flex-col bg-slate-50 dark:bg-[#0f1115] h-full overflow-y-auto p-8">
      <div className="max-w-3xl w-full mx-auto">
        <h1 className="text-2xl font-semibold mb-8 text-slate-900 dark:text-slate-100">Settings</h1>
        
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#1a1d24] border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm dark:shadow-none">
            <h3 className="text-lg font-medium text-slate-900 dark:text-slate-200 mb-4">Indexing & AI</h3>
            
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <Folder size={20} className="text-blue-500" />
                <h2 className="text-lg font-medium text-slate-900 dark:text-slate-200">Library Folders</h2>
              </div>
              
              <p className="text-sm text-slate-500 mb-4">
                Manage the folders SnapSort watches for photos.
              </p>

              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-slate-900 dark:text-slate-300 font-medium text-sm">Face Recognition</h4>
                  <p className="text-xs text-slate-500 mt-1">Automatically group similar faces found in your photos.</p>
                </div>
                <div className="w-12 h-6 bg-blue-600 rounded-full relative cursor-pointer">
                  <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                </div>
              </div>
              
              <div className="border-t border-slate-200 dark:border-slate-800/50 pt-4 flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-slate-900 dark:text-slate-200">CLIP Semantic Search</h3>
                  <p className="text-xs text-slate-500 mt-1">OpenAI ViT-B/32 (Local)</p>
                </div>
                <div className="w-12 h-6 bg-blue-600 rounded-full relative cursor-pointer">
                  <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="bg-white dark:bg-[#1a1d24] border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm dark:shadow-none">
            <h3 className="text-lg font-medium text-slate-900 dark:text-slate-200 mb-4">Storage & Library</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-slate-900 dark:text-slate-300 font-medium text-sm">Clear Library Data</h4>
                  <p className="text-xs text-slate-500 mt-1">Remove all indexed photos and faces. Files on disk won't be deleted.</p>
                </div>
                <button className="bg-red-500/10 text-red-500 hover:bg-red-500/20 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  Clear Index
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#1a1d24] border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm dark:shadow-none">
            <h3 className="text-lg font-medium text-slate-900 dark:text-slate-200 mb-4">Support</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-slate-900 dark:text-slate-300 font-medium text-sm">Report a Bug</h4>
                  <p className="text-xs text-slate-500 mt-1">Found an issue? Let us know on GitHub.</p>
                </div>
                <a 
                  href="https://github.com/ASK-03/SnapSort/issues/new" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Open GitHub Issue
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
