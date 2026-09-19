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
        text: 'var(--ss-text)',
        'text-dim': 'var(--ss-text-dim)',
        'text-mute': 'var(--ss-text-mute)',
        success: 'var(--ss-success)',
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
      },
      transitionTimingFunction: {
        apple: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      transitionDuration: {
        '250': '250ms',
      },
    },
  },
  plugins: [],
}
