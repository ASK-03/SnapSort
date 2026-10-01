import { useAppStore } from '../store';
import { getImageUrl, getFaceThumbnailUrl, api } from '../api';
import { X, ChevronLeft, ChevronRight, Heart, Info, Pencil, MoreHorizontal, Minus, Plus, Maximize2 } from 'lucide-react';
import { useEffect, useCallback, useState, useRef } from 'react';
import { LIGHTBOX_ROOT_VT, VIEWER_IMAGE_VT, withViewTransition } from '../lib/viewTransition';
import { InfoPanel } from './InfoPanel';
import { EditPanel } from './EditPanel';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

// Clamps pan so the scaled PHOTO PIXELS (not the img's letterboxed layout
// box) always cover the viewport — no black backdrop can be dragged into
// view. While zoomed the img box equals the viewport box (w-full h-full),
// so the photo sits at an object-contain inset inside it; that inset is
// what makes the bounds differ from a naive `t ∈ [w(1-s), 0]`. If the
// scaled photo is still narrower than the viewport on an axis, it's
// centered on that axis instead (pan locked there).
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
  const { lightboxImage, setLightboxImage, images, viewerPanel, setViewerPanel, viewerZoom, setViewerZoom, viewerPan, setViewerPan, setSelectedPerson, setViewMode } = useAppStore();
  const [faces, setFaces] = useState<{ id: number; name: string | null }[]>([]);
  const [editFilter, setEditFilter] = useState('none');
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragState = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // Zoom toward a point `c` (client px, relative to the viewport wrapper) so the
  // content under the cursor/pinch-center stays put as scale changes — the
  // standard "zoom at cursor" transform. transform-origin is 0 0 (top-left) so
  // this is a plain translate; with the default `center` origin the algebra
  // needs the box size too and gets error-prone.
  const zoomAt = useCallback((newScale: number, c: { x: number; y: number }) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +newScale.toFixed(3)));
    useAppStore.setState((s) => {
      const nx = c.x - (clamped / s.viewerZoom) * (c.x - s.viewerPan.x);
      const ny = c.y - (clamped / s.viewerZoom) * (c.y - s.viewerPan.y);
      return { viewerZoom: clamped, viewerPan: clampPan({ x: nx, y: ny }, clamped, viewportRef.current, imgRef.current) };
    });
  }, []);

  const zoomAtCenter = useCallback((newScale: number) => {
    const el = viewportRef.current;
    const c = el ? { x: el.offsetWidth / 2, y: el.offsetHeight / 2 } : { x: 0, y: 0 };
    zoomAt(newScale, c);
  }, [zoomAt]);

  const goTo = useCallback((path: string) => withViewTransition(() => {
    setLightboxImage(path);
    setViewerZoom(1);
    setViewerPan({ x: 0, y: 0 });
  }), [setLightboxImage, setViewerZoom, setViewerPan]);

  const handleNext = useCallback(() => {
    if (!lightboxImage || !images.length) return;
    const idx = images.indexOf(lightboxImage);
    if (idx >= 0 && idx < images.length - 1) goTo(images[idx + 1]);
  }, [lightboxImage, images, goTo]);

  const handlePrev = useCallback(() => {
    if (!lightboxImage || !images.length) return;
    const idx = images.indexOf(lightboxImage);
    if (idx > 0) goTo(images[idx - 1]);
  }, [lightboxImage, images, goTo]);

  const close = useCallback(() => {
    withViewTransition(() => {
      setLightboxImage(null);
      setViewerPanel('none');
      setViewerZoom(1);
      setViewerPan({ x: 0, y: 0 });
    });
  }, [setLightboxImage, setViewerPanel, setViewerZoom, setViewerPan]);

  // Jump to this person's page in the People tab.
  const openFace = useCallback((f: { id: number; name: string | null }) => {
    setSelectedPerson({ id: f.id, name: f.name || `Person ${f.id}` });
    setViewMode('people');
    close();
  }, [close, setSelectedPerson, setViewMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (viewerPanel === 'none') {
        if (e.key === 'ArrowRight') handleNext();
        if (e.key === 'ArrowLeft') handlePrev();
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

  // React's onWheel is passive — e.preventDefault() silently no-ops there.
  // Needs a real DOM listener with { passive: false } so scroll-to-zoom
  // doesn't also scroll the page and doesn't trigger Chromium's ctrl+wheel
  // page-zoom (trackpad pinch also arrives as a ctrl+wheel event).
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

  const onPointerUp = useCallback(() => { dragState.current = null; }, []);

  if (!lightboxImage) return null;

  const idx = images.indexOf(lightboxImage);
  const hasNext = idx >= 0 && idx < images.length - 1;
  const hasPrev = idx > 0;
  const filename = lightboxImage.split(/[\\/]/).pop() || 'Unknown';
  const panelOpen = viewerPanel !== 'none';

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0A0B0C] text-white overflow-hidden flex flex-col"
      style={{ viewTransitionName: LIGHTBOX_ROOT_VT } as any}
    >
      {/* Top bar — close/filename/icons are each independently positioned
          (not flex siblings) because the close button and icon group have
          different widths; a flex-1 middle column centers within whatever
          space is LEFT OVER between them, not the true viewport center. */}
      <div className="absolute top-0 left-0 right-0 z-10 h-[76px] bg-gradient-to-b from-black/55 to-transparent">
        {/* Positioned to its own center-of-64px column (matching the edit
            rail's width below) rather than the bar's own padding, so it
            stays aligned with the rail's icon column when open. */}
        <IconButton onClick={close} className="absolute left-[14px] top-5"><X size={16} /></IconButton>

        <div className="absolute left-1/2 top-5 -translate-x-1/2 flex flex-col items-center gap-0.5">
          <span className="text-[13px] font-semibold">{filename}</span>
          <span className="text-[11.5px] text-white/55">{hasPrev || hasNext ? `${idx + 1} of ${images.length}` : ''}</span>
        </div>

        <div className="absolute right-7 top-5 flex items-center gap-2">
          <IconButton disabled title="Coming soon"><Heart size={16} /></IconButton>
          <IconButton active={viewerPanel === 'edit'} onClick={() => setViewerPanel(viewerPanel === 'edit' ? 'none' : 'edit')}>
            <Pencil size={16} />
          </IconButton>
          <IconButton active={viewerPanel === 'info'} onClick={() => setViewerPanel(viewerPanel === 'info' ? 'none' : 'info')}>
            <Info size={16} />
          </IconButton>
          <IconButton disabled title="Coming soon"><MoreHorizontal size={16} /></IconButton>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <EditPanel open={viewerPanel === 'edit'} onFilterChange={setEditFilter} />

        {/* Image area: an image slot and a separate bottom control band, so
            the two can never overlap. Before, the faces strip and zoom
            control were pinned at fixed distances from the viewer's own
            bottom edge (bottom-24 / bottom-7) inside the SAME box as the
            image — for a tall/portrait photo using its full max-height,
            that put them ON TOP of the bottom of the photo instead of below
            it. Giving the control band its own reserved space below the
            slot makes the non-overlap a layout guarantee, not a guess. */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 relative flex items-center justify-center min-h-0">
            {hasPrev && (
              <button
                onClick={handlePrev}
                className={`absolute left-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/6 hover:bg-white/12 flex items-center justify-center transition-all duration-320 ease-apple ${
                  panelOpen ? 'opacity-0 pointer-events-none -translate-x-2' : 'opacity-100'
                }`}
              >
                <ChevronLeft size={18} />
              </button>
            )}

            {/* This is the pan/zoom VIEWPORT — the whole 85%/92% slot, not a
                box shrink-wrapped to the photo. The transition name lives
                here on a constant-size box so two consecutive same-ratio
                photos don't produce identical before/after geometry (which
                the browser treats as "nothing to animate," skipping the
                crossfade). At rest (zoom 1) the <img> shrink-wraps to the
                photo's fitted size (max-w/max-h) with no transform, so its
                border-radius hugs the actual photo edges — the "card" look.
                border-radius clips the element's LAYOUT box, so a w-full
                h-full img with object-contain rounds the invisible slot
                corners, not the letterboxed pixels inside. Past 100% the
                <img> switches to w-full h-full so its box equals the
                viewport box — transform-origin: 0 0 must sit at the
                viewport corner or cursor-anchored zoom drifts by the
                letterbox gap — and the radius moves to this never-
                transformed viewport (Chromium seams when border-radius and
                a scaled layer share an element). Same DOM node either way,
                just a class toggle, so no remount/reload at the switch. */}
            <div
              ref={viewportRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className={`max-w-[85%] max-h-[92%] w-full h-full flex items-center justify-center overflow-hidden ${viewerZoom > 1 ? 'rounded-[18px] cursor-grab active:cursor-grabbing' : ''}`}
              style={{ viewTransitionName: VIEWER_IMAGE_VT } as any}
            >
              <img
                ref={imgRef}
                src={getImageUrl(lightboxImage)}
                alt="Fullscreen view"
                // No transition on transform: this is a continuously-dragged
                // zoom/pan control (wheel + drag), and easing a value the
                // user is actively scrubbing makes it visibly lag behind
                // the pointer.
                className={`block object-contain select-none ${
                  viewerZoom > 1 ? 'w-full h-full' : 'max-w-full max-h-full rounded-[18px]'
                }`}
                draggable={false}
                style={{
                  imageOrientation: 'from-image',
                  filter: editFilter,
                  transformOrigin: '0 0',
                  transform: viewerZoom > 1 ? `translate(${viewerPan.x}px, ${viewerPan.y}px) scale(${viewerZoom})` : undefined,
                } as any}
              />
            </div>

            {hasNext && (
              <button
                onClick={handleNext}
                className={`absolute right-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/6 hover:bg-white/12 flex items-center justify-center transition-all duration-320 ease-apple ${
                  panelOpen ? 'opacity-0 pointer-events-none translate-x-2' : 'opacity-100'
                }`}
              >
                <ChevronRight size={18} />
              </button>
            )}
          </div>

          {/* Bottom control band — always below the image slot, never over
              it. Also given its own stacking priority (z-10) and the image
              slot above is now clipped to its own bounds (overflow-hidden):
              a zoomed-in image scaling past its slot was painting over the
              zoom control instead of being clipped/staying underneath it. */}
          <div className="relative z-10 flex-shrink-0 flex flex-col items-center gap-3 pb-7 pt-1">
            {faces.length > 0 && (
              <div
                className={`flex flex-col items-center gap-2.5 overflow-hidden transition-all duration-320 ease-apple ${
                  panelOpen ? 'opacity-0 pointer-events-none translate-y-2 h-0' : 'opacity-100'
                }`}
              >
                <span className="text-[11.5px] text-white/55">{faces.length} face{faces.length > 1 ? 's' : ''} detected</span>
                <div className="flex items-center gap-2.5">
                  {faces.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => openFace(f)}
                      title={`Show all photos of ${f.name || 'this person'}`}
                      className="flex items-center gap-2 bg-white/7 hover:bg-white/15 border border-white/12 rounded-full pl-1 pr-3 py-1 transition-colors duration-150"
                    >
                      <img src={getFaceThumbnailUrl(f.id)} className="w-[26px] h-[26px] rounded-full object-cover bg-white/15" alt="" />
                      <span className="text-[12.5px] font-semibold">{f.name || 'Unknown'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2.5 bg-[#1E2023] border border-white/10 rounded-full px-2 py-1.5">
              <ZoomBtn onClick={() => zoomAtCenter(viewerZoom - 0.2)}><Minus size={13} /></ZoomBtn>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.1}
                value={viewerZoom}
                onChange={(e) => zoomAtCenter(Number(e.target.value))}
                className="w-24 accent-accent cursor-pointer"
              />
              <ZoomBtn onClick={() => zoomAtCenter(viewerZoom + 0.2)}><Plus size={14} /></ZoomBtn>
              <span className="text-[11.5px] text-white/55 w-9 text-center">{Math.round(viewerZoom * 100)}%</span>
              <div className="w-px h-4 bg-white/10" />
              <ZoomBtn onClick={() => { setViewerZoom(1); setViewerPan({ x: 0, y: 0 }); }}><Maximize2 size={13} /></ZoomBtn>
            </div>
          </div>
        </div>

        <InfoPanel imagePath={lightboxImage} faces={faces} open={viewerPanel === 'info'} onFaceClick={openFace} />
      </div>
    </div>
  );
};

const IconButton = ({ children, onClick, active, disabled, title, className = '' }: { children: React.ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean; title?: string; className?: string }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors duration-150 ${
      active ? 'bg-accent text-[#141517]' : disabled ? 'bg-white/8 text-white/25 cursor-not-allowed' : 'bg-white/8 hover:bg-white/15 text-white'
    } ${className}`}
  >
    {children}
  </button>
);

const ZoomBtn = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
  <button onClick={onClick} className="w-[26px] h-[26px] rounded-full bg-white/6 hover:bg-white/15 flex items-center justify-center transition-colors duration-150">
    {children}
  </button>
);
