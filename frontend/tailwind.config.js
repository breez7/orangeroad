/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Orange Road theme colors (Phase 5.1 — keep originals + add muted
        // complementary blue `accent` so dark UI panels can break out of a
        // pure-orange monochrome).
        'orange-primary': '#FF6B35',
        'orange-secondary': '#F7931E',
        'orange-dark': '#E85D04',
        // Muted slate-cyan that reads as a cool counterpart on dark gray.
        // Used for focus rings, secondary highlights, info toasts.
        accent: {
          DEFAULT: '#5EAFC5',
          dark: '#3A8FA8',
          soft: '#7CC2D6',
        },
      },
      fontFamily: {
        // Phase 5.1 — Noto Sans KR first for Korean glyph quality on
        // Raspberry Pi (which may lack a system Korean font); fall back to
        // a system-ui chain everywhere else.
        sans: [
          '"Noto Sans KR"',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.65' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-4px)' },
          '40%, 80%': { transform: 'translateX(4px)' },
        },
        'toast-in': {
          '0%': { transform: 'translateY(-12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
        shake: 'shake 0.4s ease-in-out',
        'toast-in': 'toast-in 0.25s ease-out',
      },
    },
  },
  plugins: [],
}
