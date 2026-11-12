/** Settings → Appearance: the robot's mode outfits — automatic switching, a fixed outfit, accessories, previews. */
import { useEffect } from 'react';
import { companion, memory } from '../core/runtime';
import { useSnapshot, useStore } from '../components/hooks';
import { MODES, OUTFIT_IDS, type OutfitId } from '../../shared/modes';

const NAME = (id: OutfitId) => (id === 'default' ? 'Original NEXUS' : `${MODES[id].name} outfit`);

export function OutfitSettings() {
  useStore(memory); const snap = useSnapshot();
  const a = memory.settings.appearance;
  const up = (p: Partial<typeof a>) => void memory.updateSettings({ appearance: { ...a, ...p } }).catch((e) => companion.notifications.push('error', (e as Error).message, { essential: true }));
  useEffect(() => () => companion.previewOutfit(null), []);   // leaving Settings ends a preview
  const pv = snap.outfitPreview;
  return (
    <fieldset className="field outfits" data-testid="outfit-settings"><legend>Outfits <span className="muted">(the same NEXUS, dressed for the mode)</span></legend>
      <label className="toggle"><input type="checkbox" checked={a.autoOutfit} onChange={(e) => up({ autoOutfit: e.target.checked })} data-testid="outfit-auto" /> Change outfit with the mode</label>
      {!a.autoOutfit && <label className="field">Always wear<select value={a.fixed} onChange={(e) => up({ fixed: e.target.value as OutfitId })} data-testid="outfit-fixed">{OUTFIT_IDS.map((id) => <option key={id} value={id}>{NAME(id)}</option>)}</select></label>}
      <label className="toggle"><input type="checkbox" checked={a.accessories} onChange={(e) => up({ accessories: e.target.checked })} /> Outfit accessories (badge, tie, stethoscope, wrist screen, pointer)</label>
      <div className="row wrap" role="group" aria-label="Preview an outfit">
        {OUTFIT_IDS.map((id) => <button key={id} type="button" className={pv === id ? 'primary' : ''} aria-pressed={pv === id} onClick={() => companion.previewOutfit(pv === id ? null : id)} data-testid={`outfit-preview-${id}`}>{id === 'default' ? 'Original' : MODES[id].name}</button>)}
      </div>
      {pv && <p className="small" role="status">Previewing the {NAME(pv)} — not saved. <button type="button" className="link" onClick={() => { up({ autoOutfit: false, fixed: pv }); companion.previewOutfit(null); }}>Wear it in every mode</button> · <button type="button" className="link" onClick={() => companion.previewOutfit(null)}>End preview</button></p>}
      <button type="button" onClick={() => { companion.previewOutfit(null); up({ autoOutfit: false, fixed: 'default' }); }} data-testid="outfit-restore">Restore the original NEXUS look</button>
    </fieldset>
  );
}
