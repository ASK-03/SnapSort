import { useAppStore } from '../store';
import { getImageUrl } from '../api';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useCallback } from 'react';

export const Lightbox = () => {
  const { lightboxImage, setLightboxImage, images } = useAppStore();

  const handleNext = useCallback(() => {
    if (!lightboxImage || !images.length) return;
    const idx = images.indexOf(lightboxImage);
    if (idx >= 0 && idx < images.length - 1) {
      setLightboxImage(images[idx + 1]);
    }
  }, [lightboxImage, images, setLightboxImage]);

  const handlePrev = useCallback(() => {
    if (!lightboxImage || !images.length) return;
    const idx = images.indexOf(lightboxImage);
    if (idx > 0) {
      setLightboxImage(images[idx - 1]);
    }
  }, [lightboxImage, images, setLightboxImage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxImage(null);
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft') handlePrev();
    };
    if (lightboxImage) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxImage, handleNext, handlePrev, setLightboxImage]);

  if (!lightboxImage) return null;

  const idx = images.indexOf(lightboxImage);
  const hasNext = idx >= 0 && idx < images.length - 1;
  const hasPrev = idx > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center p-8">
      <button 
        onClick={() => setLightboxImage(null)}
        className="absolute top-6 right-6 p-2 bg-slate-800/80 hover:bg-slate-700 rounded-full text-white transition-colors"
      >
        <X size={24} />
      </button>
      
      {hasPrev && (
        <button 
          onClick={handlePrev}
          className="absolute left-6 top-1/2 -translate-y-1/2 p-3 bg-slate-800/80 hover:bg-slate-700 rounded-full text-white transition-colors"
        >
          <ChevronLeft size={32} />
        </button>
      )}

      <img 
        src={getImageUrl(lightboxImage)} 
        alt="Fullscreen view" 
        className="max-w-full max-h-full object-contain select-none"
        style={{ imageOrientation: 'from-image' } as any}
      />

      {hasNext && (
        <button 
          onClick={handleNext}
          className="absolute right-6 top-1/2 -translate-y-1/2 p-3 bg-slate-800/80 hover:bg-slate-700 rounded-full text-white transition-colors"
        >
          <ChevronRight size={32} />
        </button>
      )}
    </div>
  );
};
