/**
 * Mode permissions, enforced on the model's output (never left to the prompt): whatever the model writes, a mode
 * that does not allow something cannot make it happen. Removed fields are reported in the response metadata.
 *  - visuals: 'diagrams' keeps diagrams and drops picture searches; 'none' drops both
 *  - skills: animation proposals, refinements, gesture-preference changes and movement feedback
 *  - memory: things to remember (medical and legal conversations are never stored)
 */
import type { BrainHead, BrainResponse } from '../../shared/schema';
import { resolveMode, type ModeId } from '../../shared/modes';

type Visual = BrainHead['visual'];
export function allowedVisual(mode: ModeId, v: Visual): Visual {
  if (!v) return v;
  const p = resolveMode(mode).permissions.visuals;
  return p === 'all' || (p === 'diagrams' && v.kind === 'diagram') ? v : null;
}

export function applyModePermissions(mode: ModeId, r: BrainResponse): { response: BrainResponse; removed: string[] } {
  const p = resolveMode(mode).permissions; const removed: string[] = []; const out = { ...r };
  const v = allowedVisual(mode, out.visual); if (out.visual && !v) { out.visual = null; removed.push('visual'); }
  if (!p.skills) {
    if (out.skillProposal) { out.skillProposal = null; removed.push('skillProposal'); }
    if (out.skillRefinement) { out.skillRefinement = null; removed.push('skillRefinement'); }
    if (out.preferenceUpdate) { out.preferenceUpdate = null; removed.push('preferenceUpdate'); }
    if (out.feedback) { out.feedback = null; removed.push('feedback'); }
  }
  if (!p.memory && out.memoryCandidates.length) { out.memoryCandidates = []; removed.push('memoryCandidates'); }
  return { response: out, removed };
}
