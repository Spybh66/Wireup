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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/xlsx/')) return 'vendor-xlsx';
          if (id.includes('/node_modules/jspdf/') || id.includes('/node_modules/jspdf-autotable/')) return 'vendor-jspdf';
          if (id.includes('/node_modules/html-to-image/')) return 'vendor-html-to-image';
        },
      },
    },
  },
});
