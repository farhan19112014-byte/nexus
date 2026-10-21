/**
 * Asset 01 — NEXUS master character (original design): a compact chibi robot with a big rounded
 * helmet, LED face screen, short articulated arms and legs and a chest light.
 * Asset 04 — every facial component (eyes, pupils, lids, brows, mouth, cheeks, forehead indicator)
 * is a separate, ref-addressed element.  Asset 06 — strokes/radii/glow come from tokens.
 * Asset 07 — accessories are independently toggled.  Asset 09 — stage environments.
 *
 * React renders the static structure; `CharacterRig.apply(values)` updates transforms each frame
 * through refs, so animation never triggers React re-renders.
 */
import { forwardRef, useEffect, useId, useImperativeHandle, useRef } from 'react';
import type { Channel } from '../../shared/channels';
import { COLORS, GLOW, RADII, STROKES, skinFor, type RobotSkin } from './tokens';
import { useResolvedTheme } from '../themeHook';
import { DEFORMATION, GEOMETRY as G, VIEWBOX, armAngle } from './geometry';

export interface Accessories { antenna: boolean; sidePanels: boolean; chestLight: boolean; cheekLights: boolean; foreheadIndicator: boolean }
export const DEFAULT_ACCESSORIES: Accessories = { antenna: true, sidePanels: true, chestLight: true, cheekLights: true, foreheadIndicator: true };
/** Real application states shown on the forehead light and chest core (never decorative). */
export type Indicator = 'idle' | 'listening' | 'processing' | 'responding' | 'speaking' | 'acting' | 'success' | 'error' | 'offline';
const indicatorColors = (k: RobotSkin): Record<Indicator, string> => ({ idle: k.electricBlue, listening: COLORS.success, processing: COLORS.warning, responding: k.electricBlue, speaking: k.cyan, acting: k.paleBlue, success: COLORS.success, error: COLORS.danger, offline: k.textMuted });
const coreColors = (k: RobotSkin): Record<Indicator, string> => ({ ...indicatorColors(k), idle: k.cyan, responding: k.cyan });

export interface RobotProps {
  accessories?: Accessories;
  environment?: 'transparent' | 'lab' | 'grid';
  effects?: boolean;              // ambient glow & LED bloom
  title?: string;
  className?: string;
  seat?: boolean;
  /** colour variant; defaults to the page theme (dark = the classic NEXUS, light = white and light blue) */
  skin?: 'dark' | 'light';
}

export interface RigHandle { apply(v: Record<Channel, number>): void; setIndicator(i: Indicator): void; setSeat(on: boolean): void; svg(): SVGSVGElement | null }

type Refs = Record<string, SVGElement | null>;
const set = (el: SVGElement | null | undefined, attr: string, val: string | number) => { if (el) el.setAttribute(attr, String(val)); };
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

