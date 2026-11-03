/**
 * Truthful system status for the status panel — derived only from what the app really knows: the server's
 * capabilities (/api/status), the result of real requests, real audio playback and the current interaction state.
 * Nothing is reported ONLINE before it has been reached; "STANDBY" means configured on the server but not used yet.
 */
import type { Snapshot } from '../core/companion';

export type Status = 'ONLINE' | 'STANDBY' | 'CONNECTING' | 'PROCESSING' | 'SPEAKING' | 'LISTENING' | 'OFFLINE' | 'ERROR';
export interface StatusRow { key: 'backend' | 'ai' | 'voice' | 'interaction'; label: string; status: Status; detail: string }

const PROVIDER: Record<string, string> = { gemini: 'Gemini', openai: 'OpenAI-compatible model', anthropic: 'Claude (Anthropic)', demo: 'Demo brain' };
type Snap = Pick<Snapshot, 'caps' | 'connection' | 'busy' | 'state' | 'speaking' | 'listening' | 'voiceIssue' | 'voiceOkAt' | 'error'>;

export function systemStatus(s: Snap, o: { voiceEngine: string; deviceVoice: boolean; voiceOn: boolean }): StatusRow[] {
  const c = s.caps;
  const backend: StatusRow = !c ? { key: 'backend', label: 'NEXUS server', status: 'CONNECTING', detail: 'checking /api/status…' }
    : c.provider === 'web-demo' ? { key: 'backend', label: 'NEXUS server', status: 'OFFLINE', detail: 'web demo — this page has no server' }
    : c.provider === 'local-demo' ? { key: 'backend', label: 'NEXUS server', status: 'OFFLINE', detail: 'not reachable' }
    : { key: 'backend', label: 'NEXUS server', status: 'ONLINE', detail: c.hosted ? 'public server' : 'this computer' };

  const aiName = c ? (PROVIDER[c.provider] ?? c.label) : 'AI model';
  const ai: StatusRow = !c ? { key: 'ai', label: aiName, status: 'CONNECTING', detail: '' }
    : !c.isLLM ? { key: 'ai', label: 'AI model', status: 'OFFLINE', detail: c.provider === 'demo' ? 'demo brain — no AI model configured' : 'no AI model reachable' }
    : !c.configured ? { key: 'ai', label: aiName, status: 'ERROR', detail: c.note ?? 'not configured on the server' }
    : s.busy && (s.state === 'processing' || s.state === 'responding') ? { key: 'ai', label: aiName, status: 'PROCESSING', detail: c.model ?? '' }
    : s.connection.state === 'failed' ? { key: 'ai', label: aiName, status: 'ERROR', detail: s.connection.detail.slice(0, 90) }
    : s.connection.state === 'ok' ? { key: 'ai', label: aiName, status: 'ONLINE', detail: c.model ?? '' }
    : { key: 'ai', label: aiName, status: 'STANDBY', detail: `${c.model ?? ''} · configured, not used yet`.replace(/^ · /, '') };

  const tts = c?.speech?.tts; const vName = tts?.configured ? (/elevenlabs/i.test(tts.note ?? '') ? 'ElevenLabs voice' : 'Server voice') : 'Voice';
  const voice: StatusRow = !o.voiceOn ? { key: 'voice', label: vName, status: 'OFFLINE', detail: 'spoken replies are muted' }
    : s.speaking && o.voiceEngine === 'server' ? { key: 'voice', label: vName, status: 'SPEAKING', detail: 'playing' }
    : s.voiceIssue ? { key: 'voice', label: vName, status: 'ERROR', detail: s.voiceIssue.message.slice(0, 90) }
    : tts?.configured ? (s.voiceOkAt ? { key: 'voice', label: vName, status: 'ONLINE', detail: 'last reply was spoken' } : { key: 'voice', label: vName, status: 'STANDBY', detail: 'configured, not used yet' })
    : o.deviceVoice ? { key: 'voice', label: 'Device voice', status: s.speaking ? 'SPEAKING' : 'ONLINE', detail: 'no voice service on the server' }
    : { key: 'voice', label: 'Voice', status: 'OFFLINE', detail: 'no voice available' };

  const st = s.state;
  const interaction: StatusRow = { key: 'interaction', label: 'Interaction', detail: '',
    status: s.listening || st === 'listening' ? 'LISTENING' : st === 'processing' || st === 'responding' ? 'PROCESSING' : st === 'speaking' ? 'SPEAKING' : st === 'error' ? 'ERROR' : 'ONLINE' };
  interaction.detail = { idle: 'ready', greeting: 'greeting', listening: 'listening to you', processing: 'waiting for the AI', responding: 'reply streaming', speaking: 'speaking', paused: 'paused', acting: 'moving', interrupted: 'interrupted', error: (s.error ?? 'something went wrong').slice(0, 90), recovering: 'recovering', resting: 'resting — still available' }[st] ?? st;
  return [backend, ai, voice, interaction];
}

/** The NEXUS chain — which link is really active right now. */
export type Stage = 'intelligence' | 'conversation' | 'voice' | 'expression' | 'movement';
export function activeStages(s: Pick<Snapshot, 'state' | 'speaking'>, o: { expression: string; moving: boolean }): Stage[] {
  const out: Stage[] = [];
  if (s.state === 'processing') out.push('intelligence');
  if (s.state === 'responding') out.push('conversation');
  if (s.speaking) out.push('voice');
  if (o.expression !== 'neutral' && s.state !== 'resting') out.push('expression');
  if (o.moving) out.push('movement');
  return out;
}
