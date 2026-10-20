/**
 * Starts the NEXUS server (API + built app) on 127.0.0.1. Used by `server/index.ts` (npm start, the
 * one-click start scripts) and by the desktop app (desktop/main.cjs). Secrets stay in this process.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { loadDotEnv, readConfig } from './config';
import { createApp } from './app';

export interface StartOptions {
  /** Port to try first; 0 = any free port. Defaults to PORT or 8787. */
  port?: number;
  /** How many following ports to try if the first is taken (ignored for port 0). */
  portAttempts?: number;
  serveDist?: boolean; distDir?: string; envFile?: string;
  /** Where Settings → Model saves provider choices and keys (defaults to data/runtime-config.json). */
  runtimeConfigPath?: string;
  log?: (line: string) => void;
}
export interface Started { url: string; port: number; server: Server; close: () => Promise<void>; reused?: false }
export interface Reused { url: string; port: number; reused: true }

/** Is a NEXUS server already answering on this port? (e.g. the user double-clicked the start script twice) */
export async function isNexusAt(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(1200) });
    const j = (await r.json()) as { promptVersion?: unknown };
    return r.ok && typeof j.promptVersion === 'string' && j.promptVersion.startsWith('nexus');
  } catch { return false; }
}

function listen(app: ReturnType<typeof createApp>, port: number): Promise<Server> {
  return new Promise((ok, fail) => {
    const s = app.listen(port, '127.0.0.1');
    s.once('listening', () => ok(s));
    s.once('error', fail);
  });
}

export async function startServer(o: StartOptions = {}): Promise<Started | Reused> {
  loadDotEnv(o.envFile ?? '.env');
  if (o.runtimeConfigPath) process.env.RUNTIME_CONFIG_PATH = o.runtimeConfigPath;
  const cfg = readConfig();
  const first = o.port ?? cfg.port;
  const app = createApp(cfg, { serveDist: o.serveDist, distDir: o.distDir, log: o.log });
  const attempts = first === 0 ? 1 : Math.max(1, o.portAttempts ?? 10);
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const port = first === 0 ? 0 : first + i;
    try {
      const server = await listen(app, port);
      const actual = (server.address() as AddressInfo).port;
      return { url: `http://localhost:${actual}`, port: actual, server, close: () => new Promise((r) => server.close(() => r())) };
    } catch (e) {
      lastErr = e;
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
      if (await isNexusAt(port)) return { url: `http://localhost:${port}`, port, reused: true };
    }
  }
  throw new Error(`No free port between ${first} and ${first + attempts - 1} (${(lastErr as Error)?.message ?? 'in use'}). Set PORT in .env to another number.`);
}

/** Opens a URL in the default browser (used by `--open`). */
export function openBrowser(url: string) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args as string[], { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' }).unref(); } catch { /* no browser available — the URL is printed */ }
}
