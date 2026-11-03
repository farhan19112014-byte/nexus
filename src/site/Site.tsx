/** Shared shell for the public pages: logo, header with accessible mobile menu, footer, and live status. */
import { usePalette } from '../theme/usePalette';
import { themeSkin } from '../theme/robotSkin';
import { SpaceField } from '../space/SpaceField';
import { API_BASE, REMOTE_API, REPO_URL, WEB_DEMO } from '../webDemo';
import { Icon } from '../components/Icon';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, PATHS, useLocation } from '../router';
import { DEFAULT_ROBOT_NAME, PRODUCT_NAME } from '../../shared/identity';
import type { ServerCapabilities } from '../../shared/schema';
import { skinFor } from '../character/tokens';
import { useResolvedTheme } from '../themeHook';
import { applyTheme } from '../theme';
import { ThemeToggle } from '../components/ThemeToggle';
import { StudioLink } from '../components/StudioLink';
import type { RobotStyle } from '../character3d/webgl';

/** Original NEXUS mark: the robot's rounded head with its two happy eyes, shaded like the robot (same artwork as build/icon.svg). */
export function Logo({ size = 28 }: { size?: number }) {
  const id = useId().replace(/[:]/g, '');
  const u = (n: string) => `url(#${n}-${id})`;
  const light = useResolvedTheme() === 'light'; const pal = usePalette(); const K = themeSkin(skinFor(light ? 'light' : 'dark'), pal);
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

/** The robot's display name and style, read from the same saved settings the workspace uses (single source of truth). */
let cached: { name: string; style: RobotStyle } | null = null;
function useSaved() {
  const [v, setV] = useState(cached ?? { name: DEFAULT_ROBOT_NAME, style: 'auto' as RobotStyle });
  useEffect(() => {
    let live = true; let off = () => {};
    void import('../core/runtime').then(async ({ memory }) => {
      await memory.ready; if (!live) return;
      const upd = () => { const s = memory.settings; if (!cached || cached.name !== s.robotName || cached.style !== s.robotStyle) cached = { name: s.robotName, style: s.robotStyle }; setV(cached); applyTheme(s.theme); };
      upd(); off = memory.subscribe(upd);
    }).catch(() => { /* storage unavailable: keep the defaults */ });
    return () => { live = false; off(); };
  }, []);
  return v;
}
export const useRobotName = (): string => useSaved().name;
export const useRobotStyle = (): RobotStyle => useSaved().style;

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
  { to: PATHS.app, label: 'Robot' },
  { to: PATHS.holobuild, label: 'HOLOBUILD' },
  { to: `${PATHS.home}#capabilities`, label: 'Capabilities' },
  { to: `${PATHS.home}#technology`, label: 'Technology' },
  { to: PATHS.about, label: 'About' },
];

/** true once the page has scrolled a little — the header turns from transparent to a readable surface */
function useScrolled(px = 12) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let raf = 0;
    const f = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setOn(window.scrollY > px)); };
    f(); window.addEventListener('scroll', f, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', f); };
  }, [px]);
  return on;
}

export function SiteHeader() {
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const scrolled = useScrolled();
  const menuId = useId();
  useEffect(() => { setOpen(false); }, [loc]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open]);
  const [here, hash = ''] = loc.split('?')[0].split('#');
  const current = (to: string) => { const [p, h] = to.split('#'); return p === here && (h ? `#${h}` === `#${hash}` : !hash || p !== '/') ? 'page' : undefined; };
  return (
    <header className={`site-header ${scrolled || open ? 'scrolled' : ''}`}>
      <div className="site-wrap site-header-row">
        <Wordmark />
        <button className="menu-btn" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'close' : 'menu'} size={20} /><span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
        </button>
        <nav id={menuId} className={`site-nav ${open ? 'open' : ''}`} aria-label="Main">
          <Link to={PATHS.home} aria-current={current('/')}>Home</Link>
          {NAV.map((n) => <Link key={n.to} to={n.to} aria-current={current(n.to)}>{n.label}</Link>)}
          <span className="nav-theme nav-tools"><StudioLink /><ThemeToggle /></span>
          <Link to={PATHS.app} className="btn btn-primary nav-cta">Meet NEXUS</Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-wrap footer-grid">
        <div className="footer-brand">
          <Wordmark />
          <p className="small">An interactive AI robotics experience — conversation, expression and motion in one curious digital companion.</p>
          <p className="maker">Made by Muhammad Farhan Khan</p>
        </div>
        <nav aria-label="Footer" className="footer-nav">
          <p className="label">Explore</p>
          <Link to={PATHS.home}>Home</Link>
          <Link to={PATHS.app}>Robot</Link>
          <Link to={PATHS.holobuild}>HOLOBUILD</Link>
          <Link to={PATHS.learning}>Learning</Link>
          <Link to={`${PATHS.home}#capabilities`}>Capabilities</Link>
          <Link to={`${PATHS.home}#technology`}>Technology</Link>
        </nav>
        <nav aria-label="Project" className="footer-nav">
          <p className="label">Project</p>
          <Link to={PATHS.about}>About</Link>
          <Link to={PATHS.creator}>Creator</Link>
          <Link to={PATHS.studio}>Colour Studio</Link>
          <Link to={PATHS.motions}>Motion Lab</Link>
          <Link to={PATHS.privacy}>Privacy</Link>
          <a href={REPO_URL} rel="noopener">Source code on GitHub</a>
        </nav>
      </div>
      <div className="site-wrap footer-base">
        <p className="small">© {new Date().getFullYear()} {PRODUCT_NAME}. Original character and code. Replies come from the configured AI provider.</p>
      </div>
    </footer>
  );
}

export function SitePage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`site ${className}`}>
      {/* About, Privacy and 404 share the space environment, kept to the right of the reading column */}
      {className.includes('doc-page') && <div className="doc-space" aria-hidden><SpaceField focus="full" /></div>}
      <a className="skip" href="#main">Skip to content</a>
      <SiteHeader />
      <main id="main" tabIndex={-1}>{children}</main>
      <SiteFooter />
    </div>
  );
}
