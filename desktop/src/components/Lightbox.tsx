import { useAppStore } from '../store';
import { getImageUrl, api } from '../api';
import { X, ChevronLeft, ChevronRight, Heart, Info, Pencil, MoreHorizontal, Minus, Plus, Maximize2 } from 'lucide-react';
import { useEffect, useCallback, useState } from 'react';
import { vtName, withViewTransition } from '../lib/viewTransition';
import { InfoPanel } from './InfoPanel';
import { EditPanel } from './EditPanel';

export const Lightbox = () => {
  const { lightboxImage, setLightboxImage, images, viewerPanel, setViewerPanel, viewerZoom, setViewerZoom } = useAppStore();
  const [faces, setFaces] = useState<{ id: number; name: string | null }[]>([]);
  const [editFilter, setEditFilter] = useState('none');

  const goTo = useCallback((path: string) => withViewTransition(() => setLightboxImage(path)), [setLightboxImage]);

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
    setLightboxImage(null);
    setViewerPanel('none');
    setViewerZoom(1);
  }, [setLightboxImage, setViewerPanel, setViewerZoom]);

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
    setViewerZoom(1);
    api.get(`/images/faces?image_path=${encodeURIComponent(lightboxImage)}`)
      .then((res) => setFaces(res.data.faces || []))
      .catch(() => setFaces([]));
  }, [lightboxImage]);

  if (!lightboxImage) return null;

  const idx = images.indexOf(lightboxImage);
  const hasNext = idx >= 0 && idx < images.length - 1;
  const hasPrev = idx > 0;
  const filename = lightboxImage.split(/[\\/]/).pop() || 'Unknown';
  const panelOpen = viewerPanel !== 'none';

  return (
    <div className="fixed inset-0 z-50 bg-[#0A0B0C] text-white overflow-hidden flex flex-col">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 px-7 py-5 flex items-center justify-between bg-gradient-to-b from-black/55 to-transparent">
        <IconButton onClick={close}><X size={16} /></IconButton>

        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[13px] font-semibold">{filename}</span>
          <span className="text-[11.5px] text-white/55">{hasPrev || hasNext ? `${idx + 1} of ${images.length}` : ''}</span>
        </div>

        <div className="flex items-center gap-2">
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
        {viewerPanel === 'edit' && <EditPanel onFilterChange={setEditFilter} />}

        {/* Image area */}
        <div className="flex-1 relative flex items-center justify-center min-w-0">
          {!panelOpen && hasPrev && (
            <button onClick={handlePrev} className="absolute left-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/6 hover:bg-white/12 flex items-center justify-center transition-colors duration-250 ease-apple">
              <ChevronLeft size={18} />
            </button>
          )}

          <img
            src={getImageUrl(lightboxImage)}
            alt="Fullscreen view"
            className="max-w-[85%] max-h-[78%] object-contain select-none transition-transform duration-250 ease-apple"
            style={{
              imageOrientation: 'from-image',
              viewTransitionName: vtName(lightboxImage),
              filter: editFilter,
              transform: `scale(${viewerZoom})`,
            } as any}
          />

          {!panelOpen && hasNext && (
            <button onClick={handleNext} className="absolute right-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/6 hover:bg-white/12 flex items-center justify-center transition-colors duration-250 ease-apple">
              <ChevronRight size={18} />
            </button>
          )}

          {/* Zoom control */}
          <div className="absolute bottom-7 left-1/2 -translate-x-1/2 flex items-center gap-2.5 bg-[#1E2023] border border-white/10 rounded-full px-2 py-1.5">
            <ZoomBtn onClick={() => setViewerZoom(Math.max(0.5, +(viewerZoom - 0.2).toFixed(2)))}><Minus size={13} /></ZoomBtn>
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.1}
              value={viewerZoom}
              onChange={(e) => setViewerZoom(Number(e.target.value))}
              className="w-24 accent-accent cursor-pointer"
            />
            <ZoomBtn onClick={() => setViewerZoom(Math.min(3, +(viewerZoom + 0.2).toFixed(2)))}><Plus size={14} /></ZoomBtn>
            <span className="text-[11.5px] text-white/55 w-9 text-center">{Math.round(viewerZoom * 100)}%</span>
            <div className="w-px h-4 bg-white/10" />
            <ZoomBtn onClick={() => setViewerZoom(1)}><Maximize2 size={13} /></ZoomBtn>
          </div>

          {/* Faces strip — default state only */}
          {!panelOpen && faces.length > 0 && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2.5">
              <span className="text-[11.5px] text-white/55">{faces.length} face{faces.length > 1 ? 's' : ''} detected</span>
              <div className="flex items-center gap-2.5">
                {faces.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 bg-white/7 border border-white/12 rounded-full pl-1 pr-3 py-1">
                    <div className="w-[26px] h-[26px] rounded-full bg-white/15 overflow-hidden" />
                    <span className="text-[12.5px] font-semibold">{f.name || 'Unknown'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {viewerPanel === 'info' && <InfoPanel imagePath={lightboxImage} faces={faces} open />}
      </div>
    </div>
  );
};

const IconButton = ({ children, onClick, active, disabled, title }: { children: React.ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean; title?: string }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors duration-250 ease-apple ${
      active ? 'bg-accent text-[#141517]' : disabled ? 'bg-white/8 text-white/25 cursor-not-allowed' : 'bg-white/8 hover:bg-white/15 text-white'
    }`}
  >
    {children}
  </button>
);

const ZoomBtn = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
  <button onClick={onClick} className="w-[26px] h-[26px] rounded-full bg-white/6 hover:bg-white/15 flex items-center justify-center transition-colors duration-250 ease-apple">
    {children}
  </button>
);
