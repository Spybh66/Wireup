import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Repo: https://github.com/Spybh66/Wireup  → GitHub Pages base path
export default defineConfig({
  base: '/Wireup/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
