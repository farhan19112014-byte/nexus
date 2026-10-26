/**
 * Whether this browser can draw the 3D NEXUS. Probed once, without loading three.js.
 * NEXUS is 3D wherever WebGL exists; the 2D robot is only the fallback when there is no WebGL at all or the model
 * fails to load. On a software renderer (SwiftShader, llvmpipe… — no graphics hardware) the 3D view draws fewer pixels.
 */
let cached: { ok: boolean; software: boolean } | null = null;
function probe() {
  if (cached) return cached;
  cached = { ok: false, software: false };
  try {
    if (typeof document === 'undefined') return cached;
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      cached = { ok: true, software: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer) };
      gl.getExtension('WEBGL_lose_context')?.loseContext(); // give the probe context back straight away
    }
  } catch { /* no WebGL */ }
  return cached;
}
export const webglAvailable = () => probe().ok;
export const softwareRenderer = () => probe().software;
export type RobotStyle = 'auto' | '2d' | '3d';
/** What the stage will actually show for a style setting. */
export const effectiveStyle = (s: RobotStyle): '2d' | '3d' => (s === '2d' ? '2d' : probe().ok ? '3d' : '2d');
/** for tests */
export const _resetWebglProbe = () => { cached = null; };
