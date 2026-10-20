/**
 * Asset 78 — tool permission registry. NEXUS may only use these tools, with these permissions.
 * Enforcement points are noted per tool; nothing here grants filesystem, secret or code-execution access.
 */
export interface ToolDef {
  id: string; name: string; description: string;
  permissions: ('network:search' | 'storage:local' | 'microphone' | 'speech' | 'notifications' | 'animation')[];
  requires: string[]; inputs: string; failureModes: string[]; enforcedBy: string; userConsent: 'none' | 'per-use' | 'setting' | 'browser-prompt';
}
export const TOOLS: ToolDef[] = [
  { id: 'web_research', name: 'Web research', description: 'Searches a configured provider for the current message.', permissions: ['network:search'], requires: ['server RESEARCH_PROVIDER', 'Research toggle on'], inputs: 'the user\'s latest message (≤200 chars)', failureModes: ['not configured', 'timeout (9 s)', 'no results', 'invalid results (dropped)'], enforcedBy: 'server/brainService.ts gatherSources', userConsent: 'setting' },
  { id: 'memory_write', name: 'Save memory', description: 'Stores a user-approved memory in IndexedDB.', permissions: ['storage:local'], requires: ['Memory enabled'], inputs: 'one short text item', failureModes: ['memory disabled', 'sensitive data refused', 'storage error', 'conflict needs resolution'], enforcedBy: 'src/memory/store.ts remember()', userConsent: 'per-use' },
  { id: 'skill_propose', name: 'Propose skill', description: 'Validates a declarative motion/expression and stores it as PROPOSED.', permissions: ['storage:local', 'animation'], requires: [], inputs: 'declarative skill JSON (no code)', failureModes: ['schema invalid', 'simulation failure', 'storage error'], enforcedBy: 'src/skills/learning.ts propose()', userConsent: 'per-use' },
  { id: 'skill_play', name: 'Play skill', description: 'Plays an approved skill through the animation engine.', permissions: ['animation'], requires: ['skill approved or built-in'], inputs: 'skill id + bounded params', failureModes: ['unknown/unapproved skill', 'conflict (queued/rejected)', 'watchdog recovery'], enforcedBy: 'src/core/skillRunner.ts', userConsent: 'none' },
  { id: 'speech_in', name: 'Speech recognition', description: 'Browser speech recognition while the mic button is active.', permissions: ['microphone'], requires: ['browser support'], inputs: 'microphone audio (processed by the browser vendor)', failureModes: ['unsupported', 'permission denied', 'no speech', 'network'], enforcedBy: 'src/voice/recognition.ts', userConsent: 'browser-prompt' },
  { id: 'speech_out', name: 'Speech synthesis', description: 'Speaks replies with browser voices.', permissions: ['speech'], requires: ['browser support', 'Voice output on'], inputs: 'reply text', failureModes: ['unsupported', 'engine error'], enforcedBy: 'src/voice/tts.ts', userConsent: 'setting' },
  { id: 'desktop_notify', name: 'Desktop notifications', description: 'Notifies when a reply finishes while the tab is hidden.', permissions: ['notifications'], requires: ['setting on', 'browser permission granted', 'not quiet mode'], inputs: 'short status text (no message content)', failureModes: ['denied', 'unsupported'], enforcedBy: 'src/core/notifications.ts', userConsent: 'browser-prompt' },
];
export const toolAllowed = (id: string, ctx: Record<string, boolean>) => {
  const t = TOOLS.find((x) => x.id === id); if (!t) return false;
  if (id === 'web_research') return !!ctx.researchEnabled && !!ctx.researchConfigured;
  if (id === 'memory_write') return !!ctx.memoryEnabled;
  if (id === 'speech_out') return !!ctx.voiceOutput && !!ctx.ttsSupported;
  if (id === 'desktop_notify') return !!ctx.desktopNotifications && !ctx.quietMode && !!ctx.notificationPermission;
  return true;
};
