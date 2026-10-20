/** Asset 81 — microphone permission state. Never requests access by itself; recognition.start() does, on user action. */
export type MicState = 'unsupported' | 'unknown' | 'prompt' | 'granted' | 'denied';
export async function micPermission(onChange?: (s: MicState) => void): Promise<MicState> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return 'unsupported';
  try {
    const p = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    if (!p) return 'unknown';
    if (onChange) p.onchange = () => onChange(p.state as MicState);
    return p.state as MicState;
  } catch { return 'unknown'; } // Firefox/Safari may not support querying "microphone"
}
