/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces (dark)
        surface: {
          0: '#111113',
          1: '#1a1a1c',
          2: '#232326',
        },
        edge: '#333333',
        silver: '#d4d4d8',
        // Wire palette (§3.1)
        wire: {
          'pwr-pos': '#ef4444',
          'pwr-neg': '#525252',
          canh: '#eab308',
          canl: '#22c55e',
          eth: '#3b82f6',
          usb: '#a855f7',
          data: '#9ca3af',
        },
      },
      fontFamily: {
        sans: ['Rajdhani', 'system-ui', 'sans-serif'],
        body: ['Rajdhani', 'system-ui', 'sans-serif'],
        heading: ['Oswald', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
