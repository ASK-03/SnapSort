export const LIGHTBOX_ROOT_VT = 'lightbox-root';
export const VIEWER_IMAGE_VT = 'viewer-image';

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const withViewTransition = (fn: () => void, skip = false) => {
  if (!skip && !prefersReducedMotion() && typeof document !== 'undefined' && 'startViewTransition' in document) {
    document.startViewTransition(fn);
  } else {
    fn();
  }
};
