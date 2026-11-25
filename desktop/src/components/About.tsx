import { useAppStore } from '../store';
import { Globe } from 'lucide-react';

export const About = () => {
  const { viewMode } = useAppStore();

  if (viewMode !== 'about') return null;

  return (
    <div className="flex-1 flex flex-col bg-bg text-text h-full overflow-y-auto p-8 items-center justify-center">
      <div className="max-w-md w-full text-center">
        <div className="w-24 h-24 bg-surface rounded-2xl mx-auto mb-6 shadow-sm flex items-center justify-center p-2 border border-border">
          <img
            src="./snapsort-logo.png"
            alt="SnapSort Logo"
            className="w-full h-full object-contain rounded-xl"
          />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-text mb-2">SnapSort</h1>
        <p className="text-sm text-text-dim mb-8">Version 3.0.10 (Offline-First Privacy Edition)</p>

        <div className="bg-surface border border-border rounded-xl p-6 mb-8 text-left">
          <p className="text-text-dim text-sm leading-relaxed mb-4">
            SnapSort is an open-source, AI-powered local photo manager. It uses on-device machine learning to index,
            categorize, and make your entire image library searchable without ever sending your private data to the cloud.
          </p>
          <div className="flex items-center gap-2 text-xs text-text-mute mt-6 pt-4 border-t border-border">
            <span className="w-2 h-2 rounded-full bg-success" aria-hidden="true" />
            <span>100% Offline Processing</span>
          </div>
        </div>

        <div className="flex justify-center gap-6">
          <a
            href="https://snapsort-website.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="pressable text-text-dim hover:text-accent flex items-center gap-2 rounded-lg px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Globe size={20} aria-hidden="true" />
            <span className="text-sm font-medium">Website</span>
          </a>
          <a
            href="https://github.com/ASK-03/SnapSort"
            target="_blank"
            rel="noopener noreferrer"
            className="pressable text-text-dim hover:text-text flex items-center gap-2 rounded-lg px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
            </svg>
            <span className="text-sm font-medium">GitHub</span>
          </a>
        </div>

        <p className="text-xs text-text-mute mt-12">
          &copy; {new Date().getFullYear()} SnapSort Team. Open Source.
        </p>
      </div>
    </div>
  );
};
