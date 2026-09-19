// Deterministic, CSS-ident-safe view-transition-name shared between the
// Gallery grid card and the Viewer's main image so the browser morphs one
// into the other via document.startViewTransition.
export const vtName = (path: string) => `photo-${path.replace(/[^a-zA-Z0-9]/g, '').slice(-40) || 'x'}`;

export const withViewTransition = (fn: () => void) => {
  if (typeof document !== 'undefined' && 'startViewTransition' in document) {
    // @ts-ignore — experimental API, present in Chromium/Electron
    document.startViewTransition(fn);
  } else {
    fn();
  }
};
