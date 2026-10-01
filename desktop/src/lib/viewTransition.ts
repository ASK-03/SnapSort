// Fixed view-transition-names for the Viewer. The grid thumbnail is a
// low-res, square-cropped preview while the Viewer shows the full-res,
// uncropped image — morphing directly between them (mismatched resolution
// AND aspect ratio) looks pixelated/warped mid-animation. Simpler and more
// reliable: the Viewer fades/scales in as its own named element (its "old"
// counterpart just doesn't exist, so the browser does a plain enter
// animation — see the ::view-transition-new(lightbox-root) rule in
// index.css), and only its own <img> keeps a name across prev/next so THAT
// crossfades cleanly between two full-res sources.
export const LIGHTBOX_ROOT_VT = 'lightbox-root';
export const VIEWER_IMAGE_VT = 'viewer-image';

export const withViewTransition = (fn: () => void) => {
  if (typeof document !== 'undefined' && 'startViewTransition' in document) {
    // @ts-ignore — experimental API, present in Chromium/Electron
    document.startViewTransition(fn);
  } else {
    fn();
  }
};
