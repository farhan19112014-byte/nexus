/** Asset 85 — main companion workspace; Asset 88 — accessibility; Asset 90 — responsive layout. */
import RobotView, { COMPOSE_EVENT } from './RobotView';
import { ErrorBoundary } from './ErrorBoundary';
import { Icon } from './Icon';
import { useEffect, useRef, useState } from 'react';
import { companion, memory, reminders } from '../core/runtime';
import { useSnapshot, useStore } from './hooks';
import Stage from './Stage';
import ChatPanel from './ChatPanel';
import SkillsPanel, { PreviewStage } from './SkillsPanel';
import MemoryPanel from './MemoryPanel';
import SettingsPanel from './SettingsPanel';
import StatusPanel from './StatusPanel';
import { ChatsPanel, RemindersPanel } from './CompanionPanels';
import { applyCssTokens } from '../character/tokens';
import { RenameDialog, RENAME_EVENT, openRenameDialog } from './RenameDialog';
import { SetupWizard } from './SetupWizard';
import { Link, PATHS, useTitle } from '../router';
import { Logo } from '../site/Site';
import { PRODUCT_NAME } from '../../shared/identity';

type Tab = 'conversation' | 'chats' | 'skills' | 'memory' | 'reminders' | 'settings' | 'status';
const SHORTCUT_TABS: Record<string, Tab> = { Digit1: 'chats', Digit2: 'skills', Digit3: 'memory', Digit4: 'reminders', Digit5: 'settings', Digit6: 'status' };
function useMedia(q: string): boolean {
  const get = () => typeof matchMedia === 'function' && matchMedia(q).matches;
  const [m, setM] = useState(get);
  useEffect(() => { if (typeof matchMedia !== 'function') return; const mq = matchMedia(q); const on = () => setM(mq.matches); on(); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on); }, [q]);
  return m;
}
const CONVO_TAB: { id: Tab; label: string } = { id: 'conversation', label: 'Conversation' };
const TABS: { id: Tab; label: string }[] = [{ id: 'chats', label: 'Chats' }, { id: 'skills', label: 'Skills' }, { id: 'memory', label: 'Memory' }, { id: 'reminders', label: 'Reminders' }, { id: 'settings', label: 'Settings' }, { id: 'status', label: 'Status' }];

function Toasts() {
  useStore(companion.notifications);
  return <div className="toasts" role="status" aria-live="polite">{companion.notifications.notices.map((n) => <div key={n.id} className={`toast t-${n.kind}`}>{n.text}<button className="link" onClick={() => companion.notifications.dismiss(n.id)} aria-label="Dismiss"><Icon name="close" /></button></div>)}</div>;
}

