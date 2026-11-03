/**
 * HOLOBUILD file input/output: GLB / GLTF export (three.js GLTFExporter) with a validation pass, and a strict check of
 * imported files before three.js parses them (size, header, embedded resources only, no unsupported compression).
 */
import type * as THREE_NS from 'three';
import { HOLO_LIMITS } from '../../shared/holo';

export interface GltfCheck { ok: boolean; kind: 'glb' | 'gltf' | null; error?: string; meshes?: number; json?: Record<string, unknown> }

const UNSUPPORTED_EXT: Record<string, string> = {
  KHR_draco_mesh_compression: 'Draco-compressed meshes', EXT_meshopt_compression: 'meshopt-compressed meshes', KHR_texture_basisu: 'Basis Universal textures',
};

/** Validates a GLB or GLTF file without executing anything. */
export function inspectGltf(buf: ArrayBuffer, fileName = ''): GltfCheck {
  if (buf.byteLength === 0) return { ok: false, kind: null, error: 'The file is empty.' };
  if (buf.byteLength > HOLO_LIMITS.importBytes) return { ok: false, kind: null, error: `The file is ${(buf.byteLength / 1048576).toFixed(1)} MB; the limit is ${HOLO_LIMITS.importBytes / 1048576} MB.` };
  const dv = new DataView(buf); let json: Record<string, unknown>; let kind: 'glb' | 'gltf';
  if (buf.byteLength >= 20 && dv.getUint32(0, true) === 0x46546c67) {          // "glTF"
    kind = 'glb';
    if (dv.getUint32(4, true) !== 2) return { ok: false, kind, error: 'Only glTF 2.0 files are supported.' };
    if (dv.getUint32(8, true) !== buf.byteLength) return { ok: false, kind, error: 'The GLB file is truncated or corrupted (length mismatch).' };
    const len = dv.getUint32(12, true); if (dv.getUint32(16, true) !== 0x4e4f534a || 20 + len > buf.byteLength) return { ok: false, kind, error: 'The GLB file has no valid JSON chunk.' };
    try { json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len))); } catch { return { ok: false, kind, error: 'The GLB file’s JSON chunk could not be read.' }; }
  } else {
    kind = 'gltf';
    if (fileName && !/\.gltf$/i.test(fileName)) return { ok: false, kind: null, error: 'That is not a GLB or GLTF file.' };
    try { json = JSON.parse(new TextDecoder().decode(buf)); } catch { return { ok: false, kind: null, error: 'That is not a GLB or GLTF file.' }; }
  }
  if (!json || typeof json !== 'object') return { ok: false, kind, error: 'The file has no glTF content.' };
  const asset = json.asset as { version?: string } | undefined;
  if (!asset || !String(asset.version ?? '').startsWith('2')) return { ok: false, kind, error: 'Only glTF 2.0 files are supported.' };
  for (const e of [...((json.extensionsRequired as string[]) ?? [])]) if (UNSUPPORTED_EXT[e]) return { ok: false, kind, error: `This file uses ${UNSUPPORTED_EXT[e]}, which HOLOBUILD cannot decode yet. Export it without compression.` };
  const external = [...((json.buffers as { uri?: string }[]) ?? []), ...((json.images as { uri?: string }[]) ?? [])].filter((x) => x.uri && !x.uri.startsWith('data:'));
  if (external.length) return { ok: false, kind, error: 'This GLTF refers to separate files (.bin / textures). Export it as a single .glb (or an embedded .gltf) and import that.' };
  const meshes = ((json.meshes as unknown[]) ?? []).length;
  if (!meshes) return { ok: false, kind, error: 'The file contains no meshes.' };
  return { ok: true, kind, meshes, json };
}

/** Exports an object as GLB (binary) or GLTF (JSON, embedded buffers). The result is re-checked before it is offered. */
export async function exportObject(object: THREE_NS.Object3D, binary: boolean): Promise<{ data: ArrayBuffer | string; check: GltfCheck }> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const out = await new GLTFExporter().parseAsync(object, { binary, onlyVisible: true, trs: false });
  const data = binary ? (out as ArrayBuffer) : JSON.stringify(out);
  const buf = typeof data === 'string' ? new TextEncoder().encode(data).buffer as ArrayBuffer : data;
  const check = inspectGltf(buf, binary ? 'x.glb' : 'x.gltf');
  return { data, check };
}

export const safeFileName = (name: string) => (name.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'model');
