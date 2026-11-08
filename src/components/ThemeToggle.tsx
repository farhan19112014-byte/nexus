/** One-click switch between the classic dark NEXUS and the light NEXUS (white and light-blue robot). Saved like the Settings choice. */
import { Icon } from './Icon';
import { chooseTheme } from '../theme';
import { useResolvedTheme } from '../themeHook';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useResolvedTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const toggle = () => {
    // instant, also before the saved settings have loaded; saved right after (and kept as "pending" until it is)
    chooseTheme(next, (t) => import('../core/runtime').then(async ({ memory }) => { await memory.ready; await memory.updateSettings({ theme: t }); }));
  };
  const label = next === 'light' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" className={`icon-btn theme-toggle ${className}`} onClick={toggle} aria-label={label} title={label} data-testid="theme-toggle">
      <Icon name={next === 'light' ? 'sun' : 'moon'} size={18} />
    </button>
  );
}
