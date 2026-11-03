/** @type {import('tailwindcss').Config} */
// dbx-blueprint palette applied in DARK MODE (per STYLE_GUIDE.md dark-mode overrides).
// Legacy class aliases (`navy-*`, `electric*`, `status-*`, `grid-*`) are preserved so
// existing JSX keeps working while visually conforming to Databricks dark-mode tokens.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ─── Blueprint canonical tokens ─────────────────────────────────────
        lava: {
          800: '#801C17', 700: '#BD2B26', 600: '#FF3621',
          500: '#FF5F46', 400: '#FF9E94', 300: '#FABFBA',
          DEFAULT: '#FF3621',
        },
        oat: { light: '#F9F7F4', medium: '#EEEDE9', DEFAULT: '#EEEDE9' },
        success: { 800: '#095A35', 700: '#00875C', 600: '#00A972', 500: '#42BA91', 400: '#70C4AB', 300: '#9ED6C4', DEFAULT: '#00A972' },
        warning: { 800: '#7D5319', 700: '#BA7B23', 600: '#FFAB00', 500: '#FCBA33', 400: '#FFCC66', 300: '#FFDB96', DEFAULT: '#FFAB00' },
        info:    { 800: '#04355D', 700: '#0E538B', 600: '#2272B4', 500: '#4299E0', 400: '#8ACAFF', 300: '#BAE1FC', DEFAULT: '#2272B4' },
        maroon:  { 600: '#98102A', 500: '#AB4057' },

        // ─── Navy family — theme-aware via CSS vars (see index.css). Dark by
        //     default; [data-theme="light"] swaps the role values so the same
        //     classes (bg-navy-900, text-navy-300, …) read correctly in both. ──
        navy: {
          DEFAULT: 'rgb(var(--navy-900) / <alpha-value>)',
          900: 'rgb(var(--navy-900) / <alpha-value>)',   // page bg
          800: 'rgb(var(--navy-800) / <alpha-value>)',   // card bg
          700: 'rgb(var(--navy-700) / <alpha-value>)',   // secondary panel
          600: 'rgb(var(--navy-600) / <alpha-value>)',   // border / dividers
          500: 'rgb(var(--navy-500) / <alpha-value>)',   // muted separator
          400: 'rgb(var(--navy-400) / <alpha-value>)',   // text-secondary
          300: 'rgb(var(--navy-300) / <alpha-value>)',   // body text
        },
        // Theme-aware heading/foreground (white on dark, near-black on light).
        heading: 'rgb(var(--heading) / <alpha-value>)',

        // ─── Legacy alias: electric → lava ──────────────────────────────────
        electric: {
          DEFAULT: '#FF3621',
          300: '#FF9E94',
          400: '#FF5F46',
          500: '#FF3621',
          600: '#BD2B26',
        },
        // ─── Legacy alias: status → functional ──────────────────────────────
        status: { green: '#00A972', yellow: '#FFAB00', red: '#FF3621' },
        // ─── Legacy alias: grid → functional ────────────────────────────────
        grid:   { orange: '#FFAB00', red: '#FF3621' },
        // ─── Phase colors (shared across extended palette) ─────────────────
        phase: {
          0: '#618794', // navy-500, pre-foundation
          1: '#2272B4', // info-600
          2: '#00A972', // success-600
          3: '#FFAB00', // warning-600
          4: '#98102A', // maroon-600 (AI transformation)
        },
      },
      fontFamily: {
        // System font stacks: the app loads nothing from outside the workspace.
        sans: ['"DM Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['"DM Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { card: '8px', btn: '4px' },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.3)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.4)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'scale-in': 'scaleIn 0.4s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(16px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        scaleIn: { '0%': { opacity: '0', transform: 'scale(0.95)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
      },
    },
  },
  plugins: [],
};
