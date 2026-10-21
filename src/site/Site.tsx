/** Shared shell for the public pages: logo, header with accessible mobile menu, footer, and live status. */
import { API_BASE, REMOTE_API, WEB_DEMO } from '../webDemo';
import { Icon } from '../components/Icon';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, PATHS, useLocation } from '../router';
import { DEFAULT_ROBOT_NAME, PRODUCT_NAME } from '../../shared/identity';
import type { ServerCapabilities } from '../../shared/schema';
import { skinFor } from '../character/tokens';
import { useResolvedTheme } from '../themeHook';
import { applyTheme } from '../theme';
import { ThemeToggle } from '../components/ThemeToggle';

/** Original NEXUS mark: the robot's rounded head with its two happy eyes, shaded like the robot (same artwork as build/icon.svg). */
export function Logo({ size = 28 }: { size?: number }) {
  const id = useId().replace(/[:]/g, '');
  const u = (n: string) => `url(#${n}-${id})`;
  const light = useResolvedTheme() === 'light'; const K = skinFor(light ? 'light' : 'dark');
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`lbg-${id}`} cx="50%" cy="36%" r="75%"><stop offset="0" stopColor={light ? '#ffffff' : '#16295a'} /><stop offset="1" stopColor={light ? '#cfe3fb' : 'var(--nexus-dark-blue)'} /></radialGradient>
        <radialGradient id={`lsh-${id}`} cx="34%" cy="24%" r="90%"><stop offset="0" stopColor={K.shellHighlight} /><stop offset=".35" stopColor={K.shellMid} /><stop offset="1" stopColor={K.shellCore} /></radialGradient>
        <linearGradient id={`lbv-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={K.bevelTop} /><stop offset="1" stopColor={K.bevelLip} /></linearGradient>
        <linearGradient id={`lled-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={K.eyeHigh} /><stop offset="1" stopColor={K.eyeLow} /></linearGradient>
        <radialGradient id={`lball-${id}`} cx="36%" cy="32%" r="70%"><stop offset="0" stopColor={K.ledCore} /><stop offset=".4" stopColor={K.ledMid} /><stop offset="1" stopColor={K.ledEdge} /></radialGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={u('lbg')} />
      <rect x=".75" y=".75" width="62.5" height="62.5" rx="15.25" fill="none" stroke={light ? K.outline : '#ffffff'} strokeOpacity={light ? 0.25 : 0.1} strokeWidth="1.5" />
      <line x1="32" y1="17" x2="32" y2="10" stroke={light ? K.cylMid : 'var(--nexus-grey-700)'} strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="9" r="3.6" fill={u('lball')} />
      <rect x="12" y="17" width="40" height="35" rx="12" fill={u('lsh')} stroke={K.outline} strokeWidth="1.5" />
      <rect x="16" y="22" width="32" height="25" rx="9" fill={u('lbv')} />
      <rect x="17" y="23" width="30" height="23" rx="8" fill={light ? K.screenTop : '#0d1118'} stroke={light ? K.screenEdge : 'var(--nexus-electric)'} strokeWidth="1.6" />
      <path d="M22 34.5a4.5 4.5 0 0 1 9 0z M33 34.5a4.5 4.5 0 0 1 9 0z" fill={u('lled')} />
      <path d="M28 39q4 4 8 0" fill="none" stroke={light ? K.mouth : 'var(--nexus-cyan)'} strokeWidth="2" strokeLinecap="round" />
      <path d="M17.8 23.8H34L25 45.2h-7.2z" fill="#ffffff" opacity=".07" />
    </svg>
  );
}

export function Wordmark() {
  return <Link to={PATHS.home} className="wordmark" aria-label={`${PRODUCT_NAME} home`}><Logo /><span>{PRODUCT_NAME}</span></Link>;
}

/** The robot's display name, read from the same saved settings the workspace uses (single source of truth). */
let cachedName: string | null = null;
export function useRobotName(): string {
  const [name, setName] = useState(cachedName ?? DEFAULT_ROBOT_NAME);
  useEffect(() => {
    let live = true; let off = () => {};
    void import('../core/runtime').then(async ({ memory }) => {
      await memory.ready; if (!live) return;
      const upd = () => { cachedName = memory.settings.robotName; setName(cachedName); applyTheme(memory.settings.theme); };
      upd(); off = memory.subscribe(upd);
    }).catch(() => { /* storage unavailable: keep the default */ });
    return () => { live = false; off(); };
  }, []);
  return name;
}

