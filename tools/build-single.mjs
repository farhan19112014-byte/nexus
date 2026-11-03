/**
 * Builds ONE self-contained HTML file of the web demo (no server, no other files) that opens by double-clicking.
 * JS, CSS, fonts, images and the 3D model are embedded. Usage: node tools/build-single.mjs [out.html]
 */
import { build } from 'vite';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const out = process.argv[2] ?? 'release/NEXUS-preview.html';
const tmp = '.single-build';
process.env.VITE_WEB_DEMO = '1'; process.env.VITE_ROUTER = 'query'; process.env.NEXUS_BASE = './';
await build({ logLevel: 'warn', base: './', build: { outDir: tmp, emptyOutDir: true, assetsInlineLimit: 1e9, cssCodeSplit: false, modulePreload: false, rollupOptions: { output: { inlineDynamicImports: true } } } });
const dataUri = (file, type) => `data:${type};base64,${readFileSync(join('public', file)).toString('base64')}`;
const files = { '/models/nexus.glb': dataUri('models/nexus.glb', 'model/gltf-binary'), '/images/nexus-render.png': dataUri('images/nexus-render.png', 'image/png'), '/asset-status.json': dataUri('asset-status.json', 'application/json') };
files['/asset-registry.json'] = `data:application/json;base64,${readFileSync(join(tmp, 'asset-registry.json')).toString('base64')}`;
for (const f of readdirSync('public/images/faces')) files[`/images/faces/${f}`] = dataUri(`images/faces/${f}`, 'image/jpeg');
let html = readFileSync(join(tmp, 'index.html'), 'utf8');
const assets = join(tmp, 'assets');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
html = html.replace(/<link rel="(icon|manifest|apple-touch-icon)"[^>]*>\s*/g, '');
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/assets\/([^"]+)"[^>]*>/, (_, f) => `<style>${readFileSync(join(assets, f), 'utf8').replace(/<\/style/gi, '<\\/style')}</style>`);
let js = '';
html = html.replace(/<script type="module"[^>]*src="\.\/assets\/([^"]+)"[^>]*><\/script>/, (_, f) => { js = readFileSync(join(assets, f), 'utf8'); return ''; });
if (!js) throw new Error('no entry script found');
const embed = `<script>window.__NEXUS_FILES__=${JSON.stringify(files)};</script>`;
html = html.replace('</body>', () => `${embed}\n<script type="module">${safe(js)}</script>\n</body>`);   // a function, so $& / $' inside the code are not treated as patterns
writeFileSync(out, html);
rmSync(tmp, { recursive: true, force: true });
console.log(`${out} · ${(html.length / 1048576).toFixed(1)} MB`);
