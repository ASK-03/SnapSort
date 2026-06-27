import { useAppStore } from '../store';
import { getImageUrl } from '../api';
import { VirtuosoGrid } from 'react-virtuoso';
import { CheckCircle2, X, Grid2X2 } from 'lucide-react';

export const Gallery = () => {
  const { images, searchQuery, setSearchQuery, selectedImage, setSelectedImage, setShowRightSidebar } = useAppStore();

  const handleImageClick = (path: string) => {
    setSelectedImage(path);
    setShowRightSidebar(true);
  };

  const hasSearch = searchQuery.trim().length > 0;

  return (
    <div className="flex-1 flex flex-col bg-[#0f1115] h-full overflow-hidden">
      
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
            className="text-sm text-slate-300 bg-[#1a1d24] hover:bg-slate-800 border border-slate-700 px-4 py-1.5 rounded-lg transition-colors flex items-center gap-2"
          >
            Back to All Images
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 px-8 pb-4">
        {images.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-500 flex-col gap-4">
            <Grid2X2 size={48} className="opacity-20" />
            <p>No images to display</p>
          </div>
        ) : (
          <VirtuosoGrid
            totalCount={images.length}
            overscan={20}
            listClassName="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
            itemClassName="aspect-[4/3] rounded-xl overflow-hidden cursor-pointer relative group border-2 border-transparent hover:border-slate-600 transition-all"
            itemContent={(index) => {
              const path = images[index];
              const isSelected = selectedImage === path;
              return (
                <div 
                  className={`w-full h-full relative ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-[#0f1115] rounded-xl' : ''}`}
                  onClick={() => handleImageClick(path)}
                >
                  <img 
                    src={getImageUrl(path)}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  
                  {/* Selection Checkbox indicator (from mockup) */}
                  {isSelected && (
                    <div className="absolute top-2 right-2 text-blue-500 bg-white rounded-full">
                      <CheckCircle2 size={20} className="fill-current text-blue-500 stroke-white" />
                    </div>
                  )}
                  {/* Tag indicator from mockup */}
                  <div className="absolute top-2 left-2 w-2 h-2 rounded-full bg-blue-500 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"></div>
                </div>
              );
            }}
          />
        )}
      </div>
      
      {/* Bottom pagination & zoom bar from mockup */}
      <div className="px-8 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500 bg-[#0f1115]">
        <div>{images.length} results</div>
        <div className="flex items-center gap-1">
          <button className="w-6 h-6 flex items-center justify-center hover:bg-slate-800 rounded">&lt;</button>
          <button className="w-6 h-6 flex items-center justify-center bg-blue-600 text-white rounded">1</button>
          <button className="w-6 h-6 flex items-center justify-center hover:bg-slate-800 rounded">2</button>
          <button className="w-6 h-6 flex items-center justify-center hover:bg-slate-800 rounded">3</button>
          <span>...</span>
          <button className="w-6 h-6 flex items-center justify-center hover:bg-slate-800 rounded">8</button>
          <button className="w-6 h-6 flex items-center justify-center hover:bg-slate-800 rounded">&gt;</button>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-32 h-1 bg-slate-800 rounded-full relative">
            <div className="absolute left-1/2 w-3 h-3 bg-white rounded-full -top-1 shadow cursor-pointer"></div>
          </div>
        </div>
      </div>
    </div>
  );
};
