import { useAppStore } from '../store';
import { Globe } from 'lucide-react';

export const About = () => {
  const { viewMode } = useAppStore();

  if (viewMode !== 'about') return null;

  return (
    <div className="flex-1 flex flex-col bg-slate-50 dark:bg-[#0f1115] h-full overflow-y-auto p-8 items-center justify-center">
      <div className="max-w-md w-full text-center">
        <div className="w-24 h-24 bg-white dark:bg-[#1a1d24] rounded-2xl mx-auto mb-6 shadow-xl shadow-blue-500/20 flex items-center justify-center p-2 border border-slate-200 dark:border-slate-800">
          <img src="/snapsort-logo.png" alt="SnapSort Logo" className="w-full h-full object-contain rounded-xl" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">SnapSort</h2>
        <p className="text-slate-500 dark:text-slate-400 mb-8">Version 3.0.0 (Offline-First Privacy Edition)</p>
        
        <div className="bg-white dark:bg-[#1a1d24] border border-slate-200 dark:border-slate-800 rounded-xl p-6 mb-8 text-left">
          <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed mb-4">
            SnapSort is an open-source, AI-powered local photo manager. It uses on-device machine learning to index, categorize, and make your entire image library searchable without ever sending your private data to the cloud.
          </p>
          <div className="flex items-center gap-2 text-xs text-slate-500 mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            100% Offline Processing
          </div>
        </div>
        
        <div className="flex justify-center gap-6">
          <a 
            href="https://snapsort-website.vercel.app/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-2"
          >
            <Globe size={24} />
            <span className="text-sm font-medium">Website</span>
          </a>
          <a 
            href="https://github.com/ASK-03/SnapSort" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-2"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="css-i6dzq1"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
            <span className="text-sm font-medium">GitHub</span>
          </a>
        </div>
        
        <p className="text-xs text-slate-500 dark:text-slate-600 mt-12">
          &copy; {new Date().getFullYear()} SnapSort Team. Open Source.
        </p>
      </div>
    </div>
  );
};
