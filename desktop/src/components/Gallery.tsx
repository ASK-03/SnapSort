import { useAppStore } from '../store';
import { getPreviewUrl, getSearch } from '../api';
import { X, Grid2X2, Folder, Search } from 'lucide-react';
import { withViewTransition } from '../lib/viewTransition';

import { useEffect, useMemo, useState } from 'react';
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
            onClick={() => withViewTransition(() => setLightboxImage(path, paths))}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, imagePath: path, paths });
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

type SearchState =
  | { status: 'waiting' | 'loading' | 'error' }
  | { status: 'ready'; paths: string[] };

// Mounted per query so an earlier request can never render into a newer search.
function SearchResults({ query, cols }: { query: string; cols: number }) {
  const [result, setResult] = useState<SearchState>({ status: 'waiting' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setResult({ status: 'loading' });
      try {
        const matches = await getSearch(query, controller.signal);
        if (!controller.signal.aborted) {
          setResult({ status: 'ready', paths: matches.map(match => match.path) });
        }
      } catch {
        if (!controller.signal.aborted) setResult({ status: 'error' });
      }
    }, attempt ? 0 : 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, attempt]);

  let summary = '';
  if (result.status === 'loading') summary = 'Searching…';
  if (result.status === 'error') summary = 'Search couldn’t finish';
  if (result.status === 'ready') {
    const count = result.paths.length;
    // The local search endpoint returns its top 20 ranked photos.
    if (!count) summary = 'No matching photos';
    else if (count === 20) summary = 'Top 20 matches';
    else summary = count === 1 ? '1 match' : `${count} matches`;
  }

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 px-8 pt-6 pb-4">
        <h2 className="text-[22px] leading-7 font-semibold tracking-tight text-text">Search results</h2>
        <span role="status" aria-live="polite" aria-atomic="true" className="text-[13px] leading-5 text-text-dim tabular-nums">
          {summary}
        </span>
      </header>
      <div className="photo-grid-scroll flex-1 min-h-0 pl-8 pr-1 pb-4 overflow-hidden">
        {result.status === 'ready' && result.paths.length > 0 && <PhotoGrid paths={result.paths} cols={cols} />}
        {(result.status === 'error' || (result.status === 'ready' && !result.paths.length)) && (
          <div className="h-full pr-7 flex flex-col items-center justify-center gap-3 text-text-dim">
            <Search size={24} aria-hidden="true" />
            {result.status === 'error' ? (
              <button className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text hover:bg-surface-hi"
                onClick={() => { setResult({ status: 'loading' }); setAttempt(value => value + 1); }}>Retry</button>
            ) : <p className="text-sm">Try another description or a person you’ve named.</p>}
          </div>
        )}
      </div>
    </>
  );
}

export const Gallery = ({ query }: { query?: string }) => {
  const { images, folderFilter, setFolderFilter } = useAppStore();
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

  const numCols = getColCount();

  return (
    <div className="flex-1 flex flex-col bg-bg h-full overflow-hidden">
      {query ? <SearchResults key={query} query={query} cols={numCols} /> : (
        <>
          <div className="px-8 py-4 flex items-center">
            {folderFilter ? (
              <div className="flex items-center gap-2 bg-surface-hi text-text-dim px-3 py-1.5 rounded-full text-sm border border-border">
                <Folder size={13} />
                <span>{basename(folderFilter)}</span>
                <button aria-label="Clear folder filter" onClick={() => setFolderFilter(null)} className="hover:text-text">
                  <X size={14} />
                </button>
              </div>
            ) : <span className="text-sm text-text-mute">{displayImages.length.toLocaleString()} results</span>}
          </div>
          <div className="photo-grid-scroll flex-1 min-h-0 pl-8 pr-1 pb-4 overflow-hidden">
            {displayImages.length ? <PhotoGrid paths={displayImages} cols={numCols} /> : (
              <div className="h-full flex items-center justify-center text-text-mute flex-col gap-4">
                <Grid2X2 size={48} className="opacity-20" />
                <p>No images to display</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Bottom status & zoom bar */}
      <div className="px-8 py-3 border-t border-border flex items-center justify-between text-xs text-text-mute bg-bg">
        {!query && <div>{displayImages.length.toLocaleString()} results</div>}
        <div className="ml-auto flex items-center gap-4">
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
