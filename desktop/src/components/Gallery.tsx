import { useAppStore } from '../store';
import { getPreviewUrl } from '../api';
import { X, Grid2X2, Folder } from 'lucide-react';
import { withViewTransition } from '../lib/viewTransition';

import { useMemo, useState } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';

// Shown when a tile's source file is gone (drive unmounted, file moved).
// Data URI so swapping it in can't re-fire onError and loop.
const MISSING_TILE = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-opacity='0.25' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M3 3l18 18M21 15l-5-5L5 21M8 8a1 1 0 100-2 1 1 0 000 2'/><path d='M21 17V5a2 2 0 00-2-2H7M3 7v12a2 2 0 002 2h12'/></svg>";

const dirname = (path: string) => {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join('/') || '/';
};

const basename = (path: string) => {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
};

// Static class names (not built from a runtime template) so Tailwind's
// JIT scanner picks them up at build time.
const GRID_COLS_CLASS: Record<number, string> = {
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
  8: 'grid-cols-8',
};

// Virtualized tile grid shared by Gallery and PersonView.
export const PhotoGrid = ({ paths, cols }: { paths: string[]; cols: number }) => {
  const { setLightboxImage, setContextMenu } = useAppStore();
  return (
    <VirtuosoGrid
      style={{ height: '100%' }}
      totalCount={paths.length}
      listClassName={`grid gap-4 pt-4 ${GRID_COLS_CLASS[cols]}`}
      itemContent={(index) => {
        const path = paths[index];
        return (
          <div
            className="rounded-2xl overflow-hidden cursor-pointer relative group border-2 border-transparent hover:border-accent/50 transition-colors duration-150 bg-surface-hi aspect-square"
            onClick={() => withViewTransition(() => setLightboxImage(path))}
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
              style={{ imageOrientation: 'from-image' } as any}
              onError={(e) => {
                e.currentTarget.src = MISSING_TILE;
                e.currentTarget.className = 'w-full h-full object-contain p-8';
              }}
            />
          </div>
        );
      }}
    />
  );
};

export const Gallery = () => {
  const {
    images, searchQuery, setSearchQuery,
    folderFilter, setFolderFilter,
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

  const displayImages = useMemo(
    () => (folderFilter ? images.filter((p) => dirname(p) === folderFilter) : images),
    [images, folderFilter]
  );

  const hasSearch = searchQuery.trim().length > 0;
  const numCols = getColCount();

  const clearFilters = () => {
    setSearchQuery('');
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
              <span>"{searchQuery}"</span>
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
          <PhotoGrid paths={displayImages} cols={numCols} />
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
