/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--ss-bg)',
        surface: 'var(--ss-surface)',
        'surface-hi': 'var(--ss-surface-hi)',
        border: 'var(--ss-border)',
        accent: 'var(--ss-accent)',
        'accent-soft': 'var(--ss-accent-soft)',
        'on-accent': 'var(--ss-on-accent)',
        text: 'var(--ss-text)',
        'text-dim': 'var(--ss-text-dim)',
        'text-mute': 'var(--ss-text-mute)',
        success: 'var(--ss-success)',
        danger: 'var(--ss-danger)',
        'on-danger': 'var(--ss-on-danger)',
        'viewer-bg': 'var(--ss-viewer-bg)',
        'viewer-header': 'var(--ss-viewer-header)',
        'viewer-panel': 'var(--ss-viewer-panel)',
        'viewer-control': 'var(--ss-viewer-control)',
        'viewer-control-hover': 'var(--ss-viewer-control-hover)',
        'viewer-track': 'var(--ss-viewer-track)',
        'viewer-tick': 'var(--ss-viewer-tick)',
        'viewer-tab-active': 'var(--ss-viewer-tab-active)',
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
      },
      transitionTimingFunction: {
        apple: 'cubic-bezier(0.32, 0.72, 0, 1)',
        'out-ui': 'cubic-bezier(0.23, 1, 0.32, 1)',
        drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      transitionDuration: {
        '240': '240ms',
        '250': '250ms',
        '260': '260ms',
      },
    },
  },
  plugins: [],
}
