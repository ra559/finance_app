import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.API_PORT || 3000;

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          charts: ['recharts'],
        },
      },
    },
  },
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
});