export const Robot = forwardRef<RigHandle, RobotProps>(function Robot(props, ref) {
  const acc = props.accessories ?? DEFAULT_ACCESSORIES;
  const env = props.environment ?? 'lab';
  const effects = props.effects ?? true;
  const uid = useId().replace(/[:]/g, '');
  const refs = useRef<Refs>({});
  const svgRef = useRef<SVGSVGElement>(null);
  const r = (k: string) => (el: SVGElement | null) => { refs.current[k] = el; };
  const glow = effects ? `url(#glow-${uid})` : undefined;
  const theme = useResolvedTheme();
  const variant = props.skin ?? theme;
  const K = skinFor(variant);
  const skinRef = useRef(K); skinRef.current = K;
  const ind = useRef<Indicator>('idle');
  // re-colour the state lights (set imperatively) when the skin changes
  useEffect(() => { const i = ind.current; const R = refs.current; const ic = indicatorColors(K), cc = coreColors(K); set(R.indicator, 'fill', ic[i]); set(R.indicatorGlow, 'fill', ic[i]); set(R.chestLight, 'fill', cc[i]); }, [K]);

  useImperativeHandle(ref, () => ({
    svg: () => svgRef.current,
    setSeat(on) { set(refs.current.seat, 'opacity', on ? 1 : 0); },
    setIndicator(i) { ind.current = i; const ic = indicatorColors(skinRef.current), cc = coreColors(skinRef.current); set(refs.current.indicator, 'fill', ic[i]); set(refs.current.indicatorGlow, 'fill', ic[i]); set(refs.current.chestLight, 'fill', cc[i]); svgRef.current?.setAttribute('data-core', i); },
    apply(v) {
      const R = refs.current;
      const facing = v['body.facing'];
      const sq = v['body.squash'];
      // body root: translate, lean about the hips, squash about the ground
      set(R.body, 'transform', `translate(${f1(v['body.x'])} ${f1(v['body.y'])}) rotate(${f1(v['body.rot'])} 200 ${G.hip.y}) translate(200 ${G.groundY}) scale(${(1 - sq * 0.6).toFixed(3)} ${(1 + sq).toFixed(3)}) translate(-200 ${-G.groundY})`);
      // shadow shrinks when the body rises
      const lift = Math.max(0, -v['body.y']);
      set(R.shadow, 'transform', `translate(${f1(v['body.x'])} 0) scale(${(1 - lift / 120).toFixed(3)} 1)`);
      set(R.shadow, 'transform-origin', `200 ${G.groundY}`);
      // torso facing compression
      const fc = 1 - Math.abs(facing) * DEFORMATION.facingCompress;
      set(R.torso, 'transform', `translate(200 0) scale(${fc.toFixed(3)} 1) translate(-200 0)`);
      set(R.chestPanel, 'transform', `translate(${f1(facing * 14)} 0)`);
      set(R.chestLight, 'opacity', (0.35 + 0.65 * v['chest.glow']).toFixed(2));
      // legs
      for (const s of ['L', 'R'] as const) {
        const sign = s === 'L' ? 1 : -1;
        const spread = v[`leg${s}.spread` as Channel];
        const lf = v[`leg${s}.lift` as Channel];
        set(R[`leg${s}`], 'transform', `rotate(${f1(-sign * spread)} ${200 + sign * G.hip.dx} ${G.hip.y})`);
        const shin = G.leg.len * (1 - G.leg.knee) * (1 - lf * G.leg.liftShorten * 2);
        const footY = G.hip.y + G.leg.len * G.leg.knee + Math.max(6, shin);
        set(R[`shin${s}`], 'height', f1(Math.max(6, shin) + 6));
        set(R[`foot${s}`], 'transform', `translate(0 ${f1(footY - (G.hip.y + G.leg.len))})`);
        set(R[`knee${s}`], 'opacity', (0.55 + lf * 0.45).toFixed(2));
      }
      // arms
      for (const s of ['L', 'R'] as const) {
        set(R[`arm${s}`], 'transform', `translate(${f1(facing * 6)} 0) rotate(${f1(armAngle(s, v[`arm${s}.raise` as Channel]))} ${200 + (s === 'L' ? 1 : -1) * G.shoulder.dx} ${G.shoulder.y})`);
        set(R[`fore${s}`], 'transform', `rotate(${f1(armAngle(s, v[`arm${s}.bend` as Channel]))} 0 0)`);
        set(R[`hand${s}`], 'transform', `rotate(${f1(v[`hand${s}.spin` as Channel])} 0 0)`);
      }
      // head
      const nod = v['head.nod'];
      set(R.head, 'transform', `translate(${f1(v['head.x'] + facing * 4)} ${f1(v['head.y'] + nod * 3)}) rotate(${f1(v['head.rot'])} 200 ${G.head.neckAnchorY}) translate(200 ${G.head.neckAnchorY}) scale(${(1 - Math.abs(facing) * 0.08).toFixed(3)} ${(1 - Math.abs(nod) * DEFORMATION.headNodScale).toFixed(3)}) translate(-200 ${-G.head.neckAnchorY})`);
      set(R.antenna, 'transform', `rotate(${f1(v['antenna.rot'])} 200 ${G.antenna.baseY})`);
      set(R.antennaBall, 'opacity', (0.35 + 0.65 * v['antenna.glow']).toFixed(2));
      set(R.earL, 'transform', `translate(${f1(-Math.max(0, facing) * 10)} 0)`);
      set(R.earR, 'transform', `translate(${f1(-Math.min(0, facing) * 10)} 0)`);
      // face features: shift with facing and nod (2D parallax, not a 3D turn)
      set(R.face, 'transform', `translate(${f1(facing * 16)} ${f1(nod * 9)})`);
      set(R.face, 'opacity', v['face.glow'].toFixed(2));
      const size = v['eyes.size'];
      const happy = v['eyes.happy'];
      for (const s of ['L', 'R'] as const) {
        const sign = s === 'L' ? 1 : -1;
        const cx = 200 + sign * G.eye.dx;
        const open = Math.max(0.06, v[`eye${s}.open` as Channel]);
        const w = G.eye.w * size, h = G.eye.h * size * open;
        set(R[`eye${s}`], 'x', f1(cx - w / 2)); set(R[`eye${s}`], 'width', f1(w));
        set(R[`eye${s}`], 'y', f1(G.eye.y - h / 2)); set(R[`eye${s}`], 'height', f1(h));
        set(R[`eye${s}`], 'rx', f1(Math.min(G.eye.r * size, h / 2)));
        const ec = R[`eyeClip${s}`];
        set(ec, 'x', f1(cx - w / 2 - 1)); set(ec, 'width', f1(w + 2)); set(ec, 'y', f1(G.eye.y - h / 2 - 1)); set(ec, 'height', f1(h + 2)); set(ec, 'rx', f1(Math.min(G.eye.r * size, h / 2)));
        // happy crescent: an occluder in the screen colour rises from below
        const oh = G.eye.h * size;
        set(R[`lid${s}`], 'cy', f1(G.eye.y + oh * (1.05 - happy * 0.62)));
        set(R[`lid${s}`], 'rx', f1(w * 0.75)); set(R[`lid${s}`], 'ry', f1(oh * 0.55));
        set(R[`lid${s}`], 'opacity', happy > 0.02 ? 1 : 0);
        const px = cx + v['pupil.x'] * G.pupilTravel.x * size, py = G.eye.y + v['pupil.y'] * G.pupilTravel.y * size * open;
        const pr = Math.min(9 * size, (h / 2) * 0.75);
        set(R[`pupil${s}`], 'cx', f1(px)); set(R[`pupil${s}`], 'cy', f1(py)); set(R[`pupil${s}`], 'r', f1(Math.max(0, pr)));
        set(R[`spark${s}`], 'cx', f1(px + 4 * size)); set(R[`spark${s}`], 'cy', f1(py - 5 * size * open)); set(R[`spark${s}`], 'r', f1(open > 0.3 ? 3.2 * size : 0));
        set(R[`pupil${s}`], 'opacity', happy > 0.5 ? 0 : 1); set(R[`spark${s}`], 'opacity', happy > 0.5 ? 0 : 1);
        const by = G.eye.y + G.brow.dy * size - v[`brow${s}.y` as Channel] * 8;
        set(R[`brow${s}`], 'transform', `translate(${f1(cx)} ${f1(by)}) rotate(${f1(-sign * v[`brow${s}.tilt` as Channel] * 18)})`);
      }
      // mouth
      const mw = G.mouth.w * v['mouth.width'];
      const curve = v['mouth.curve'] * 13, open = v['mouth.open'] * 16, skew = v['mouth.skew'] * 9;
      const x0 = 200 - mw / 2 + skew * 0.3, x1 = 200 + mw / 2 + skew * 0.3, y = G.mouth.y - skew * 0.15;
      const yl = y - skew * 0.5, yr = y + skew * 0.5;
      const d = open < 1.5
        ? `M${f1(x0)} ${f1(yl)} Q${f1(200 + skew)} ${f1(y + curve * 1.6)} ${f1(x1)} ${f1(yr)}`
        : `M${f1(x0)} ${f1(yl)} Q${f1(200 + skew)} ${f1(y + curve * 1.6 - open * 0.2)} ${f1(x1)} ${f1(yr)} Q${f1(200 + skew)} ${f1(y + curve * 1.6 + open * 1.8)} ${f1(x0)} ${f1(yl)} Z`;
      const round = v['mouth.round'];
      set(R.mouth, 'd', d); set(R.mouth, 'opacity', (1 - round).toFixed(2));
      set(R.mouth, 'fill', open < 1.5 ? 'none' : skinRef.current.mouth);
      set(R.mouthO, 'rx', f1(6 + open * 0.35)); set(R.mouthO, 'ry', f1(7 + open * 0.55)); set(R.mouthO, 'opacity', round.toFixed(2));
      set(R.mouthO, 'cx', f1(200 + skew * 0.5));
      for (const s of ['L', 'R'] as const) set(R[`cheek${s}`], 'opacity', (v.cheeks * 0.75).toFixed(2));
    },
  }), []);

  const eye = (s: 'L' | 'R') => {
    const cx = 200 + (s === 'L' ? 1 : -1) * G.eye.dx;
    return (
      <g key={s} data-part={`eye-${s}`}>
        <clipPath id={`eyeclip-${s}-${uid}`}><rect ref={r(`eyeClip${s}`)} x={cx - G.eye.w / 2} y={G.eye.y - G.eye.h / 2} width={G.eye.w} height={G.eye.h} rx={G.eye.r} /></clipPath>
        <rect ref={r(`eye${s}`)} x={cx - G.eye.w / 2} y={G.eye.y - G.eye.h / 2} width={G.eye.w} height={G.eye.h} rx={G.eye.r} fill={`url(#eyeLed-${uid})`} filter={glow} />
        <g clipPath={`url(#eyeclip-${s}-${uid})`}>
          <circle ref={r(`pupil${s}`)} cx={cx} cy={G.eye.y} r={9} fill={K.pupil} />
          <circle ref={r(`spark${s}`)} cx={cx + 4} cy={G.eye.y - 5} r={3.2} fill="#ffffff" />
          <ellipse cx={cx - 6} cy={G.eye.y - G.eye.h * 0.32} rx={10} ry={5} fill="#ffffff" opacity={0.22} data-part="eye-gloss" />
          <ellipse ref={r(`lid${s}`)} cx={cx} cy={G.eye.y + 60} rx={26} ry={24} fill={K.lid} opacity={0} data-part="eyelid" />
        </g>
        <rect ref={r(`brow${s}`)} x={-G.brow.w / 2} y={-G.brow.h / 2} width={G.brow.w} height={G.brow.h} rx={3} fill={K.brow} transform={`translate(${cx} ${G.eye.y + G.brow.dy})`} data-part="brow" />
      </g>
    );
  };
  const leg = (s: 'L' | 'R') => {
    const x = 200 + (s === 'L' ? 1 : -1) * G.hip.dx;
    const thigh = G.leg.len * G.leg.knee;
    return (
      <g key={s} ref={r(`leg${s}`)} data-part={`leg-${s}`}>
        <rect x={x - G.leg.w / 2} y={G.hip.y - 4} width={G.leg.w} height={thigh + 8} rx={RADII.limb} fill={`url(#cyl-${uid})`} stroke={K.outline} strokeWidth={STROKES.outline} />
        <rect ref={r(`shin${s}`)} x={x - G.leg.w / 2 + 2} y={G.hip.y + thigh - 2} width={G.leg.w - 4} height={G.leg.len - thigh + 6} rx={RADII.limb} fill={`url(#cylDark-${uid})`} stroke={K.outline} strokeWidth={STROKES.outline} />
        <ellipse cx={x} cy={G.hip.y + thigh + 4} rx={G.leg.w / 2 - 3} ry={4} fill={`url(#occl-${uid})`} />
        <circle cx={x} cy={G.hip.y + thigh} r={9} fill={K.socket} />
        <circle ref={r(`knee${s}`)} cx={x} cy={G.hip.y + thigh} r={7} fill={`url(#ledBlue-${uid})`} opacity={0.55} />
        <g ref={r(`foot${s}`)}>
          <rect x={x - G.foot.w / 2 + (s === 'L' ? 4 : -4)} y={G.hip.y + G.leg.len - 4} width={G.foot.w} height={G.foot.h} rx={RADII.foot} fill={`url(#boot-${uid})`} stroke={K.outline} strokeWidth={STROKES.outline} />
          <rect x={x - G.foot.w / 2 + (s === 'L' ? 9 : 1)} y={G.hip.y + G.leg.len - 1} width={G.foot.w - 10} height={3} rx={1.5} fill="#ffffff" opacity={0.14} />
          <rect x={x - G.foot.w / 2 + (s === 'L' ? 8 : 0)} y={G.hip.y + G.leg.len + G.foot.h - 9} width={G.foot.w - 8} height={4} rx={2} fill={K.primaryBlue} />
        </g>
      </g>
    );
  };
  const arm = (s: 'L' | 'R') => {
    const sx = 200 + (s === 'L' ? 1 : -1) * G.shoulder.dx;
    return (
      <g key={s} ref={r(`arm${s}`)} data-part={`arm-${s}`}>
        <rect x={sx - G.upperArm.w / 2} y={G.shoulder.y} width={G.upperArm.w} height={G.upperArm.len + 4} rx={RADII.limb} fill={`url(#cyl-${uid})`} stroke={K.outline} strokeWidth={STROKES.outline} />
        <circle cx={sx} cy={G.shoulder.y} r={13} fill={`url(#sphere-${uid})`} stroke={K.outline} strokeWidth={STROKES.outline} />
        <ellipse cx={sx - 4} cy={G.shoulder.y - 5} rx={4.5} ry={3} fill={`url(#spec-${uid})`} />
        <g transform={`translate(${sx} ${G.shoulder.y + G.upperArm.len})`}>
          <g ref={r(`fore${s}`)}>
            <rect x={-G.forearm.w / 2} y={-3} width={G.forearm.w} height={G.forearm.len + 4} rx={RADII.limb} fill={`url(#cylDark-${uid})`} stroke={K.outline} strokeWidth={STROKES.outline} />
            <circle r={8} fill={K.socket} />
            <circle r={6} fill={`url(#ledBlue-${uid})`} />
            <g transform={`translate(0 ${G.forearm.len + 4})`}>
              <g ref={r(`hand${s}`)} data-part="hand">
                <circle r={G.hand.r} fill={`url(#sphere-${uid})`} stroke={K.outline} strokeWidth={STROKES.outline} />
                <rect x={-3} y={-G.hand.r - 4} width={6} height={10} rx={3} fill={`url(#cyl-${uid})`} stroke={K.outline} strokeWidth={STROKES.detail} transform={`rotate(${s === 'L' ? -35 : 35})`} />
                <ellipse cx={-5} cy={-6} rx={5} ry={3.5} fill={`url(#spec-${uid})`} />
              </g>
            </g>
          </g>
        </g>
      </g>
    );
  };

  return (
    <svg ref={svgRef} viewBox={`0 0 ${VIEWBOX.w} ${VIEWBOX.h}`} className={props.className} role="img" data-skin={variant} aria-label={props.title ?? (variant === 'light' ? 'NEXUS, a small white and light-blue robot' : 'NEXUS, a small blue and black robot')} shapeRendering="geometricPrecision">
      <defs>
        <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={GLOW.led} result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id={`amb-${uid}`} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor={K.ambient} stopOpacity={K.ambientOpacity} />
          <stop offset="100%" stopColor={K.ambientFade} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`scr-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={K.screenTop} /><stop offset="100%" stopColor={K.screenBottom} />
        </linearGradient>
        {/* 3D shading (key light from the upper left, cool rim light from the lower right).
            Gradients use objectBoundingBox units, so they rotate and stretch with each animated part. */}
        <radialGradient id={`shell-${uid}`} cx="34%" cy="24%" r="88%">
          <stop offset="0%" stopColor={K.shellHighlight} /><stop offset="28%" stopColor={K.shellMid} />
          <stop offset="66%" stopColor={K.shellLow} /><stop offset="100%" stopColor={K.shellCore} />
        </radialGradient>
        <linearGradient id={`shellShade-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={K.shadeTop} /><stop offset="32%" stopColor="#ffffff" stopOpacity={0} />
          <stop offset="72%" stopColor="#000000" stopOpacity={0} /><stop offset="100%" stopColor="#000000" stopOpacity={K.shadeBottom} />
        </linearGradient>
        <linearGradient id={`rim-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="45%" stopColor={K.electricBlue} stopOpacity={0} /><stop offset="100%" stopColor={K.cyan} stopOpacity={0.75} />
        </linearGradient>
        <linearGradient id={`cyl-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={K.cylEdge} /><stop offset="20%" stopColor={K.cylLight} /><stop offset="38%" stopColor={K.cylHighlight} />
          <stop offset="64%" stopColor={K.cylMid} /><stop offset="88%" stopColor={K.cylLow} /><stop offset="100%" stopColor={K.cylRim} />
        </linearGradient>
        <linearGradient id={`cylDark-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={K.cylDarkEdge} /><stop offset="22%" stopColor={K.cylDarkMid} /><stop offset="40%" stopColor={K.cylDarkLight} />
          <stop offset="70%" stopColor={K.cylDarkShade} /><stop offset="92%" stopColor={K.cylDarkLow} /><stop offset="100%" stopColor={K.cylDarkRim} />
        </linearGradient>
        <radialGradient id={`sphere-${uid}`} cx="34%" cy="30%" r="72%">
          <stop offset="0%" stopColor={K.sphereHighlight} /><stop offset="30%" stopColor={K.sphereMid} />
          <stop offset="74%" stopColor={K.sphereLow} /><stop offset="100%" stopColor={K.socket} />
        </radialGradient>
        <radialGradient id={`led-${uid}`} cx="36%" cy="32%" r="70%">
          <stop offset="0%" stopColor={K.ledCore} /><stop offset="30%" stopColor={K.ledMid} />
          <stop offset="78%" stopColor={K.ledOuter} /><stop offset="100%" stopColor={K.ledEdge} />
        </radialGradient>
        <radialGradient id={`ledBlue-${uid}`} cx="36%" cy="32%" r="70%">
          <stop offset="0%" stopColor={K.ledBlueCore} /><stop offset="35%" stopColor={K.electricBlue} /><stop offset="100%" stopColor={K.ledBlueEdge} />
        </radialGradient>
        <linearGradient id={`eyeLed-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={K.eyeHigh} /><stop offset="40%" stopColor={K.eyeMid} /><stop offset="100%" stopColor={K.eyeLow} />
        </linearGradient>
        <linearGradient id={`bevel-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={K.bevelTop} /><stop offset="55%" stopColor={K.bevelMid} /><stop offset="100%" stopColor={K.bevelLip} />
        </linearGradient>
        <linearGradient id={`inset-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#000000" stopOpacity={K.insetOpacity} /><stop offset="30%" stopColor="#000000" stopOpacity={0} />
        </linearGradient>
        <linearGradient id={`glass-${uid}`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.16} /><stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
        </linearGradient>
        <linearGradient id={`boot-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={K.bootTop} /><stop offset="35%" stopColor={K.bootMid} /><stop offset="100%" stopColor={K.bootLow} />
        </linearGradient>
        <radialGradient id={`spec-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.55} /><stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`contact-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000000" stopOpacity={0.85 * K.shadowOpacity} /><stop offset="60%" stopColor="#000000" stopOpacity={0.45 * K.shadowOpacity} /><stop offset="100%" stopColor="#000000" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`occl-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000000" stopOpacity={0.6 * K.shadowOpacity} /><stop offset="100%" stopColor="#000000" stopOpacity={0} />
        </radialGradient>
        <clipPath id={`scrclip-${uid}`}><rect x={200 - G.screen.w / 2} y={G.screen.cy - G.screen.h / 2} width={G.screen.w} height={G.screen.h} rx={RADII.screen} /></clipPath>
        <pattern id={`grid-${uid}`} width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke={K.primaryBlue} strokeOpacity={0.12} /></pattern>
      </defs>

      {/* Asset 09 — environment layers (each independently disabled) */}
      {env !== 'transparent' && <rect data-part="env" width={VIEWBOX.w} height={VIEWBOX.h} fill={env === 'grid' ? `url(#grid-${uid})` : 'none'} />}
      {env !== 'transparent' && effects && <ellipse data-part="ambient" cx={200} cy={250} rx={220} ry={230} fill={`url(#amb-${uid})`} />}
      {env === 'lab' && (
        <g data-part="floor">
          <ellipse cx={200} cy={G.groundY + 4} rx={150} ry={16} fill={K.floor} opacity={0.12} />
          <ellipse cx={200} cy={G.groundY + 3} rx={112} ry={12} fill="none" stroke={K.electricBlue} strokeOpacity={0.22} strokeWidth={1.2} />
        </g>
      )}
      <g ref={r('shadow')} data-part="shadow">
        <ellipse cx={200} cy={G.groundY + 1} rx={88} ry={13} fill={`url(#contact-${uid})`} opacity={0.75} />
        <ellipse cx={200} cy={G.groundY} rx={62} ry={7} fill={`url(#contact-${uid})`} />
      </g>

      <g ref={r('seat')} opacity={props.seat ? 1 : 0} data-part="seat">
        <rect x={150} y={G.hip.y + 26} width={100} height={22} rx={10} fill={K.graphiteLight} stroke={K.outline} strokeWidth={STROKES.outline} />
        <rect x={168} y={G.hip.y + 46} width={64} height={G.groundY - G.hip.y - 46} rx={6} fill={K.graphite} stroke={K.outline} strokeWidth={STROKES.outline} />
        <rect x={160} y={G.hip.y + 34} width={80} height={4} rx={2} fill={K.electricBlue} opacity={0.7} />
      </g>

      <g ref={r('body')} data-part="body">
        {leg('R')}{leg('L')}
        {/* torso */}
        <g ref={r('torso')} data-part="torso">
          <rect x={200 - G.torso.neck.w / 2} y={G.torso.top - 10} width={G.torso.neck.w} height={G.torso.neck.h + 8} rx={6} fill={`url(#cylDark-${uid})`} stroke={K.outline} strokeWidth={STROKES.outline} />
          <rect x={200 - G.torso.w / 2} y={G.torso.top} width={G.torso.w} height={G.torso.h} rx={RADII.torso + 10} fill={`url(#shell-${uid})`} stroke={K.outline} strokeWidth={STROKES.outline} />
          <rect x={200 - G.torso.w / 2} y={G.torso.top} width={G.torso.w} height={G.torso.h} rx={RADII.torso + 10} fill={`url(#shellShade-${uid})`} />
          <rect x={200 - G.torso.w / 2 + 2.5} y={G.torso.top + 2.5} width={G.torso.w - 5} height={G.torso.h - 5} rx={RADII.torso + 8} fill="none" stroke={`url(#rim-${uid})`} strokeWidth={2.4} data-part="rim-light" />
          <ellipse cx={200} cy={G.torso.top + 6} rx={G.torso.w / 2 - 14} ry={10} fill={`url(#occl-${uid})`} data-part="head-shadow" />
          <ellipse cx={176} cy={G.torso.top + 20} rx={18} ry={7} fill={`url(#spec-${uid})`} opacity={0.5} />
          <rect x={200 - G.torso.w / 2 + 6} y={G.torso.top + 5} width={G.torso.w - 12} height={G.torso.h - 10} rx={RADII.torso + 6} fill="none" stroke={K.electricBlue} strokeOpacity={0.55} strokeWidth={STROKES.detail} />
          {acc.sidePanels && (
            <g data-part="side-panels">
              {[0, 1, 2].map((i) => <rect key={`l${i}`} x={200 + G.torso.w / 2 - 16} y={G.torso.top + 30 + i * 12} width={8} height={5} rx={2} fill={K.primaryBlue} opacity={0.75} />)}
              {[0, 1, 2].map((i) => <rect key={`r${i}`} x={200 - G.torso.w / 2 + 8} y={G.torso.top + 30 + i * 12} width={8} height={5} rx={2} fill={K.primaryBlue} opacity={0.75} />)}
            </g>
          )}
          <g ref={r('chestPanel')}>
            <rect x={200 - 31.5} y={G.torso.top + 20.5} width={63} height={47} rx={15.5} fill={`url(#bevel-${uid})`} />
            <rect x={200 - 30} y={G.torso.top + 22} width={60} height={44} rx={14} fill={K.chestBg} stroke={K.chestRing} strokeWidth={STROKES.detail} />
            <rect x={200 - 30} y={G.torso.top + 22} width={60} height={44} rx={14} fill={`url(#inset-${uid})`} />
            {acc.chestLight && (
              <g data-part="chest-light">
                <circle ref={r('chestLight')} cx={200} cy={G.torso.top + 44} r={11} fill={K.cyan} filter={glow} />
                <circle cx={200} cy={G.torso.top + 44} r={16} fill="none" stroke={K.electricBlue} strokeWidth={STROKES.detail} />
                <circle cx={200} cy={G.torso.top + 44} r={11} fill={`url(#glass-${uid})`} />
                <ellipse cx={196} cy={G.torso.top + 39.5} rx={4.5} ry={2.8} fill="#ffffff" opacity={0.6} data-part="lens-glint" />
              </g>
            )}
            <rect x={186} y={G.torso.top + 76} width={28} height={4} rx={2} fill={K.electricBlue} opacity={0.6} />
          </g>
        </g>
        {/* head */}
        <g ref={r('head')} data-part="head">
          {acc.antenna && (
            <g ref={r('antenna')} data-part="antenna">
              <rect x={197} y={G.antenna.baseY - G.antenna.len} width={6} height={G.antenna.len + 6} rx={3} fill={`url(#cyl-${uid})`} stroke={K.outline} strokeWidth={STROKES.detail} />
              <circle ref={r('antennaBall')} cx={200} cy={G.antenna.baseY - G.antenna.len} r={G.antenna.ball} fill={`url(#led-${uid})`} filter={glow} />
              <ellipse cx={196} cy={G.antenna.baseY - G.antenna.len - 4} rx={3} ry={2} fill="#ffffff" opacity={0.8} />
            </g>
          )}
          <g ref={r('earL')}><circle cx={200 + G.head.w / 2 - 2 + 5} cy={G.head.cy + 6} r={19} fill={K.socket} stroke={K.outline} strokeWidth={STROKES.outline} /><circle cx={200 + G.head.w / 2 - 2} cy={G.head.cy + 4} r={20} fill={`url(#sphere-${uid})`} stroke={K.outline} strokeWidth={STROKES.outline} /><circle cx={200 + G.head.w / 2 - 2} cy={G.head.cy + 4} r={11} fill={K.socket} opacity={0.6} /><circle cx={200 + G.head.w / 2 - 2} cy={G.head.cy + 4} r={9} fill="none" stroke={K.electricBlue} strokeWidth={3} filter={glow} /></g>
          <g ref={r('earR')}><circle cx={200 - G.head.w / 2 + 2 - 5} cy={G.head.cy + 6} r={19} fill={K.socket} stroke={K.outline} strokeWidth={STROKES.outline} /><circle cx={200 - G.head.w / 2 + 2} cy={G.head.cy + 4} r={20} fill={`url(#sphere-${uid})`} stroke={K.outline} strokeWidth={STROKES.outline} /><circle cx={200 - G.head.w / 2 + 2} cy={G.head.cy + 4} r={11} fill={K.socket} opacity={0.6} /><circle cx={200 - G.head.w / 2 + 2} cy={G.head.cy + 4} r={9} fill="none" stroke={K.electricBlue} strokeWidth={3} filter={glow} /></g>
          <rect x={200 - G.head.w / 2} y={G.head.cy - G.head.h / 2} width={G.head.w} height={G.head.h} rx={RADII.head + 30} fill={`url(#shell-${uid})`} stroke={K.outline} strokeWidth={STROKES.outline} />
          <rect x={200 - G.head.w / 2} y={G.head.cy - G.head.h / 2} width={G.head.w} height={G.head.h} rx={RADII.head + 30} fill={`url(#shellShade-${uid})`} />
          <rect x={200 - G.head.w / 2 + 3} y={G.head.cy - G.head.h / 2 + 3} width={G.head.w - 6} height={G.head.h - 6} rx={RADII.head + 27} fill="none" stroke={`url(#rim-${uid})`} strokeWidth={3} data-part="rim-light" />
          <ellipse cx={150} cy={G.head.cy - G.head.h / 2 + 22} rx={34} ry={12} fill={`url(#spec-${uid})`} transform={`rotate(-14 150 ${G.head.cy - G.head.h / 2 + 22})`} data-part="specular" />
          <path d={`M${200 - G.head.w / 2 + 36} ${G.head.cy - G.head.h / 2 + 12} Q200 ${G.head.cy - G.head.h / 2 + 2} ${200 + G.head.w / 2 - 36} ${G.head.cy - G.head.h / 2 + 12}`} stroke={K.headStripe} strokeOpacity={0.35} strokeWidth={4} fill="none" strokeLinecap="round" />
          <rect x={200 - G.screen.w / 2 - 4} y={G.screen.cy - G.screen.h / 2 - 4} width={G.screen.w + 8} height={G.screen.h + 8} rx={RADII.screen + 4} fill={`url(#bevel-${uid})`} data-part="screen-bevel" />
          <rect x={200 - G.screen.w / 2} y={G.screen.cy - G.screen.h / 2} width={G.screen.w} height={G.screen.h} rx={RADII.screen} fill={`url(#scr-${uid})`} stroke={K.screenEdge} strokeWidth={STROKES.detail + 0.6} />
          <rect x={200 - G.screen.w / 2} y={G.screen.cy - G.screen.h / 2} width={G.screen.w} height={G.screen.h} rx={RADII.screen} fill={`url(#inset-${uid})`} />
          {acc.foreheadIndicator && (
            <g data-part="forehead-indicator">
              <rect ref={r('indicatorGlow')} x={188} y={G.screen.cy - G.screen.h / 2 - 9} width={24} height={5} rx={2.5} fill={K.electricBlue} opacity={0.35} filter={glow} />
              <rect ref={r('indicator')} x={191} y={G.screen.cy - G.screen.h / 2 - 8} width={18} height={3} rx={1.5} fill={K.electricBlue} />
            </g>
          )}
          <g ref={r('face')} data-part="face">
            {eye('R')}{eye('L')}
            {acc.cheekLights && (
              <g data-part="cheeks">
                <ellipse ref={r('cheekL')} cx={200 + G.cheek.dx} cy={G.cheek.y} rx={G.cheek.rx} ry={G.cheek.ry} fill={K.cheek} opacity={0} />
                <ellipse ref={r('cheekR')} cx={200 - G.cheek.dx} cy={G.cheek.y} rx={G.cheek.rx} ry={G.cheek.ry} fill={K.cheek} opacity={0} />
              </g>
            )}
            <path ref={r('mouth')} d={`M180 ${G.mouth.y} Q200 ${G.mouth.y + 4} 220 ${G.mouth.y}`} stroke={K.mouth} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" filter={glow} data-part="mouth" />
            <ellipse ref={r('mouthO')} cx={200} cy={G.mouth.y + 2} rx={6} ry={7} fill="none" stroke={K.mouth} strokeWidth={4.5} opacity={0} filter={glow} />
          </g>
          <g clipPath={`url(#scrclip-${uid})`} data-part="screen-glass" pointerEvents="none">
            <path d={`M${200 - G.screen.w / 2} ${G.screen.cy - G.screen.h / 2} H${200 + 10} L${200 - 40} ${G.screen.cy + G.screen.h / 2} H${200 - G.screen.w / 2} Z`} fill={`url(#glass-${uid})`} />
            <path d={`M${200 + 22} ${G.screen.cy - G.screen.h / 2} H${200 + 36} L${200 - 14} ${G.screen.cy + G.screen.h / 2} H${200 - 28} Z`} fill="#ffffff" opacity={0.04} />
          </g>
        </g>
        {arm('R')}{arm('L')}
      </g>
    </svg>
  );
});
