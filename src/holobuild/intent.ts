/** Tiny, dependency-free check used by the main conversation: does this message ask for a 3D model? */
export const CHAT_BUILD_RE = /^(?:hey\s+)?(?:nexus[,:]?\s*)?(?:please\s+|can you\s+|could you\s+)?(?:(?:build|create|generate|design|make|render|show)\s+(?:me\s+|us\s+)?(?:a\s+|an\s+|the\s+)?(?:3d\s+model|3-d\s+model|model|3d|hologram|holobuild)\b|(?:build|construct)\s+(?:me\s+|us\s+)?(?:a|an|the)\s)/i;
export const isChatBuildRequest = (t: string) => CHAT_BUILD_RE.test(t.trim());
