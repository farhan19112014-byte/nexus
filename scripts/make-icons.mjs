/**
 * Renders build/icon.svg to every icon the app ships (run: npm run icons):
 *  - build/icon.png (1024), build/icon-512.png, build/icon-256.png, build/icon.ico (16–256) — desktop app / installer
 *  - public/icons/icon-192|256|512.png, public/icons/icon-maskable-512.png, public/favicon.png — web app manifest + favicon
 */
import { chromium } from 'playwright-core';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
const svg = readFileSync('build/icon.svg', 'utf8');
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
async function render(size, path, { maskable = false } = {}) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  const inner = svg.replace('<svg ', `<svg width="${maskable ? Math.round(size * 0.75) : size}" height="${maskable ? Math.round(size * 0.75) : size}" `);
  const body = maskable
    ? `<div style="width:${size}px;height:${size}px;display:grid;place-items:center;background:#080b12">${inner}</div>`
    : inner;
  await p.setContent(`<html><body style="margin:0;background:transparent">${body}</body></html>`);
  const buf = await p.screenshot({ path, omitBackground: !maskable });
  await p.close();
  return buf;
}
await render(1024, 'build/icon.png');
await render(512, 'build/icon-512.png');
await render(256, 'build/icon-256.png');
copyFileSync('build/icon-512.png', 'public/icons/icon-512.png');
copyFileSync('build/icon-256.png', 'public/icons/icon-256.png');
await render(192, 'public/icons/icon-192.png');
await render(512, 'public/icons/icon-maskable-512.png', { maskable: true });
await render(64, 'public/favicon.png');

// Windows .ico: PNG-compressed entries (supported since Windows Vista)
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = [];
for (const s of sizes) pngs.push(await render(s, `test-results/.icon-${s}.png`));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  header.writeUInt8(s >= 256 ? 0 : s, e); header.writeUInt8(s >= 256 ? 0 : s, e + 1);
  header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(pngs[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
writeFileSync('build/icon.ico', Buffer.concat([header, ...pngs]));
await b.close();
console.log('icons written');
