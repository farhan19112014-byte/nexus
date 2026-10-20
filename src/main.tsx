import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/nunito/800.css';
import './components/styles.css';
import './site/site.css';
import './components/depth.css';
import { routeFor, useLocation } from './router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initTheme } from './theme';

initTheme();

// Each destination is its own chunk: the landing page loads without the workspace runtime.
const Landing = lazy(() => import('./site/Landing'));
const App = lazy(() => import('./components/App'));
const CharacterSheet = lazy(() => import('./components/CharacterSheet'));
const About = lazy(() => import('./site/Pages').then((m) => ({ default: m.About })));
const Privacy = lazy(() => import('./site/Pages').then((m) => ({ default: m.Privacy })));
const NotFound = lazy(() => import('./site/Pages').then((m) => ({ default: m.NotFound })));

function Root() {
  const loc = useLocation();
  const [path, search = ''] = loc.split('#')[0].split('?');
  const route = routeFor(path, search ? `?${search}` : '');
  const Page = { home: Landing, app: App, about: About, privacy: Privacy, sheet: CharacterSheet, notfound: NotFound }[route];
  return <ErrorBoundary area="page"><Suspense fallback={<div className="boot" role="status">Starting NEXUS…</div>}><Page /></Suspense></ErrorBoundary>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
