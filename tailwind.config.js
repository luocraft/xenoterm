/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'var(--color-surface)',
          hover: 'var(--color-surface-hover)',
          active: 'var(--color-surface-active)'
        },
        sidebar: 'var(--color-sidebar)',
        accent: 'var(--color-accent)'
      },
      transitionDuration: {
        DEFAULT: '200ms'
      },
      borderRadius: {
        DEFAULT: '0.5rem'
      }
    }
  },
  plugins: []
};
