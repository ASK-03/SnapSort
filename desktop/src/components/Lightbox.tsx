import { useAppStore } from '../store';
import {
  api,
  getFaceThumbnailUrl,
  getImageUrl,
  getImages,
  getPreviewUrl,
  getStats,
  saveEditedImage,
} from '../api';
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crop,
  Info,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LIGHTBOX_ROOT_VT, VIEWER_IMAGE_VT, withViewTransition } from '../lib/viewTransition';
import {
  FILTER_PRESETS,
  computeCssFilter,
  computeCssTransform,
  createDefaultEditState,
  hasCustomCrop,
  isEditDirty,
  type CropRect,
  type EditState,
  type EditTool,
} from '../lib/editor';
import { InfoPanel } from './InfoPanel';
import { EditPanel } from './EditPanel';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

const EDITOR_TABS: { id: EditTool; label: string }[] = [
  { id: 'crop', label: 'Crop' },
  { id: 'adjust', label: 'Adjust' },
  { id: 'filters', label: 'Filters' },
  { id: 'rotate', label: 'Rotate' },
];

type CropDragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

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

function updateCropRect(
  start: CropRect,
  mode: CropDragMode,
  dx: number,
  dy: number,
): CropRect {
  const minSize = 0.12;
  let { x, y, w, h } = start;
  if (mode === 'move') {
    x = Math.max(0, Math.min(1 - w, x + dx));
    y = Math.max(0, Math.min(1 - h, y + dy));
    return { x, y, w, h };
  }
  if (mode === 'nw' || mode === 'sw') {
    const nextX = Math.max(0, Math.min(start.x + start.w - minSize, start.x + dx));
    w = start.w + (start.x - nextX);
    x = nextX;
  }
  if (mode === 'ne' || mode === 'se') {
    w = Math.max(minSize, Math.min(1 - start.x, start.w + dx));
  }
  if (mode === 'nw' || mode === 'ne') {
    const nextY = Math.max(0, Math.min(start.y + start.h - minSize, start.y + dy));
    h = start.h + (start.y - nextY);
    y = nextY;
  }
  if (mode === 'sw' || mode === 'se') {
    h = Math.max(minSize, Math.min(1 - start.y, start.h + dy));
  }
  return { x, y, w, h };
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
    bumpImageVersion,
    setImages,
    setStats,
    images: storeImages,
  } = useAppStore();

  const [faces, setFaces] = useState<{ id: number; name: string | null }[]>([]);
  const [editState, setEditState] = useState<EditState>(createDefaultEditState);
  const [saveMode, setSaveMode] = useState<'copy' | 'replace'>('copy');
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imageAspect, setImageAspect] = useState(1);

  const rootRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const cropBoxRef = useRef<HTMLDivElement>(null);
  const bottomBandRef = useRef<HTMLDivElement>(null);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragState = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const cropDragRef = useRef<{ mode: CropDragMode; clientX: number; clientY: number; rect: CropRect } | null>(null);

  const resetEditor = useCallback(() => {
    setEditState(createDefaultEditState());
    setSaveMode('copy');
    setSaveMenuOpen(false);
    setConfirmReplaceOpen(false);
    setStatusMessage(null);
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    resetEditor();
  }, [lightboxImage, resetEditor]);

  useEffect(() => {
    if (!saveMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target as Node)) {
        setSaveMenuOpen(false);
        setConfirmReplaceOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [saveMenuOpen]);

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
    setSaveMenuOpen(false);
    setConfirmReplaceOpen(false);
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
        if (saveMenuOpen) {
          setSaveMenuOpen(false);
          setConfirmReplaceOpen(false);
          return;
        }
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
  }, [lightboxImage, viewerPanel, saveMenuOpen, handleNext, handlePrev, close]);

  useEffect(() => {
    if (!lightboxImage) return;
    let cancelled = false;
    api
      .get<{ faces?: { id: number; name: string | null }[] }>('/images/faces', {
        params: { image_path: lightboxImage },
      })
      .then((res) => {
        if (!cancelled) setFaces(res.data.faces || []);
      })
      .catch(() => {
        if (!cancelled) setFaces([]);
      });
    return () => {
      cancelled = true;
    };
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

  const startCropDrag = (mode: CropDragMode, e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    cropDragRef.current = {
      mode,
      clientX: e.clientX,
      clientY: e.clientY,
      rect: { ...editState.crop },
    };
  };

  const moveCropDrag = (e: React.PointerEvent) => {
    if (!cropDragRef.current || !cropBoxRef.current) return;
    e.stopPropagation();
    const bounds = cropBoxRef.current.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dx = (e.clientX - cropDragRef.current.clientX) / bounds.width;
    const dy = (e.clientY - cropDragRef.current.clientY) / bounds.height;
    const dragMode = cropDragRef.current.mode;
    const nextCrop = updateCropRect(cropDragRef.current.rect, dragMode, dx, dy);
    setEditState((prev) => ({
      ...prev,
      aspect: dragMode === 'move' ? prev.aspect : 'free',
      crop: nextCrop,
    }));
  };

  const endCropDrag = () => {
    cropDragRef.current = null;
  };

  const executeSave = async (mode: 'copy' | 'replace') => {
    if (!lightboxImage || isSaving) return;
    setIsSaving(true);
    setSaveMode(mode);
    setErrorMessage(null);
    setStatusMessage(null);
    setSaveMenuOpen(false);
    setConfirmReplaceOpen(false);

    try {
      const res = await saveEditedImage({
        source_path: lightboxImage,
        mode,
        crop: hasCustomCrop(editState.crop) ? editState.crop : null,
        rotate_deg: editState.rotateDeg,
        flip_h: editState.flipH,
        flip_v: editState.flipV,
        straighten_deg: editState.straightenDeg,
        filter_preset: editState.filterPreset,
        adjustments: editState.adjustments,
      });

      bumpImageVersion(res.saved_path);
      if (mode === 'copy') {
        const nextLimit = Math.max(storeImages.length + 1, 200);
        const [refreshedImages, refreshedStats] = await Promise.all([
          getImages(0, nextLimit).catch(() => [res.saved_path, ...storeImages]),
          getStats().catch(() => null),
        ]);
        const nextList: string[] = refreshedImages.includes(res.saved_path)
          ? refreshedImages
          : [res.saved_path, ...refreshedImages];
        setImages(nextList);
        if (refreshedStats) setStats(refreshedStats);

        const nextPaths = images.includes(res.saved_path)
          ? images
          : [res.saved_path, ...images];
        setEditState(createDefaultEditState());
        setLightboxImage(res.saved_path, nextPaths);
        setStatusMessage(`Saved copy: ${res.saved_path.split(/[\\/]/).pop()}`);
      } else {
        bumpImageVersion(lightboxImage);
        const refreshedStats = await getStats().catch(() => null);
        if (refreshedStats) setStats(refreshedStats);
        setEditState(createDefaultEditState());
        setStatusMessage('Original photo updated on disk.');
      }
    } catch {
      setErrorMessage('Could not save edited photo. Try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!lightboxImage) return null;

  const idx = images.indexOf(lightboxImage);
  const hasNext = idx >= 0 && idx < images.length - 1;
  const hasPrev = idx > 0;
  const filename = lightboxImage.split(/[\\/]/).pop() || 'Unknown';
  const ver = imageVersions[lightboxImage];
  const imgSrc = ver ? `${getImageUrl(lightboxImage)}&v=${ver}` : getImageUrl(lightboxImage);
  const previewSrc = ver ? `${getPreviewUrl(lightboxImage)}&v=${ver}` : getPreviewUrl(lightboxImage);
  const rightReserve = viewerPanel !== 'none' ? 'md:right-[320px]' : '';
  const dirty = isEditDirty(editState);

  const activeCssFilter = viewerPanel === 'edit'
    ? computeCssFilter(editState.filterPreset, editState.adjustments)
    : 'none';

  const zoomTransform = viewerZoom > 1 ? `translate(${viewerPan.x}px, ${viewerPan.y}px) scale(${viewerZoom})` : undefined;
  const editTransform = viewerPanel === 'edit' ? computeCssTransform(editState) : undefined;
  const combinedTransform = zoomTransform && editTransform
    ? `${zoomTransform} ${editTransform}`
    : (zoomTransform || editTransform);

  const activePresetLabel = FILTER_PRESETS.find((p) => p.id === editState.filterPreset)?.label || 'Original';
  const showCropFrame = viewerPanel === 'edit' && viewerZoom <= 1 && (editState.tool === 'crop' || hasCustomCrop(editState.crop));

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo viewer: ${filename}`}
      className={`fixed inset-0 bg-viewer-bg text-text overflow-hidden flex flex-col ${isFullscreen ? 'z-[70]' : 'z-50'}`}
      style={{ viewTransitionName: LIGHTBOX_ROOT_VT }}
    >
      {/* z-30 keeps viewer header and Save dropdown strictly above z-10 right sidebar drawers */}
      <header className="window-drag relative z-30 h-14 shrink-0 bg-viewer-header border-b border-border grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5">
        <div className="flex items-center gap-3">
          <IconButton
            buttonRef={closeBtnRef}
            onClick={close}
            ariaLabel="Close viewer"
            title="Close (Escape)"
          >
            <X size={16} />
          </IconButton>
          {viewerPanel === 'edit' && (
            <span className="text-sm font-semibold text-text hidden sm:inline">Edit</span>
          )}
        </div>

        {viewerPanel === 'edit' ? (
          <div className="flex items-center bg-viewer-control border border-border rounded-full p-0.5 gap-0.5">
            {EDITOR_TABS.map((tab) => {
              const active = editState.tool === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setEditState((prev) => ({ ...prev, tool: tab.id }))}
                  className={`pressable inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    active
                      ? 'bg-viewer-tab-active text-text shadow-sm'
                      : 'text-text-dim hover:text-text'
                  }`}
                >
                  {tab.id === 'crop' && <Crop size={13} />}
                  {tab.id === 'adjust' && <SlidersHorizontal size={13} />}
                  {tab.id === 'filters' && <Sparkles size={13} />}
                  {tab.id === 'rotate' && <RotateCw size={13} />}
                  <span className="hidden md:inline">{tab.label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="min-w-0 flex flex-col items-center justify-center gap-0.5">
            <span className="max-w-[42vw] truncate text-[13px] font-semibold text-text">{filename}</span>
            {(hasPrev || hasNext) && (
              <span className="text-xs text-text-mute tabular-nums">{`${idx + 1} of ${images.length}`}</span>
            )}
          </div>
        )}

        <div className="justify-self-end flex items-center gap-2">
          {viewerPanel === 'edit' && (
            <div ref={saveMenuRef} className="relative">
              <div className="inline-flex items-center rounded-full shadow-sm">
                <button
                  type="button"
                  disabled={isSaving || !dirty}
                  onClick={() => {
                    if (saveMode === 'replace') {
                      setSaveMenuOpen(true);
                      setConfirmReplaceOpen(true);
                    } else {
                      void executeSave('copy');
                    }
                  }}
                  className={`pressable h-8 pl-3.5 pr-2.5 rounded-l-full text-xs font-semibold disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    saveMode === 'replace'
                      ? 'bg-danger text-on-danger'
                      : 'bg-accent text-on-accent'
                  }`}
                >
                  {isSaving ? 'Saving...' : saveMode === 'replace' ? 'Replace Original' : 'Save as Copy'}
                </button>
                <span className="w-px h-5 bg-white/25" aria-hidden="true" />
                <button
                  type="button"
                  disabled={isSaving}
                  aria-label="Choose save mode"
                  aria-expanded={saveMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setSaveMenuOpen((prev) => !prev)}
                  className={`pressable h-8 pl-1.5 pr-2.5 rounded-r-full disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    saveMode === 'replace'
                      ? 'bg-danger text-on-danger'
                      : 'bg-accent text-on-accent'
                  }`}
                >
                  <ChevronDown size={13} />
                </button>
              </div>

              {saveMenuOpen && (
                <div
                  role="menu"
                  aria-label="Save options"
                  className="save-dropdown absolute right-0 top-full mt-2 w-72 rounded-xl bg-surface border border-border shadow-2xl p-1.5 z-50 text-left"
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!dirty}
                    onClick={() => void executeSave('copy')}
                    className="pressable w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg hover:bg-surface-hi disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Copy size={15} className="text-text-dim mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-text">Save as Copy</div>
                      <div className="text-[11px] text-text-mute">Keeps the original file untouched</div>
                    </div>
                  </button>

                  {!confirmReplaceOpen ? (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!dirty}
                      onClick={() => setConfirmReplaceOpen(true)}
                      className="pressable w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg hover:bg-surface-hi disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <AlertTriangle size={15} className="text-danger mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-danger">Replace Original</div>
                        <div className="text-[11px] text-text-mute">Overwrites original file on disk</div>
                      </div>
                    </button>
                  ) : (
                    <div className="mt-1 rounded-lg bg-surface-hi border border-border p-2.5 space-y-2">
                      <p className="text-[11px] text-text leading-snug">
                        Overwrite <span className="font-semibold">{filename}</span> on disk?
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmReplaceOpen(false)}
                          className="pressable flex-1 py-1.5 rounded-md text-xs font-medium bg-surface border border-border text-text hover:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void executeSave('replace')}
                          className="pressable flex-1 py-1.5 rounded-md text-xs font-semibold bg-danger text-on-danger hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          Confirm Replace
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
              <div
                ref={cropBoxRef}
                className={`relative inline-flex items-center justify-center overflow-hidden rounded-[10px] ${
                  viewerZoom > 1 ? 'w-full h-full' : 'max-w-full max-h-full'
                }`}
              >
                <img
                  ref={imgRef}
                  src={imgSrc}
                  alt={filename}
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    if (el.naturalWidth && el.naturalHeight) {
                      setImageAspect(el.naturalWidth / el.naturalHeight);
                    }
                  }}
                  className={`block select-none shadow-[0_0_0_1px_var(--ss-img-outline)] ${
                    viewerZoom > 1 ? 'w-full h-full object-contain' : 'max-w-full max-h-full w-auto h-auto object-contain rounded-[10px]'
                  }`}
                  draggable={false}
                  style={{
                    imageOrientation: 'from-image',
                    filter: activeCssFilter,
                    transformOrigin: viewerZoom > 1 ? '0 0' : 'center center',
                    transform: combinedTransform,
                  }}
                />

                {viewerPanel === 'edit' && editState.filterPreset !== 'original' && (
                  <span className="pointer-events-none absolute top-3 left-3 z-20 px-2.5 py-1 rounded-full bg-black/70 text-white text-xs font-medium">
                    {activePresetLabel}
                  </span>
                )}

                {viewerPanel === 'edit' && (
                  <span className="pointer-events-none absolute bottom-3 right-3 z-20 px-2.5 py-1 rounded-full bg-black/70 text-white text-xs font-medium">
                    {saveMode === 'replace' ? 'Original replaced' : 'Original kept'}
                  </span>
                )}

                {showCropFrame && (
                  <div
                    role="region"
                    aria-label="Crop frame"
                    onPointerDown={(e) => startCropDrag('move', e)}
                    onPointerMove={moveCropDrag}
                    onPointerUp={endCropDrag}
                    onPointerCancel={endCropDrag}
                    className={`absolute z-10 border border-white/90 ${editState.tool === 'crop' ? 'cursor-move' : 'pointer-events-none'}`}
                    style={{
                      left: `${editState.crop.x * 100}%`,
                      top: `${editState.crop.y * 100}%`,
                      width: `${editState.crop.w * 100}%`,
                      height: `${editState.crop.h * 100}%`,
                      boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
                    }}
                  >
                    <span className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/35" aria-hidden="true" />
                    <span className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/35" aria-hidden="true" />
                    <span className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/35" aria-hidden="true" />
                    <span className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/35" aria-hidden="true" />

                    {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                      <button
                        key={corner}
                        type="button"
                        aria-label={`Resize ${corner} crop handle`}
                        onPointerDown={(e) => startCropDrag(corner, e)}
                        onPointerMove={moveCropDrag}
                        onPointerUp={endCropDrag}
                        onPointerCancel={endCropDrag}
                        className={`absolute w-5 h-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                          corner === 'nw'
                            ? '-top-1 -left-1 border-t-[3px] border-l-[3px] border-white cursor-nwse-resize'
                            : corner === 'ne'
                              ? '-top-1 -right-1 border-t-[3px] border-r-[3px] border-white cursor-nesw-resize'
                              : corner === 'sw'
                                ? '-bottom-1 -left-1 border-b-[3px] border-l-[3px] border-white cursor-nesw-resize'
                                : '-bottom-1 -right-1 border-b-[3px] border-r-[3px] border-white cursor-nwse-resize'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
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
            {viewerPanel === 'edit' && editState.tool === 'filters' ? (
              <div className="flex items-center gap-3 overflow-x-auto max-w-full py-1 px-2">
                {FILTER_PRESETS.map((preset) => {
                  const active = editState.filterPreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setEditState((prev) => ({ ...prev, filterPreset: preset.id }))}
                      className="pressable flex flex-col items-center gap-1.5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
                    >
                      <div
                        className={`w-16 h-12 rounded-lg overflow-hidden border-2 bg-surface ${
                          active ? 'border-accent ring-2 ring-accent/40' : 'border-border'
                        }`}
                      >
                        <img
                          src={previewSrc}
                          alt={preset.label}
                          className="w-full h-full object-cover"
                          style={{ filter: computeCssFilter(preset.id, editState.adjustments) }}
                        />
                      </div>
                      <span className={`text-[11px] font-medium ${active ? 'text-text font-semibold' : 'text-text-dim'}`}>
                        {preset.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>

        <div className="absolute inset-y-0 right-0 z-10 flex pointer-events-none">
          <div className="pointer-events-auto h-full">
            <EditPanel
              open={viewerPanel === 'edit'}
              state={editState}
              saveMode={saveMode}
              imageAspect={imageAspect}
              isSaving={isSaving}
              statusMessage={statusMessage}
              errorMessage={errorMessage}
              onChange={setEditState}
              onResetAll={resetEditor}
              onCancel={() => {
                resetEditor();
                setViewerPanel('none');
              }}
              onSaveCopy={() => void executeSave('copy')}
            />
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
