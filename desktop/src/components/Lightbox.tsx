import { useAppStore } from '../store';
import { getImageUrl, getFaceThumbnailUrl, api } from '../api';
import { X, ChevronLeft, ChevronRight, Info, SlidersHorizontal, Minus, Plus, Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useCallback, useState, useRef } from 'react';
import { LIGHTBOX_ROOT_VT, VIEWER_IMAGE_VT, withViewTransition } from '../lib/viewTransition';
import { InfoPanel } from './InfoPanel';
import { EditPanel } from './EditPanel';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

function clampPan(
  pan: { x: number; y: number },
  scale: number,
  viewport: HTMLDivElement | null,
  img: HTMLImageElement | null,
) {
  if (scale <= 1 || !viewport || !img || !img.naturalWidth) return { x: 0, y: 0 };
  const vw = viewport.offsetWidth;
  const vh = viewport.offsetHeight;
  const fit = Math.min(vw / img.naturalWidth, vh / img.naturalHeight);
  const pw = img.naturalWidth * fit;
  const ph = img.naturalHeight * fit;
  const axis = (v: number, p: number, t: number) => {
    const inset = (v - p) / 2;
    const min = v - scale * (inset + p);
    const max = -scale * inset;
    return min > max ? (v - scale * p) / 2 - scale * inset : Math.min(max, Math.max(min, t));
  };
  return { x: axis(vw, pw, pan.x), y: axis(vh, ph, pan.y) };
}

