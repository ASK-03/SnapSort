import { useAppStore } from '../store';
import { getPreviewUrl } from '../api';
import { CheckCircle2, X, Grid2X2, Folder } from 'lucide-react';
import { vtName, withViewTransition } from '../lib/viewTransition';

import { useMemo, useState } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';

const dirname = (path: string) => {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join('/') || '/';
};

const basename = (path: string) => {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
};

export const Gallery = () => {
  const {
    images, searchQuery, setSearchQuery, searchFaceFilter, setSearchFaceFilter,
    folderFilter, setFolderFilter, selectedImage, setSelectedImage, setShowRightSidebar,
    setLightboxImage, setContextMenu,
  } = useAppStore();
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

  // Static class names (not built from a runtime template) so Tailwind's
  // JIT scanner picks them up at build time.
  const GRID_COLS_CLASS: Record<number, string> = {
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    6: 'grid-cols-6',
    8: 'grid-cols-8',
  };

  const displayImages = useMemo(
    () => (folderFilter ? images.filter((p) => dirname(p) === folderFilter) : images),
    [images, folderFilter]
  );

  const handleImageClick = (path: string) => {
    setSelectedImage(path);
    setShowRightSidebar(true);
  };

  const openLightbox = (path: string) => {
    withViewTransition(() => setLightboxImage(path));
  };

  const hasSearch = searchQuery.trim().length > 0 || !!searchFaceFilter;
  const numCols = getColCount();

  const clearFilters = () => {
    setSearchQuery('');
    setSearchFaceFilter(null);
  };

  return (
    <div className="flex-1 flex flex-col bg-bg h-full overflow-hidden">

      {/* Gallery Header / Search Breadcrumbs */}
      <div className="px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          {folderFilter && (
            <div className="flex items-center gap-2 bg-surface-hi text-text-dim px-3 py-1.5 rounded-full text-sm border border-border">
              <Folder size={13} />
              <span>{basename(folderFilter)}</span>
              <button onClick={() => setFolderFilter(null)} className="hover:text-text">
                <X size={14} />
              </button>
            </div>
          )}
          {hasSearch ? (
            <div className="flex items-center gap-2 bg-accent/10 text-accent px-3 py-1.5 rounded-full text-sm border border-accent/20">
              <span>"{searchFaceFilter ? searchFaceFilter.name : searchQuery}"</span>
              <button onClick={clearFilters} className="hover:brightness-125">
                <X size={14} />
              </button>
            </div>
          ) : !folderFilter && (
            <span className="text-sm text-text-mute">{displayImages.length.toLocaleString()} results</span>
          )}
        </div>
      </div>

      {/* Grid — VirtuosoGrid only mounts DOM nodes for cells near the viewport,
          so scroll performance stays flat regardless of library size. */}
      <div className="flex-1 px-8 pb-4 overflow-hidden">
        {displayImages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-text-mute flex-col gap-4">
            <Grid2X2 size={48} className="opacity-20" />
            <p>No images to display</p>
          </div>
        ) : (
          <VirtuosoGrid
            style={{ height: '100%' }}
            totalCount={displayImages.length}
            listClassName={`grid gap-4 pt-8 ${GRID_COLS_CLASS[numCols]}`}
            itemContent={(index) => {
              const path = displayImages[index];
              const isSelected = selectedImage === path;
              return (
                <div
                  className={`rounded-xl overflow-hidden cursor-pointer relative group border-2 border-transparent hover:border-accent/50 transition-colors duration-250 ease-apple bg-surface-hi aspect-square ${isSelected ? 'ring-2 ring-inset ring-accent' : ''}`}
                  onClick={() => handleImageClick(path)}
                  onDoubleClick={() => openLightbox(path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, imagePath: path });
                  }}
                >
                  <img
                    src={getPreviewUrl(path)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                    style={{ imageOrientation: 'from-image', viewTransitionName: vtName(path) } as any}
                  />

                  {isSelected && (
                    <div className="absolute top-2 right-2 text-accent bg-bg rounded-full">
                      <CheckCircle2 size={20} className="fill-current text-accent stroke-bg" />
                    </div>
                  )}
                  <div className="absolute top-2 left-2 w-2 h-2 rounded-full bg-accent shadow-sm opacity-0 group-hover:opacity-100 transition-opacity duration-250 ease-apple"></div>
                </div>
              );
            }}
          />
        )}
      </div>

      {/* Bottom status & zoom bar */}
      <div className="px-8 py-3 border-t border-border flex items-center justify-between text-xs text-text-mute bg-bg">
        <div>{displayImages.length.toLocaleString()} results</div>
        <div className="flex items-center gap-4">
          <Grid2X2 size={14} className="text-text-mute" />
          <input
            type="range"
            min="2"
            max="8"
            step="2"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-24 accent-accent cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
};
