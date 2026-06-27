import { useAppStore } from '../store';
import { getPreviewUrl } from '../api';
import { CheckCircle2, X, Grid2X2 } from 'lucide-react';

import { useState } from 'react';

export const Gallery = () => {
  const { images, searchQuery, setSearchQuery, selectedImage, setSelectedImage, setShowRightSidebar, setLightboxImage } = useAppStore();
  const [zoom, setZoom] = useState(6);

  const getColCount = () => {
    switch (zoom) {
      case 8: return 3;
      case 6: return 4;
      case 4: return 6;
      case 2: return 8;
      default: return 6;
    }
  };

  const handleImageClick = (path: string) => {
    setSelectedImage(path);
    setShowRightSidebar(true);
  };

  const hasSearch = searchQuery.trim().length > 0;

  const numCols = getColCount();
  const columns: string[][] = Array.from({ length: numCols }, () => []);

  images.forEach((path, i) => {
    columns[i % numCols].push(path);
  });

  return (
    <div className="flex-1 flex flex-col bg-slate-50 dark:bg-[#0f1115] h-full overflow-hidden">

      {/* Gallery Header / Search Breadcrumbs */}
      <div className="px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {hasSearch ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-400">Search results for:</span>
              <div className="flex items-center gap-2 bg-blue-500/10 text-blue-400 px-3 py-1.5 rounded-full text-sm border border-blue-500/20">
                <span>"{searchQuery}"</span>
                <button onClick={() => setSearchQuery('')} className="hover:text-blue-300">
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : (
            <span className="text-sm text-slate-400">{images.length.toLocaleString()} results</span>
          )}
        </div>

        {hasSearch && (
          <button
            onClick={() => setSearchQuery('')}
            className="text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-[#1a1d24] hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-1.5 rounded-lg transition-colors flex items-center gap-2 shadow-sm dark:shadow-none"
          >
            Back to All Images
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 px-8 pb-4 overflow-y-auto">
        {images.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-500 flex-col gap-4">
            <Grid2X2 size={48} className="opacity-20" />
            <p>No images to display</p>
          </div>
        ) : (
          <div className="flex gap-4 pt-8">
            {columns.map((colImages, colIndex) => (
              <div key={colIndex} className="flex flex-col gap-4 flex-1">
                {colImages.map((path) => {
                  const isSelected = selectedImage === path;
                  return (
                    <div
                      key={path}
                      className={`rounded-xl overflow-hidden cursor-pointer relative group border-2 border-transparent hover:border-slate-400 dark:hover:border-slate-600 transition-all bg-slate-200 dark:bg-black/20 ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-[#0f1115]' : ''}`}
                      onClick={() => handleImageClick(path)}
                      onDoubleClick={() => setLightboxImage(path)}
                    >
                      <img
                        src={getPreviewUrl(path)}
                        alt=""
                        loading="lazy"
                        className="w-full h-auto object-cover"
                        style={{ imageOrientation: 'from-image' } as any}
                      />

                      {isSelected && (
                        <div className="absolute top-2 right-2 text-blue-500 bg-white rounded-full">
                          <CheckCircle2 size={20} className="fill-current text-blue-500 stroke-white" />
                        </div>
                      )}
                      <div className="absolute top-2 left-2 w-2 h-2 rounded-full bg-blue-500 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom status & zoom bar */}
      <div className="px-8 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 bg-white dark:bg-[#0f1115]">
        <div>{images.length.toLocaleString()} results</div>
        <div className="flex items-center gap-4">
          <Grid2X2 size={14} className="text-slate-400" />
          <input
            type="range"
            min="2"
            max="8"
            step="2"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-24 accent-blue-500 cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
};
