import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site from /<repo>/ — set NEXUS_BASE=/nexus/ for that build
  base: process.env.NEXUS_BASE ?? '/',
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.{ts,tsx}'],
    reporters: ['default', 'json'],
    outputFile: { json: 'test-results/vitest.json' },
  },
});
