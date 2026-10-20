/**
 * The one icon set used across NEXUS (site + workspace): simple 24×24 line icons in currentColor, drawn for this
 * project. Icons are decorative (aria-hidden) — every control that uses one also has a visible text or an aria-label.
 */
export const ICON_PATHS = {
  chat: 'M5 6h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  face: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M8.5 10h.01 M15.5 10h.01 M8 14.5q4 3.5 8 0',
  pen: 'M4 20l4-1 11-11-3-3L5 16l-1 4z M14 7l3 3',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  memory: 'M6 4h12v16l-6-4-6 4z',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M6 11a6 6 0 0 0 12 0 M12 17v4',
  play: 'M8 5.5v13l10.5-6.5z',
  stop: 'M7 7h10v10H7z',
  close: 'M6 6l12 12 M18 6L6 18',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  plus: 'M12 5v14 M5 12h14',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  retry: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3 M4 4v4.5h4.5',
  reset: 'M4 12a8 8 0 1 0 2.3-5.6L4 8.5 M4 4v4.5h4.5 M12 8v4l2.5 2',
  alarm: 'M12 7v5l3 2 M12 4.5a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M4 4.5l3-2 M20 4.5l-3-2',
  timer: 'M12 8.5v4.5l2.5 1.5 M12 5a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M10 2h4 M12 2v3',
  download: 'M12 4v11 M7.5 10.5L12 15l4.5-4.5 M5 19.5h14',
  mute: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4z M16 9.5l5 5 M21 9.5l-5 5',
  thumbUp: 'M7 10.5v9H4v-9z M7 10.5l4-7c1.6 0 2.5 1 2.2 2.6L12.6 9.5H18a2 2 0 0 1 2 2.3l-1.1 6.2a2 2 0 0 1-2 1.5H7',
  thumbDown: 'M7 13.5v-9H4v9z M7 13.5l4 7c1.6 0 2.5-1 2.2-2.6l-.6-3.4H18a2 2 0 0 0 2-2.3l-1.1-6.2a2 2 0 0 0-2-1.5H7',
  pause: 'M8 5.5v13 M16 5.5v13',
  keyboard: 'M3 7h18v10H3z M7 10.5h.01 M11 10.5h.01 M15 10.5h.01 M7 14h10',
  speaker: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4z M15.5 9a4 4 0 0 1 0 6 M18 6.5a7.5 7.5 0 0 1 0 11',
  send: 'M4 12l16-8-6 16-2.5-6.5z M11.5 13.5L20 4',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.5 9.5a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.2-2.5 3.6 M12 17h.01',
} as const;
export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
