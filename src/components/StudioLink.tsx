import { Link, PATHS } from '../router';
import { Icon } from './Icon';

/** Header shortcut to the Colour Studio (next to the light/dark switch). */
export function StudioLink({ className = '' }: { className?: string }) {
  return <Link to={PATHS.studio} className={`theme-toggle studio-link ${className}`} aria-label="Colour Studio — choose the site's colours" title="Colour Studio" data-testid="studio-link"><Icon name="palette" size={17} /></Link>;
}
