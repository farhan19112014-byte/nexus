/**
 * The robot's rig contract, shared by everything that drives NEXUS (the animation runtime, the sandbox, the site
 * previews) and implemented by the 3D robot (src/character3d/Robot3D.tsx). NEXUS is 3D only.
 */
import type { Channel } from '../../shared/channels';
import type { OutfitId } from '../../shared/modes';

export interface Accessories { antenna: boolean; sidePanels: boolean; chestLight: boolean; cheekLights: boolean; foreheadIndicator: boolean }
export const DEFAULT_ACCESSORIES: Accessories = { antenna: true, sidePanels: true, chestLight: true, cheekLights: true, foreheadIndicator: true };
/** Real application states shown on the forehead light and chest core (never decorative). */
export type Indicator = 'idle' | 'listening' | 'processing' | 'responding' | 'speaking' | 'acting' | 'success' | 'error' | 'offline';

export interface RobotProps {
  accessories?: Accessories;
  environment?: 'transparent' | 'lab' | 'grid';
  effects?: boolean;              // ambient glow & LED bloom
  title?: string;
  className?: string;
  seat?: boolean;
  /** colour variant; defaults to the page theme (dark = the classic NEXUS, light = white and light blue) */
  skin?: 'dark' | 'light';
  /** clothing over the original robot (3D only; null / 'default' = the original NEXUS) */
  outfit?: { id: OutfitId; accessories: boolean; reduced: boolean } | null;
  /** told which outfit is actually worn (or why it could not be put on) */
  onOutfit?: (worn: OutfitId, error?: string) => void;
}

export interface RigHandle {
  apply(v: Record<Channel, number>): void; setIndicator(i: Indicator): void; setSeat(on: boolean): void; svg?(): SVGSVGElement | null;
  /** the body-language state for the robot's own motion engine */
  setMotion?(state: import('../character3d/motion3d').MotionState, reduced: boolean): void;
  /** true while its procedural motion is still moving (keeps the frame rate up) */
  busy?(): boolean;
  /** the full-body animation layers for this frame */
  setBody?(o: import('../character3d/body/controller').BodyOutput): void;
  /** real positions (its stage, metres) of what it can look at — the user (camera) and page targets */
  attentionTargets?(): Partial<Record<'user' | 'visual' | 'holo', [number, number, number]>> | null;
}