export const Lightbox = () => {
  const {
    lightboxImage,
    setLightboxImage,
    lightboxPaths: images,
    viewerPanel,
    setViewerPanel,
    viewerZoom,
    setViewerZoom,
    viewerPan,
    setViewerPan,
    setSelectedPerson,
    setViewMode,
    imageVersions,
  } = useAppStore();

  const [faces, setFaces] = useState<{ id: number; name: string | null }[]>([]);
  const [editFilter, setEditFilter] = useState('none');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const bottomBandRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragState = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const zoomAt = useCallback((newScale: number, c: { x: number; y: number }) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +newScale.toFixed(3)));
    useAppStore.setState((s) => {
      const nx = c.x - (clamped / s.viewerZoom) * (c.x - s.viewerPan.x);
      const ny = c.y - (clamped / s.viewerZoom) * (c.y - s.viewerPan.y);
      return {
        viewerZoom: clamped,
        viewerPan: clampPan({ x: nx, y: ny }, clamped, viewportRef.current, imgRef.current),
      };
    });
  }, []);

  const zoomAtCenter = useCallback((newScale: number) => {
    const el = viewportRef.current;
    const c = el ? { x: el.offsetWidth / 2, y: el.offsetHeight / 2 } : { x: 0, y: 0 };
    zoomAt(newScale, c);
  }, [zoomAt]);

  const goTo = useCallback((path: string, instant = false) => {
    withViewTransition(() => {
      setLightboxImage(path);
      setViewerZoom(1);
      setViewerPan({ x: 0, y: 0 });
    }, instant);
  }, [setLightboxImage, setViewerZoom, setViewerPan]);

  const handleNext = useCallback((instant = false) => {
    if (!lightboxImage || !images.length) return;
    const idx = images.indexOf(lightboxImage);
    if (idx >= 0 && idx < images.length - 1) goTo(images[idx + 1], instant);
  }, [lightboxImage, images, goTo]);

  const handlePrev = useCallback((instant = false) => {
    if (!lightboxImage || !images.length) return;
    const idx = images.indexOf(lightboxImage);
    if (idx > 0) goTo(images[idx - 1], instant);
  }, [lightboxImage, images, goTo]);

  const close = useCallback(() => {
    if (document.fullscreenElement === rootRef.current) {
      document.exitFullscreen().catch(() => {});
    }
    setIsFullscreen(false);
    withViewTransition(() => {
      setLightboxImage(null);
      setViewerPanel('none');
      setViewerZoom(1);
      setViewerPan({ x: 0, y: 0 });
    });
  }, [setLightboxImage, setViewerPanel, setViewerZoom, setViewerPan]);

  const openFace = useCallback((f: { id: number; name: string | null }) => {
    setSelectedPerson({ id: f.id, name: f.name || `Person ${f.id}` });
    setViewMode('people');
    close();
  }, [close, setSelectedPerson, setViewMode]);

  useEffect(() => {
    if (lightboxImage) {
      closeBtnRef.current?.focus();
    }
  }, [lightboxImage]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      await document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
      return;
    }
    if (el.requestFullscreen) {
      try {
        await el.requestFullscreen();
        setIsFullscreen(true);
        return;
      } catch {
        // Fallback below if blocked
      }
    }
    setIsFullscreen((prev) => !prev);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (viewerPanel === 'none') {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          handleNext(true);
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          handlePrev(true);
        }
      }
    };
    if (lightboxImage) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxImage, viewerPanel, handleNext, handlePrev, close]);

  useEffect(() => {
    if (!lightboxImage) return;
    api.get(`/images/faces?image_path=${encodeURIComponent(lightboxImage)}`)
      .then((res) => setFaces(res.data.faces || []))
      .catch(() => setFaces([]));
  }, [lightboxImage]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const c = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const current = useAppStore.getState().viewerZoom;
      zoomAt(current * Math.exp(-e.deltaY * 0.0015), c);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, lightboxImage]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (viewerZoom <= 1) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragState.current = { x: e.clientX, y: e.clientY, panX: viewerPan.x, panY: viewerPan.y };
  }, [viewerZoom, viewerPan]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const { x, y, panX, panY } = dragState.current;
    setViewerPan(clampPan({ x: panX + (e.clientX - x), y: panY + (e.clientY - y) }, viewerZoom, viewportRef.current, imgRef.current));
  }, [viewerZoom, setViewerPan]);

  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  if (!lightboxImage) return null;

  const idx = images.indexOf(lightboxImage);
  const hasNext = idx >= 0 && idx < images.length - 1;
  const hasPrev = idx > 0;
  const filename = lightboxImage.split(/[\\/]/).pop() || 'Unknown';
  const ver = imageVersions[lightboxImage];
  const imgSrc = ver ? `${getImageUrl(lightboxImage)}&v=${ver}` : getImageUrl(lightboxImage);
  const rightReserve = viewerPanel === 'info' ? 'md:right-[320px]' : viewerPanel === 'edit' ? 'md:right-[288px]' : '';

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo viewer: ${filename}`}
      className={`fixed inset-0 bg-viewer-bg text-text overflow-hidden flex flex-col ${isFullscreen ? 'z-[70]' : 'z-50'}`}
      style={{ viewTransitionName: LIGHTBOX_ROOT_VT }}
    >
      {/* Dedicated slim header lane above the photo (z-30 strictly above inspector drawers) */}
      <header className="window-drag relative z-30 h-14 shrink-0 bg-viewer-header border-b border-border grid grid-cols-[1fr_minmax(0,2fr)_1fr] items-center gap-3 px-5">
        <div className="flex items-center">
          <IconButton
            buttonRef={closeBtnRef}
            onClick={close}
            ariaLabel="Close viewer"
            title="Close (Escape)"
          >
            <X size={16} />
          </IconButton>
        </div>

        <div className="min-w-0 flex flex-col items-center justify-center gap-0.5">
          <span className="max-w-full truncate text-[13px] font-semibold text-text">{filename}</span>
          {(hasPrev || hasNext) && (
            <span className="text-xs text-text-mute tabular-nums">{`${idx + 1} of ${images.length}`}</span>
          )}
        </div>

        <div className="justify-self-end flex items-center gap-2">
          <IconButton
            active={viewerPanel === 'edit'}
            ariaLabel="Edit photo"
            ariaPressed={viewerPanel === 'edit'}
            title="Edit photo"
            onClick={() => setViewerPanel(viewerPanel === 'edit' ? 'none' : 'edit')}
          >
            <SlidersHorizontal size={16} />
          </IconButton>
          <IconButton
            active={viewerPanel === 'info'}
            ariaLabel="Photo details"
            ariaPressed={viewerPanel === 'info'}
            title="Photo details"
            onClick={() => setViewerPanel(viewerPanel === 'info' ? 'none' : 'info')}
          >
            <Info size={16} />
          </IconButton>
        </div>
      </header>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        {/* Image stage reserves right lane for open inspector */}
        <div
          ref={stageRef}
          onClick={(e) => {
            if (viewerZoom > 1) return;
            if (
              e.target === stageRef.current ||
              e.target === canvasRef.current ||
              e.target === viewportRef.current ||
              e.target === bottomBandRef.current
            ) {
              close();
            }
          }}
          className={`absolute inset-y-0 left-0 right-0 flex flex-col min-w-0 overflow-hidden ${rightReserve}`}
        >
          <div ref={canvasRef} className="flex-1 relative flex items-center justify-center min-h-0 px-14 py-4">
            {hasPrev && (
              <button
                type="button"
                onClick={() => handlePrev(false)}
                aria-label="Previous photo"
                className={`pressable absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-viewer-panel border border-border text-text hover:bg-surface-hi grid place-items-center z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-[opacity,background-color] duration-150 motion-reduce:transition-none ${
                  viewerPanel !== 'none' ? 'opacity-0 pointer-events-none' : 'opacity-100'
                }`}
              >
                <ChevronLeft size={18} />
              </button>
            )}

            <div
              ref={viewportRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className={`w-full h-full flex items-center justify-center overflow-hidden rounded-xl ${
                viewerZoom > 1 ? 'cursor-grab active:cursor-grabbing' : ''
              }`}
              style={{ viewTransitionName: VIEWER_IMAGE_VT }}
            >
              <img
                ref={imgRef}
                src={imgSrc}
                alt={filename}
                className={`block object-contain select-none shadow-[0_0_0_1px_var(--ss-img-outline)] ${
                  viewerZoom > 1 ? 'w-full h-full' : 'max-w-full max-h-full rounded-[10px]'
                }`}
                draggable={false}
                style={{
                  imageOrientation: 'from-image',
                  filter: editFilter,
                  transformOrigin: '0 0',
                  transform: viewerZoom > 1 ? `translate(${viewerPan.x}px, ${viewerPan.y}px) scale(${viewerZoom})` : undefined,
                }}
              />
            </div>

            {hasNext && (
              <button
                type="button"
                onClick={() => handleNext(false)}
                aria-label="Next photo"
                className={`pressable absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-viewer-panel border border-border text-text hover:bg-surface-hi grid place-items-center z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-[opacity,background-color] duration-150 motion-reduce:transition-none ${
                  viewerPanel !== 'none' ? 'opacity-0 pointer-events-none' : 'opacity-100'
                }`}
              >
                <ChevronRight size={18} />
              </button>
            )}
          </div>

          <div ref={bottomBandRef} className="relative z-10 shrink-0 flex flex-col items-center gap-2.5 pb-4 pt-1 px-4">
            {faces.length > 0 && viewerPanel === 'none' && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {faces.map((f, faceIdx) => (
                  <button
                    key={`${f.id}-${faceIdx}`}
                    type="button"
                    onClick={() => openFace(f)}
                    title={`Show all photos of ${f.name || 'this person'}`}
                    className="pressable flex items-center gap-2 bg-viewer-panel hover:bg-surface-hi border border-border rounded-full pl-1 pr-3 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <img src={getFaceThumbnailUrl(f.id)} className="w-6 h-6 rounded-full object-cover bg-surface-hi" alt="" />
                    <span className="text-xs font-medium text-text">{f.name || 'Unknown'}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 bg-viewer-panel border border-border rounded-full px-2.5 py-1 shadow-sm">
              <ZoomBtn ariaLabel="Zoom out" onClick={() => zoomAtCenter(viewerZoom - 0.2)}>
                <Minus size={13} />
              </ZoomBtn>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.1}
                value={viewerZoom}
                aria-label="Zoom level"
                onChange={(e) => zoomAtCenter(Number(e.target.value))}
                className="w-24 accent-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
              />
              <ZoomBtn ariaLabel="Zoom in" onClick={() => zoomAtCenter(viewerZoom + 0.2)}>
                <Plus size={14} />
              </ZoomBtn>
              <button
                type="button"
                onClick={() => {
                  setViewerZoom(1);
                  setViewerPan({ x: 0, y: 0 });
                }}
                aria-label="Reset zoom to fit"
                title={viewerZoom > 1 ? 'Reset zoom to fit (100%)' : 'Current zoom: 100%'}
                className={`pressable px-2 h-6 rounded-full text-xs font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  viewerZoom > 1 ? 'text-accent hover:bg-viewer-control' : 'text-text-dim hover:bg-viewer-control'
                }`}
              >
                {Math.round(viewerZoom * 100)}%
              </button>
              <div className="w-px h-3.5 bg-border" />
              <ZoomBtn
                ariaLabel={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                ariaPressed={isFullscreen}
                active={isFullscreen}
                title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                onClick={() => void toggleFullscreen()}
              >
                {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </ZoomBtn>
            </div>
          </div>
        </div>

        <div className="absolute inset-y-0 right-0 z-10 flex pointer-events-none">
          <div className="pointer-events-auto h-full">
            <EditPanel open={viewerPanel === 'edit'} onFilterChange={setEditFilter} />
          </div>
        </div>
        <InfoPanel imagePath={lightboxImage} faces={faces} open={viewerPanel === 'info'} onFaceClick={openFace} />
      </div>
    </div>
  );
};

const IconButton = ({
  children,
  onClick,
  active,
  ariaLabel,
  ariaPressed,
  title,
  buttonRef,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  ariaLabel: string;
  ariaPressed?: boolean;
  title?: string;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
}) => (
  <button
    ref={buttonRef}
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    aria-pressed={ariaPressed}
    title={title}
    className={`pressable w-9 h-9 rounded-full grid place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
      active
        ? 'bg-accent text-on-accent'
        : 'bg-viewer-control hover:bg-viewer-control-hover text-text'
    }`}
  >
    {children}
  </button>
);

const ZoomBtn = ({
  children,
  onClick,
  ariaLabel,
  ariaPressed,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  ariaPressed?: boolean;
  active?: boolean;
  title?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={ariaLabel}
    aria-pressed={ariaPressed}
    title={title}
    className={`pressable w-[26px] h-[26px] rounded-full grid place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
      active
        ? 'bg-accent text-on-accent'
        : 'bg-viewer-control hover:bg-viewer-control-hover text-text'
    }`}
  >
    {children}
  </button>
);