export default function App() {
  const snap = useSnapshot(); useStore(memory); useStore(reminders);
  const [tab, setTab] = useState<Tab>(() => (typeof location !== 'undefined' && location.pathname.startsWith('/settings') ? 'settings' : 'skills'));
  const [renaming, setRenaming] = useState(false);
  useEffect(() => { const o = () => setRenaming(true); window.addEventListener(RENAME_EVENT, o); return () => window.removeEventListener(RENAME_EVENT, o); }, []);
  const robotName = memory.settings.robotName;
  useTitle(robotName === PRODUCT_NAME ? `${PRODUCT_NAME} — robot workspace` : `${robotName} · ${PRODUCT_NAME}`);
  // Laptop widths (761–1279px) show the side panel as a slide-over drawer so the robot and chat keep the full width.
  const robotMode = memory.settings.layout === 'robot';
  const narrowDrawer = useMedia('(min-width: 761px) and (max-width: 1279px)');
  const drawerMode = robotMode || narrowDrawer;
  const [side, setSide] = useState(() => (typeof location !== 'undefined' && location.pathname.startsWith('/settings')) || (memory.settings.layout !== 'robot' && !(typeof matchMedia === 'function' && matchMedia('(min-width: 761px) and (max-width: 1279px)').matches)));
  // switching layout: the robot view starts with the menu closed
  const firstLayout = useRef(true);
  useEffect(() => { if (firstLayout.current) { firstLayout.current = false; return; } setSide(!robotMode && !narrowDrawer); }, [robotMode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!robotMode && tab === 'conversation') setTab('skills'); }, [robotMode, tab]);
  const openTab = (t: Tab) => { setTab(t); setSide(true); };
  const s = memory.settings;
  useEffect(() => { applyCssTokens(); void companion.init(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (e.key === 'Escape') {
        if (document.querySelector('dialog[open]')) return; // the dialog handles its own Esc
        if (drawerMode && side) { setSide(false); return; }
        companion.stopSpeaking(); companion.stopAction(); if (snap.listening) companion.cancelListening(); else if (snap.busy) companion.cancel();
        return;
      }
      // Keyboard shortcuts (see Settings → Keyboard). Alt-based so they never collide with typing.
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const n = SHORTCUT_TABS[e.code];
        if (n) { e.preventDefault(); openTab(n); return; }
        if (e.code === 'KeyP') { e.preventDefault(); setSide((v) => !v); return; }
      }
      if (e.key === '/' && !typing && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (robotMode) window.dispatchEvent(new Event(COMPOSE_EVENT)); else document.getElementById('composer')?.focus(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [snap.listening, snap.busy, drawerMode, side, robotMode]);
  // runs once on mount: adopt the OS reduced-motion preference the first time
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const sys = matchMedia('(prefers-reduced-motion: reduce)'); if (sys.matches && !s.reducedMotion) void memory.updateSettings({ reducedMotion: true }).then(() => companion.applySettings()); }, []);
  const llm = snap.capabilities.find((c) => c.id === 'llm');
  return (
    <div className={`app ${s.highContrast ? 'hc' : ''} ${s.largeText ? 'lt' : ''} ${s.reducedMotion ? 'rm' : ''}`}>
      <a className="skip" href="#composer">Skip to message box</a>
      <header className="top">
        <Link to={PATHS.home} className="brand" aria-label={`${PRODUCT_NAME} home page`} title="Back to the home page"><Logo size={24} /><span>{PRODUCT_NAME}</span></Link>
        <div className="robot-id">
          <span className="robot-name" data-testid="robot-name">{robotName}</span>
          <button className="icon-btn" onClick={openRenameDialog} aria-label={`Rename ${robotName}`} title="Rename your robot"><Icon name="pen" /></button>
        </div>
        <div className="chips-row">
          {llm && <span className={`badge cap-${snap.connection.state === 'failed' ? 'unavailable' : llm.state}`} title={`${llm.detail} — ${snap.connection.detail}${snap.connection.at ? ` (${new Date(snap.connection.at).toLocaleTimeString()})` : ''}`} data-testid="ai-chip">
            {snap.caps?.provider === 'web-demo' ? 'web demo · not an LLM' : snap.caps?.provider === 'local-demo' ? 'server offline' : snap.caps?.isLLM ? `${snap.caps.model ?? 'LLM'} · ${snap.connection.state === 'ok' ? 'connected' : snap.connection.state === 'failed' ? 'last request failed' : 'not checked yet'}` : 'demo brain · not an LLM'}
          </span>}
          {s.quietMode && <span className="badge">quiet</span>}
          {s.research && <span className={`badge ${snap.caps?.research.configured ? 'cap-operational' : 'cap-needs_config'}`}>research {snap.caps?.research.configured ? 'on' : 'unavailable'}</span>}
        </div>
        {robotMode
          ? <button className="menu-toggle" onClick={() => setSide(!side)} aria-expanded={side} aria-controls="side" title="Conversation, skills, memory, settings (Alt+P)"><Icon name="menu" /> Menu</button>
          : <button className="link" onClick={() => setSide(!side)} aria-expanded={side} aria-controls="side" title="Alt+P">{side ? 'Hide panel' : drawerMode ? 'Skills · Memory · Settings' : 'Show panel'}</button>}
      </header>
      <main className={`layout ${side && !drawerMode ? '' : 'no-side'}${robotMode ? ' robot-layout' : ''}`}>
        {robotMode
          ? <ErrorBoundary area="robot view"><RobotView onOpenConversation={() => openTab('conversation')} /></ErrorBoundary>
          : <div className="companion"><ErrorBoundary area="robot view" compact><Stage /></ErrorBoundary><ErrorBoundary area="chat"><ChatPanel /></ErrorBoundary></div>}
        {side && drawerMode && <button className="backdrop" aria-label="Close panel" tabIndex={-1} onClick={() => setSide(false)} />}
        {side && (
          <aside id="side" className={`side${drawerMode ? ' drawer' : ''}`} aria-label="Skills, memory, settings and status">
            <nav className="tabs" role="tablist" aria-label="Panels">{(robotMode ? [CONVO_TAB, ...TABS] : TABS).map((t) => <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} title={t.id === 'conversation' ? 'The whole conversation' : `Alt+${TABS.indexOf(t) + 1}`}>{t.label}{t.id === 'skills' && companion.getSnapshot().preview ? ' •' : ''}{t.id === 'reminders' && reminders.pending().length ? <span className="tab-count" aria-label={`${reminders.pending().length} upcoming`}>{reminders.pending().length}</span> : null}</button>)}{drawerMode && <button className="close" onClick={() => setSide(false)} aria-label="Close panel" title="Esc"><Icon name="close" /></button>}</nav>
            <div className="panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}><ErrorBoundary area="panel" key={tab}>
              {tab === 'conversation' && robotMode && <div className="convo-panel"><ChatPanel inDrawer /></div>}
              {tab === 'chats' && <ChatsPanel />}
              {tab === 'skills' && <SkillsPanel />}
              {tab === 'reminders' && <RemindersPanel />}
              {tab === 'memory' && <MemoryPanel />}
              {tab === 'settings' && <SettingsPanel />}
              {tab === 'status' && <StatusPanel />}
            </ErrorBoundary></div>
          </aside>
        )}
      </main>
      {(!side || tab !== 'skills') && snap.preview && <div className="floating-preview"><PreviewStage /></div>}
      <Toasts />
      <RenameDialog open={renaming} onClose={() => setRenaming(false)} />
      <SetupWizard />
    </div>
  );
}
