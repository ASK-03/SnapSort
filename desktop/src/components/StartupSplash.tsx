import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '../lib/viewTransition';

export const StartupSplash = ({
  backendReady,
  onFinished,
}: {
  backendReady: boolean;
  onFinished: () => void;
}) => {
  const [minAnimDone, setMinAnimDone] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    const delay = prefersReducedMotion() ? 220 : 1050;
    const timer = window.setTimeout(() => setMinAnimDone(true), delay);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!minAnimDone || !backendReady) return;
    setFadingOut(true);
    const doneDelay = prefersReducedMotion() ? 80 : 240;
    const timer = window.setTimeout(onFinished, doneDelay);
    return () => window.clearTimeout(timer);
  }, [minAnimDone, backendReady, onFinished]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Starting SnapSort"
      className={`fixed inset-0 z-[80] bg-bg text-text flex flex-col items-center justify-center gap-5 select-none transition-opacity duration-240 ease-out-ui motion-reduce:transition-none ${
        fadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="ss-splash-mark flex items-center gap-4">
        <svg
          className="w-20 h-20 overflow-visible shrink-0"
          viewBox="0 0 347 360"
          width="80"
          height="80"
          aria-hidden="true"
        >
          <g className="ss-splash-blue">
            <path
              fill="#0863EF"
              d="M47 148 H107 Q111 148 111 152 V222 Q111 234 123 234 H177 Q181 234 181 238 V301 Q181 305 177 305 H57 Q43 305 43 291 V152 Q43 148 47 148 Z"
            />
          </g>
          <g className="ss-splash-orange">
            <path fill="#FE8E1E" d="M156 35 H289 Q299 35 299 45 L156 187 Z" />
          </g>
          <g className="ss-splash-amber">
            <path fill="#FDAB19" d="M299 45 V183 Q299 187 295 187 H156 Z" />
          </g>
          <g className="ss-splash-coral">
            <path fill="#F15034" d="M156 146 H43 A113 111 0 0 1 156 35 Z" />
          </g>
          <g className="ss-splash-green">
            <circle fill="#0BB178" cx="241.5" cy="247.5" r="58.5" />
          </g>
        </svg>

        <div className="ss-splash-word text-4xl font-bold tracking-tight text-text pr-1">
          SnapSort
        </div>
      </div>

      <p
        className={`text-xs font-medium text-text-mute transition-opacity duration-200 motion-reduce:transition-none ${
          minAnimDone && !backendReady ? 'opacity-100' : 'opacity-0'
        }`}
      >
        Starting local engine...
      </p>
    </div>
  );
};
