import { useAppStore } from '../store';
import { getPreviewUrl, getSearch, scanFolder } from '../api';
import { X, Grid2X2, Folder, Search, FolderPlus } from 'lucide-react';
import { withViewTransition } from '../lib/viewTransition';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { VirtuosoGrid } from 'react-virtuoso';

const MISSING_TILE =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888888' stroke-opacity='0.45' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M3 3l18 18M21 15l-5-5L5 21M8 8a1 1 0 100-2 1 1 0 000 2'/><path d='M21 17V5a2 2 0 00-2-2H7M3 7v12a2 2 0 002 2h12'/></svg>";

const dirname = (path: string) => {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join('/') || '/';
};

const basename = (path: string) => {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
};

const pluralPhotos = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'photo' : 'photos'}`;

const GRID_COLS_CLASS: Record<number, string> = {
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  6: 'grid-cols-6',
  8: 'grid-cols-8',
};

const DensityControl = ({ zoom, onChange }: { zoom: number; onChange: (val: number) => void }) => (
  <div className="ml-auto flex items-center gap-2.5 text-text-mute">
    <Grid2X2 size={14} strokeWidth={1.75} aria-hidden="true" />
    <input
      type="range"
      min={2}
      max={8}
      step={2}
      value={zoom}
      aria-label="Thumbnail size"
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-24 accent-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
    />
  </div>
);

export const PhotoGrid = ({ paths, cols }: { paths: string[]; cols: number }) => {
  const {
    lightboxImage,
    setLightboxImage,
    setContextMenu,
    lastLightboxTrigger,
    setLastLightboxTrigger,
    imageVersions,
  } = useAppStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLightboxRef = useRef<string | null>(lightboxImage);

  useEffect(() => {
    const wasOpen = Boolean(prevLightboxRef.current);
    prevLightboxRef.current = lightboxImage;
    if (wasOpen && !lightboxImage && lastLightboxTrigger && containerRef.current) {
      const target = Array.from(containerRef.current.querySelectorAll<HTMLButtonElement>('button[data-photo-path]'))
        .find((el) => el.dataset.photoPath === lastLightboxTrigger);
      target?.focus();
    }
  }, [lightboxImage, lastLightboxTrigger]);

  return (
    <div ref={containerRef} className="h-full w-full">
      <VirtuosoGrid
        style={{ height: '100%' }}
        totalCount={paths.length}
        listClassName={`grid gap-2 pt-1 pb-6 ${GRID_COLS_CLASS[cols] ?? 'grid-cols-4'}`}
        itemContent={(index) => {
          const path = paths[index];
          const name = basename(path);
          const isSelected = lightboxImage === path || lastLightboxTrigger === path;
          const ver = imageVersions[path];
          const src = ver ? `${getPreviewUrl(path)}&v=${ver}` : getPreviewUrl(path);
          return (
            <button
              type="button"
              data-photo-path={path}
              aria-label={`Open ${name}`}
              className={`tile-pressable img-frame-outline group block w-full aspect-square rounded-md overflow-hidden bg-surface-hi cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                isSelected ? 'ring-2 ring-inset ring-accent' : ''
              }`}
              onClick={() => {
                setLastLightboxTrigger(path);
                withViewTransition(() => flushSync(() => setLightboxImage(path, paths)));
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setLastLightboxTrigger(path);
                setContextMenu({ x: e.clientX, y: e.clientY, imagePath: path, paths });
              }}
            >
              <img
                src={src}
                alt={name}
                loading="lazy"
                decoding="async"
                className="hover-zoom-img w-full h-full object-cover block"
                style={{ imageOrientation: 'from-image' }}
                onError={(e) => {
                  e.currentTarget.src = MISSING_TILE;
                  e.currentTarget.className = 'w-full h-full object-contain p-8';
                }}
              />
            </button>
          );
        }}
      />
    </div>
  );
};

type SearchState =
  | { status: 'waiting' | 'loading' | 'error' }
  | { status: 'ready'; paths: string[] };

function SearchResults({ query, cols, zoom, onZoomChange }: {
  query: string;
  cols: number;
  zoom: number;
  onZoomChange: (v: number) => void;
}) {
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const [result, setResult] = useState<SearchState>({ status: 'waiting' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setResult({ status: 'loading' });
      try {
        const matches = await getSearch(query, controller.signal);
        if (!controller.signal.aborted) {
          setResult({ status: 'ready', paths: matches.map((match) => match.path) });
        }
      } catch {
        if (!controller.signal.aborted) setResult({ status: 'error' });
      }
    }, attempt ? 0 : 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, attempt]);

  let summary = '';
  if (result.status === 'loading') summary = 'Searching…';
  if (result.status === 'error') summary = 'Search could not finish';
  if (result.status === 'ready') {
    const count = result.paths.length;
    if (!count) summary = 'No matching photos';
    else if (count === 20) summary = 'Top 20 matches';
    else summary = count === 1 ? '1 match' : `${count.toLocaleString()} matches`;
  }

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-6 pt-5 pb-3.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
          <h1 className="text-3xl leading-tight font-semibold tracking-[-0.025em] text-text">Search results</h1>
          <span role="status" aria-live="polite" aria-atomic="true" className="text-sm text-text-mute tabular-nums">
            {summary ? `· ${summary}` : ''}
          </span>
        </div>
        <DensityControl zoom={zoom} onChange={onZoomChange} />
      </header>
      <div className="search-results-grid flex-1 min-h-0 px-6 pb-2 overflow-hidden">
        {result.status === 'ready' && result.paths.length > 0 && <PhotoGrid paths={result.paths} cols={cols} />}
        {(result.status === 'error' || (result.status === 'ready' && !result.paths.length)) && (
          <div className="reveal-soft h-full flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-12 h-12 rounded-xl bg-surface border border-border grid place-items-center text-text-dim">
              <Search size={20} strokeWidth={1.75} aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-text">
              {result.status === 'error' ? 'Search could not finish' : 'No matching photos'}
            </h2>
            <p className="text-[13px] text-text-dim max-w-[34ch]">
              {result.status === 'error'
                ? 'The local search service did not respond. Try running your query again.'
                : 'Try another description, a scene, or a person you have named.'}
            </p>
            {result.status === 'error' ? (
              <button
                type="button"
                className="pressable rounded-lg bg-accent text-on-accent px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onClick={() => {
                  setResult({ status: 'loading' });
                  setAttempt((value) => value + 1);
                }}
              >
                Retry
              </button>
            ) : (
              <button
                type="button"
                className="pressable rounded-lg border border-border bg-surface text-text hover:bg-surface-hi px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onClick={() => setSearchQuery('')}
              >
                Clear search
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export const Gallery = ({ query }: { query?: string }) => {
  const { images, folderFilter, setFolderFilter, setIsScanning, setScanningFolder } = useAppStore();
  const [zoom, setZoom] = useState(6);

  const numCols = zoom === 8 ? 3 : zoom === 6 ? 4 : zoom === 4 ? 6 : 8;

  const displayImages = useMemo(
    () => (folderFilter ? images.filter((p) => dirname(p) === folderFilter) : images),
    [images, folderFilter]
  );

  const handleAddFolder = async () => {
    const folderPath = await window.electronAPI?.openDirectory();
    if (folderPath) {
      setScanningFolder(basename(folderPath));
      setIsScanning(true);
      await scanFolder(folderPath);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-bg h-full overflow-hidden">
      {query ? (
        <SearchResults key={query} query={query} cols={numCols} zoom={zoom} onZoomChange={setZoom} />
      ) : (
        <>
          <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-6 pt-5 pb-3.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
              <h1 className="text-3xl leading-tight font-semibold tracking-[-0.025em] text-text truncate">
                {folderFilter ? basename(folderFilter) : 'All Photos'}
              </h1>
              <span className="text-sm text-text-mute tabular-nums">
                · {pluralPhotos(displayImages.length)}
              </span>
              {folderFilter && (
                <button
                  type="button"
                  onClick={() => setFolderFilter(null)}
                  aria-label="Clear folder filter"
                  className="pressable inline-flex items-center gap-1.5 bg-surface border border-border text-text-dim hover:bg-surface-hi hover:text-text px-2.5 py-1 rounded-full text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Folder size={12} aria-hidden="true" />
                  <span>All photos</span>
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </div>
            {displayImages.length > 0 && <DensityControl zoom={zoom} onChange={setZoom} />}
          </header>

          <div className="flex-1 min-h-0 px-6 pb-2 overflow-hidden">
            {displayImages.length > 0 ? (
              <PhotoGrid paths={displayImages} cols={numCols} />
            ) : (
              <div className="reveal-soft h-full flex flex-col items-center justify-center gap-3 text-center">
                <div className="w-12 h-12 rounded-xl bg-surface border border-border grid place-items-center text-text-dim">
                  {folderFilter ? <Folder size={20} strokeWidth={1.75} aria-hidden="true" /> : <FolderPlus size={20} strokeWidth={1.75} aria-hidden="true" />}
                </div>
                <h2 className="text-base font-semibold text-text">
                  {folderFilter ? 'No photos in this folder' : 'Your photos stay on this device'}
                </h2>
                <p className="text-[13px] text-text-dim max-w-[36ch]">
                  {folderFilter
                    ? 'This folder has no indexed images yet.'
                    : 'Select a local folder to index your library with offline search and face grouping.'}
                </p>
                {folderFilter ? (
                  <button
                    type="button"
                    onClick={() => setFolderFilter(null)}
                    className="pressable rounded-lg border border-border bg-surface text-text hover:bg-surface-hi px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Show all photos
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleAddFolder}
                    className="pressable rounded-lg bg-accent text-on-accent px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Add folder
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
