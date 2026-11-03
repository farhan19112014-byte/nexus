import { useSyncExternalStore } from 'react';
import { currentPalette, onPaletteChange } from './studio';

/** the applied Colour Studio palette (null = original NEXUS colours); re-renders when it changes */
export function usePalette() { return useSyncExternalStore(onPaletteChange, currentPalette, () => null); }
