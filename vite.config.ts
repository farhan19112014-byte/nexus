import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { buildCsp, inlineScriptHashes } from './server/security';
import { ASSETS } from './src/assets/registry';

/**
 * The asset manifest (141 records, ~28 KB of JS) is only shown in Status → Asset registry, so it is served as a JSON
 * file loaded when that panel opens instead of being bundled into every visitor's JavaScript.
 */
function assetRegistryJson(): Plugin {
  const body = () => JSON.stringify(ASSETS);
  return {
    name: 'nexus-asset-registry',
    configureServer(server) { server.middlewares.use('/asset-registry.json', (_req, res) => { res.setHeader('content-type', 'application/json'); res.end(body()); }); },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'asset-registry.json', source: body() }); },
  };
}

/**
 * NEXUS_META_CSP=1 (the GitHub Pages build): static hosts cannot send headers, so the Content-Security-Policy goes
 * into the page as a <meta> tag — the same policy the NEXUS server sends, allowing the hosted API (VITE_API_BASE).
 * frame-ancestors cannot be set by a <meta> policy, so embedding protection is not available on GitHub Pages.
 */
function metaCsp(): Plugin {
  return {
    name: 'nexus-meta-csp', apply: 'build', enforce: 'post',
    transformIndexHtml(html) {
      if (process.env.NEXUS_META_CSP !== '1') return html;
      const api = (process.env.VITE_API_BASE ?? '').trim().replace(/\/+$/, '');
      let origin = ''; try { origin = api ? new URL(api).origin : ''; } catch { throw new Error(`VITE_API_BASE is not a URL: ${api}`); }
      const csp = buildCsp({ publicMode: true, meta: true, connect: origin ? [origin] : [], inlineScripts: inlineScriptHashes(html) });
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}" />`);
    },
  };
}

export default defineConfig({
  plugins: [react(), metaCsp(), assetRegistryJson()],
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
