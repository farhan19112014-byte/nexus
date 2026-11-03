import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/nunito/800.css';
import './components/styles.css';
import './site/site.css';
import './components/workspace.css';
import './components/app-theme.css';
import './theme/palette.css';
import './theme/studio.css';
import './components/depth.css';
import './holobuild/holobuild.css';
import './space/space.css';
import { routeFor, useLocation } from './router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initTheme } from './theme';
import { finishBoot } from './boot';

initTheme();

// Each destination is its own chunk: the landing page loads without the workspace runtime.
const Landing = lazy(() => import('./site/Landing'));
const App = lazy(() => import('./components/App'));
const HoloBuild = lazy(() => import('./holobuild/HoloBuild'));
const LearningPage = lazy(() => import('./learning/LearningPage'));
const CharacterSheet = lazy(() => import('./components/CharacterSheet'));
const About = lazy(() => import('./site/Pages').then((m) => ({ default: m.About })));
const ColourStudio = lazy(() => import('./site/ColourStudio'));
const MotionLab = lazy(() => import('./site/MotionLab'));
const Creator = lazy(() => import('./site/Pages').then((m) => ({ default: m.Creator })));
const Privacy = lazy(() => import('./site/Pages').then((m) => ({ default: m.Privacy })));
const NotFound = lazy(() => import('./site/Pages').then((m) => ({ default: m.NotFound })));

function Root() {
  const loc = useLocation();
  const [path, search = ''] = loc.split('#')[0].split('?');
  const route = routeFor(path, search ? `?${search}` : '');
  const Page = { home: Landing, app: App, holobuild: HoloBuild, learning: LearningPage, about: About, creator: Creator, studio: ColourStudio, motions: MotionLab, privacy: Privacy, sheet: CharacterSheet, notfound: NotFound }[route];
  // keyed by route: each destination fades in (CSS .route, nothing under reduced motion); history and refresh are unaffected
  return <ErrorBoundary area="page"><Suspense fallback={<div className="boot" role="status">Starting NEXUS…</div>}><div className={`route route-${route}`} key={route}><Page /></div></Suspense></ErrorBoundary>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
finishBoot();