export type LiveStatus = { kind: 'checking' } | { kind: 'offline' } | { kind: 'demo' } | { kind: 'web' } | { kind: 'llm'; model: string | null; configured: boolean; note?: string };
/** Real server status (GET /api/status) — never inferred from the page having loaded. */
export function useLiveStatus(): LiveStatus {
  const [s, setS] = useState<LiveStatus>({ kind: 'checking' });
  useEffect(() => {
    if (WEB_DEMO) { setS({ kind: 'web' }); return; }
    const ctl = new AbortController();
    fetch(`${API_BASE}/api/status`, { signal: AbortSignal.any ? AbortSignal.any([ctl.signal, AbortSignal.timeout(REMOTE_API ? 90000 : 5000)]) : ctl.signal })
      .then(async (r) => { if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error('no api'); return r.json() as Promise<ServerCapabilities>; })
      .then((c) => setS(c.isLLM ? { kind: 'llm', model: c.model, configured: c.configured, note: c.note } : { kind: 'demo' }))
      .catch(() => { if (!ctl.signal.aborted) setS({ kind: 'offline' }); });
    return () => ctl.abort();
  }, []);
  return s;
}
export function StatusPill({ s }: { s: LiveStatus }) {
  const [cls, text] = s.kind === 'checking' ? ['st-checking', REMOTE_API ? 'Waking the NEXUS server (can take up to a minute)…' : 'Checking the server…']
    : s.kind === 'offline' ? ['st-off', 'Server offline — local demo only']
    : s.kind === 'demo' ? ['st-demo', 'Demo brain — not an LLM']
    : s.kind === 'web' ? ['st-demo', 'Web demo — scripted demo brain, not an LLM']
    : s.configured ? ['st-llm', `AI model ready: ${s.model ?? 'configured'}`] : ['st-demo', `AI provider needs setup${s.note ? ` — ${s.note}` : ''}`];
  return <span className={`status-pill ${cls}`} role="status"><i aria-hidden /> {text}</span>;
}

const NAV = [
  { to: `${PATHS.home}#features`, label: 'Features' },
  { to: PATHS.about, label: 'About' },
  { to: PATHS.privacy, label: 'Privacy' },
];

export function SiteHeader() {
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  useEffect(() => { setOpen(false); }, [loc]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open]);
  const here = loc.split(/[?#]/)[0];
  return (
    <header className="site-header">
      <div className="site-wrap site-header-row">
        <Wordmark />
        <span className="tagline">your 2D robot companion</span>
        <button className="menu-btn" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'close' : 'menu'} size={20} /><span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
        </button>
        <nav id={menuId} className={`site-nav ${open ? 'open' : ''}`} aria-label="Main">
          <Link to={PATHS.home} aria-current={here === '/' ? 'page' : undefined}>Home</Link>
          {NAV.map((n) => <Link key={n.to} to={n.to} aria-current={here === n.to ? 'page' : undefined}>{n.label}</Link>)}
          <ThemeToggle className="nav-theme" />
          <Link to={PATHS.app} className="btn btn-primary nav-cta">Meet your robot</Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-wrap footer-row">
        <div className="footer-brand"><Wordmark /><p className="muted small">An original robot companion app that runs on your own computer.</p></div>
        <nav aria-label="Footer">
          <Link to={PATHS.home}>Home</Link>
          <Link to={PATHS.app}>Robot app</Link>
          <Link to={`${PATHS.home}#features`}>Features</Link>
          <Link to={PATHS.about}>About</Link>
          <Link to={PATHS.privacy}>Privacy</Link>
        </nav>
      </div>
      <div className="site-wrap"><p className="muted small copy">{PRODUCT_NAME} — original character and code. Language-model replies come from the provider you configure.</p></div>
    </footer>
  );
}

export function SitePage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`site ${className}`}>
      <a className="skip" href="#main">Skip to content</a>
      <SiteHeader />
      <main id="main" tabIndex={-1}>{children}</main>
      <SiteFooter />
    </div>
  );
}
