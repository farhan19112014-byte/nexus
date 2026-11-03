/**
 * Learning dashboard: what NEXUS has learned and how — knowledge (with status and sources), research reports,
 * reflections, workflow skills (tests, approval, rollback), experiences, background learning, permissions, activity log.
 * Every number on this page is counted from stored records. Nothing here retrains the AI model.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { VERIFICATION, type Knowledge, type Reflection, type ResearchReport, type Verification, type WorkflowSkill } from '../../shared/learning';
import { Icon } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';
import { StudioLink } from '../components/StudioLink';
import { companion, learner, memory } from '../core/runtime';
import { fmtDate, useSnapshot, useStore } from '../components/hooks';
import { Link, PATHS, useTitle } from '../router';
import { Logo } from '../site/Site';
import { PRODUCT_NAME } from '../../shared/identity';

type Tab = 'overview' | 'knowledge' | 'research' | 'skills' | 'experiences' | 'reflection' | 'settings' | 'activity';
const TABS: [Tab, string][] = [['overview', 'Overview'], ['knowledge', 'Knowledge'], ['research', 'Research'], ['skills', 'Skills'], ['experiences', 'Experiences'], ['reflection', 'Reflection'], ['settings', 'Settings'], ['activity', 'Activity log']];
const STATUS_TEXT: Record<Verification, string> = { verified: 'verified', pending: 'pending', conflicting: 'conflicting', outdated: 'outdated', rejected: 'rejected' };
const useLearner = () => useSyncExternalStore(learner.subscribe, () => learner.version);

export default function LearningPage() {
  useLearner(); useStore(memory); const cs = useSnapshot();
  useTitle(`Learning · ${PRODUCT_NAME}`);
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => { void companion.init(); }, []);
  const s = memory.settings;
  const ai = cs.caps ? cs.caps.isLLM : null;
  return (
    <div className={`app learn ${s.highContrast ? 'hc' : ''} ${s.largeText ? 'lt' : ''} ${s.reducedMotion ? 'rm' : ''}`}>
      <header className="top">
        <Link to={PATHS.home} className="brand" aria-label={`${PRODUCT_NAME} home page`}><Logo size={24} /><span>{PRODUCT_NAME}</span></Link>
        <span className="holo-title"><Icon name="book" /> LEARNING</span>
        <div className="chips-row">
          {ai === false && <span className="badge cap-needs_config" title="Research, reflection and skills need an AI model on the NEXUS server">no AI model connected</span>}
          {learner.settings.background && <span className={`badge ${learner.settings.paused ? '' : 'cap-operational'}`}>background {learner.settings.paused ? 'paused' : 'on'}</span>}
          {learner.busy && <span className="badge cap-operational" role="status"><span className="spinner" aria-hidden /> {learner.busy}</span>}
        </div>
        <StudioLink /><ThemeToggle />
        <Link to={PATHS.holobuild} className="btn btn-ghost">HOLOBUILD</Link>
        <Link to={PATHS.app} className="btn btn-ghost">Robot</Link>
      </header>
      <main className="learn-main">
        <nav className="tabs learn-tabs" role="tablist" aria-label="Learning">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
        <p className="learn-honest">NEXUS learns by keeping notes, sources, reflections and tested procedures here, in this browser. It does <strong>not</strong> retrain the AI model behind it.</p>
        {learner.lastError && <p className="learn-error" role="alert">{learner.lastError}</p>}
        <section role="tabpanel" className="learn-panel">
          {tab === 'overview' && <Overview go={setTab} />}
          {tab === 'knowledge' && <KnowledgeTab />}
          {tab === 'research' && <ResearchTab />}
          {tab === 'skills' && <SkillsTab />}
          {tab === 'experiences' && <ExperiencesTab />}
          {tab === 'reflection' && <ReflectionTab />}
          {tab === 'settings' && <SettingsTab />}
          {tab === 'activity' && <ActivityTab />}
        </section>
      </main>
    </div>
  );
}

function Stat({ n, label, sub }: { n: number | string; label: string; sub?: string }) { return <div className="learn-stat"><strong>{n}</strong><span>{label}</span>{sub && <small className="muted">{sub}</small>}</div>; }

function Overview({ go }: { go: (t: Tab) => void }) {
  const m = learner.metrics();
  return (
    <div data-testid="learn-overview">
      <div className="learn-stats">
        <Stat n={m.knowledge.total} label="knowledge notes" sub={VERIFICATION.filter((v) => m.knowledge.byStatus[v]).map((v) => `${m.knowledge.byStatus[v]} ${v}`).join(' · ') || 'none yet'} />
        <Stat n={m.research.reports} label="research reports" sub={`${m.research.sources} sources · today ${m.research.today}/${m.research.limit}`} />
        <Stat n={m.experiences.total} label="experiences" sub={`${m.experiences.unprocessed} not reflected on yet`} />
        <Stat n={m.reflections} label="reflections" />
        <Stat n={m.skills.total} label="workflow skills" sub={`${m.skills.active} approved · ${m.skills.runs} runs${m.skills.failed ? ` (${m.skills.failed} failed)` : ''}`} />
        <Stat n={m.feedback.total ? `${m.feedback.helpful}/${m.feedback.total}` : '—'} label="replies rated helpful" />
        <Stat n={m.knowledge.used} label="times knowledge was used in a reply" />
      </div>
      {(m.queue.waiting > 0 || m.queue.approved > 0) && <div className="learn-card">
        <h2>Research queue</h2>
        <p className="muted">Questions NEXUS noticed it could not answer well. Nothing is researched until you approve it (or set knowledge gaps to “automatic”).</p>
        <ul className="learn-list">{learner.queue.map((q, i) => <li key={i}><span>{q.question}</span><span className="muted">{q.trigger} · {fmtDate(q.at)}</span>
          {q.approved ? <span className="badge">approved — runs next</span> : <><button onClick={() => void learner.approveGap(i)}>Approve</button><button className="link" onClick={() => void learner.dismissGap(i)}>Dismiss</button></>}
          {q.approved && <button onClick={() => void learner.research(q.question, q.trigger === 'gap' ? 'gap' : 'user').then(() => learner.dismissGap(learner.queue.indexOf(q)))} disabled={!!learner.busy}>Research now</button>}</li>)}</ul>
      </div>}
      <div className="learn-card">
        <h2>Background learning</h2>
        <p>{learner.settings.background ? (learner.settings.paused ? 'Paused.' : `On — while NEXUS is open and idle, one task every ${learner.settings.intervalMin} min (approved questions, then knowledge due for a re-check), at most ${learner.settings.dailyResearch} research runs a day.`) : 'Off. NEXUS only learns when you ask it to (or approve a question).'}</p>
        <p className="muted">{learner.background.lastRunAt ? `Last background step ${fmtDate(learner.background.lastRunAt)}: ${learner.background.lastResult}` : 'No background step has run.'}</p>
        <div className="row"><button onClick={() => go('settings')}>Settings & permissions</button>{learner.settings.background && <button onClick={() => void learner.updateSettings({ paused: !learner.settings.paused })}>{learner.settings.paused ? 'Resume' : 'Pause'}</button>}</div>
      </div>
    </div>
  );
}

function Sources({ k }: { k: Pick<Knowledge, 'sources'> }) {
  return <ul className="learn-sources">{k.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> <span className="muted">{s.domain} · credibility {s.credibility} · retrieved {new Date(s.retrievedAt).toLocaleDateString()}</span></li>)}</ul>;
}

function KnowledgeTab() {
  const [filter, setFilter] = useState<Verification | ''>(''); const [q, setQ] = useState(''); const [editing, setEditing] = useState<string | null>(null); const [teach, setTeach] = useState('');
  const items = learner.knowledge.filter((k) => (!filter || k.status === filter) && (!q || `${k.claim} ${k.topic}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div data-testid="learn-knowledge">
      <div className="row wrap learn-tools">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search knowledge" aria-label="Search knowledge" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Verification | '')} aria-label="Filter by status"><option value="">All statuses</option>{VERIFICATION.map((v) => <option key={v} value={v}>{v}</option>)}</select>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void learner.teach(teach).then((k) => { if (k) setTeach(''); }); }}><input value={teach} onChange={(e) => setTeach(e.target.value)} placeholder="Teach NEXUS a fact (kept as “pending”)" aria-label="Teach a fact" maxLength={400} /><button disabled={teach.trim().length < 3}>Add</button></form>
      </div>
      {!items.length && <p className="muted">{learner.knowledge.length ? 'Nothing matches.' : 'No knowledge yet. Research a question, approve one from the queue, or teach NEXUS a fact.'}</p>}
      <ul className="learn-items">{items.map((k) => (
        <li key={k.id} className={`learn-item st-${k.status}`}>
          {editing === k.id
            ? <form onSubmit={(e) => { e.preventDefault(); void learner.editClaim(k.id, String(new FormData(e.currentTarget).get('c') ?? '')); setEditing(null); }}><textarea name="c" defaultValue={k.claim} maxLength={400} aria-label="Correct the claim" rows={3} /><div className="row"><button className="primary">Save correction</button><button type="button" className="link" onClick={() => setEditing(null)}>Cancel</button></div></form>
            : <p className="learn-claim">{k.claim}</p>}
          <p className="muted"><span className={`badge kb-${k.status}`}>{STATUS_TEXT[k.status]}</span> {k.basis} · {k.category}{k.topic ? ` · ${k.topic}` : ''} · {k.origin === 'research' ? 'from research' : k.origin === 'user' ? 'told by you' : 'your correction'} · updated {fmtDate(k.updatedAt)}{k.uses ? ` · used ${k.uses}×` : ''}</p>
          {k.sources.length > 0 && <details><summary>{k.sources.length} source(s)</summary><Sources k={k} /></details>}
          <div className="row wrap">
            <button className="link" onClick={() => setEditing(k.id)}><Icon name="pen" /> correct</button>
            {k.status !== 'verified' && <button className="link" onClick={() => void learner.setStatus(k.id, 'verified')}>mark verified</button>}
            {k.status !== 'rejected' && <button className="link" onClick={() => void learner.setStatus(k.id, 'rejected')}>reject</button>}
            {k.status !== 'outdated' && k.status !== 'rejected' && <button className="link" onClick={() => void learner.setStatus(k.id, 'outdated')}>mark outdated</button>}
            <button className="link" onClick={() => void learner.research(k.claim, 'recheck')} disabled={!!learner.busy}>re-check</button>
            <button className="link danger" onClick={() => { if (confirm('Delete this knowledge note?')) void learner.deleteKnowledge(k.id); }}><Icon name="trash" /> delete</button>
          </div>
        </li>))}</ul>
    </div>
  );
}

function ResearchTab() {
  const [q, setQ] = useState(''); const reports = learner.reports.filter((r): r is ResearchReport => r.kind === 'research');
  const can = learner.canResearch();
  return (
    <div data-testid="learn-research">
      <form className="row learn-tools" onSubmit={(e) => { e.preventDefault(); void learner.research(q, 'user').then((r) => { if (r) setQ(''); }); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask NEXUS to research a question" aria-label="Research question" maxLength={300} style={{ flex: 1 }} />
        <button className="primary" disabled={q.trim().length < 3 || !!learner.busy || !can.ok} title={can.why}><Icon name="search" /> Research</button>
      </form>
      {!can.ok && <p className="muted">{can.why}</p>}
      <p className="muted">Uses the NEXUS server's search provider and one AI request. Claims are kept only when a cited source really states them; “verified” needs two independent, credible sources.</p>
      {!reports.length && <p className="muted">No research yet.</p>}
      {reports.map((r) => (
        <details key={r.id} className="learn-card" open={r === reports[0]}>
          <summary><strong>{r.question}</strong> <span className="muted">· {fmtDate(r.at)} · {r.trigger} · {r.sources.length} sources via {r.provider}</span></summary>
          <p>{r.summary}</p>
          {r.contradictions.length > 0 && <div className="learn-warn"><strong>Sources disagree:</strong><ul>{r.contradictions.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
          <h3>Claims</h3>
          {!r.claims.length && <p className="muted">No claim was supported by the sources.</p>}
          <ul className="learn-items">{r.claims.map((c, i) => <li key={i} className={`learn-item st-${c.status}`}><p className="learn-claim">{c.claim} <span className="muted">[{c.sources.join(', ')}]</span></p><p className="muted"><span className={`badge kb-${c.status}`}>{c.status}</span> {c.basis}</p></li>)}</ul>
          <h3>Sources (untrusted web text)</h3>
          <ol className="learn-sources">{r.sources.map((s) => <li key={s.id}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> <span className="muted">{s.domain} · credibility {s.credibility}</span></li>)}</ol>
          <p className="muted">Queries: {r.queries.join(' · ')}{r.model ? ` · summarised by ${r.model}` : ''}</p>
        </details>))}
    </div>
  );
}

function SkillsTab() {
  const [goal, setGoal] = useState(''); const [runIn, setRunIn] = useState<Record<string, string>>({}); const [out, setOut] = useState<Record<string, string>>({}); const [problem, setProblem] = useState<Record<string, string>>({});
  return (
    <div data-testid="learn-skills">
      <form className="row learn-tools" onSubmit={(e) => { e.preventDefault(); void learner.draftSkill(goal).then((s) => { if (s) setGoal(''); }); }}>
        <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Describe a task NEXUS should learn to do well, e.g. “explain a machine part to a 12-year-old”" aria-label="Skill goal" maxLength={400} style={{ flex: 1 }} />
        <button className="primary" disabled={goal.trim().length < 5 || !!learner.busy}><Icon name="spark" /> Draft skill</button>
      </form>
      <p className="muted">A workflow skill is a written procedure the AI follows — never code. A version is used only after all its tests pass and you approve it; older versions stay available for rollback.</p>
      {!learner.skills.length && <p className="muted">No workflow skills yet.</p>}
      {learner.skills.map((s: WorkflowSkill) => {
        const active = s.versions.find((v) => v.version === s.active);
        return (
          <div key={s.id} className="learn-card" data-testid="learn-skill">
            <h2>{s.name} <span className="muted">{active ? `v${active.version} approved` : 'not approved yet'} · {s.metrics.runs} runs ({s.metrics.failed} failed)</span></h2>
            {s.versions.slice().reverse().map((v) => (
              <details key={v.version} open={v.status === 'draft' || v.version === s.active}>
                <summary>v{v.version} · <span className={`badge sk-${v.status}`}>{v.status}</span> · {v.tests ? `tests ${v.tests.passed}/${v.tests.total}` : 'not tested'} <span className="muted">· {v.note}</span></summary>
                <p>{v.body.description}</p>
                <p className="muted">Inputs: {v.body.inputs.map((i) => i.name).join(', ')} · Output: {v.body.output}{v.body.limitations ? ` · Limits: ${v.body.limitations}` : ''}</p>
                <ol>{v.body.procedure.map((p, i) => <li key={i}>{p}</li>)}</ol>
                <p className="muted">Tests: {v.body.tests.map((t, i) => `#${i + 1} “${t.input.slice(0, 60)}”${t.mustInclude.length ? ` must include ${t.mustInclude.join(', ')}` : ''}${t.maxChars ? ` ≤${t.maxChars} chars` : ''}`).join(' · ')}</p>
                {v.tests?.failures.length ? <p className="learn-warn">{v.tests.failures.join(' · ')}</p> : null}
                <div className="row wrap">
                  {v.status !== 'active' && v.status !== 'rejected' && <button onClick={() => void learner.testVersion(s.id, v.version)} disabled={!!learner.busy}>Run tests (isolated)</button>}
                  {v.status !== 'active' && v.status !== 'rejected' && <button className="primary" disabled={!v.tests || v.tests.passed !== v.tests.total} title={!v.tests ? 'Run the tests first' : v.tests.passed !== v.tests.total ? 'All tests must pass' : 'Make this the active version'} onClick={() => void learner.approve(s.id, v.version)}>Approve</button>}
                  {v.status === 'draft' && <button className="link danger" onClick={() => void learner.reject(s.id, v.version)}>Reject</button>}
                </div>
              </details>))}
            {active && <div className="row wrap learn-tools">
              <input value={runIn[s.id] ?? ''} onChange={(e) => setRunIn({ ...runIn, [s.id]: e.target.value })} placeholder={active.body.inputs[0]?.description || 'Input'} aria-label={`Input for ${s.name}`} maxLength={1500} style={{ flex: 1 }} />
              <button disabled={!(runIn[s.id] ?? '').trim() || !!learner.busy} onClick={() => void learner.runSkill(s.id, runIn[s.id]).then((o) => o !== null && setOut({ ...out, [s.id]: o }))}><Icon name="play" /> Run</button>
            </div>}
            {out[s.id] && <pre className="learn-out">{out[s.id]}</pre>}
            <div className="row wrap">
              <input value={problem[s.id] ?? ''} onChange={(e) => setProblem({ ...problem, [s.id]: e.target.value })} placeholder="What should be better? (e.g. “too long”, “uses jargon”)" aria-label={`Problem with ${s.name}`} maxLength={300} style={{ flex: 1 }} />
              <button disabled={!(problem[s.id] ?? '').trim() || !!learner.busy} onClick={() => void learner.improve(s.id, [problem[s.id]]).then(() => setProblem({ ...problem, [s.id]: '' }))}>Propose improved version</button>
              {s.versions.some((v) => v.status === 'retired') && <button onClick={() => void learner.rollback(s.id)}>Roll back</button>}
              <button className="link danger" onClick={() => { if (confirm(`Delete the skill “${s.name}” and all its versions?`)) void learner.deleteSkill(s.id); }}><Icon name="trash" /> delete</button>
            </div>
          </div>);
      })}
    </div>
  );
}

function ExperiencesTab() {
  return (
    <div data-testid="learn-experiences">
      <p className="muted">Short notes about real events — a correction, a rating, a failure, a question asked twice, an answer NEXUS was unsure about. Whole conversations are never stored here; anything that looks sensitive is skipped. Kept for {90} days.</p>
      <div className="row"><button className="danger" onClick={() => { if (confirm('Delete all experiences?')) void learner.clear('experiences'); }} disabled={!learner.experiences.length}>Delete all</button></div>
      {!learner.experiences.length && <p className="muted">No experiences recorded.</p>}
      <ul className="learn-items">{learner.experiences.slice(0, 200).map((e) => <li key={e.id} className="learn-item"><p>{e.summary}</p><p className="muted"><span className="badge">{e.type}</span> {e.source} · {fmtDate(e.at)}{e.processed ? ' · reflected on' : ''} <button className="link danger" onClick={() => void learner.deleteExperience(e.id)} aria-label="Delete experience"><Icon name="trash" /></button></p></li>)}</ul>
    </div>
  );
}

function ReflectionTab() {
  const refl = learner.reports.filter((r): r is Reflection => r.kind === 'reflection'); const n = learner.experiences.filter((e) => !e.processed).length;
  return (
    <div data-testid="learn-reflection">
      <div className="row learn-tools"><button className="primary" onClick={() => void learner.reflect()} disabled={!n || !!learner.busy}>Reflect on {n} new experience(s)</button></div>
      <p className="muted">One AI request reviews recent experiences and suggests lessons (each must point to real experiences) and next steps. Proposals never change code, permissions or safety; approving a research proposal queues that research.</p>
      {!refl.length && <p className="muted">No reflections yet.</p>}
      {refl.map((r) => (
        <div key={r.id} className="learn-card">
          <h2>{fmtDate(r.at)} <span className="muted">· {r.experienceIds.length} experiences</span></h2>
          {r.wentWell.length > 0 && <><h3>Went well</h3><ul>{r.wentWell.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
          {r.wentWrong.length > 0 && <><h3>Went wrong</h3><ul>{r.wentWrong.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
          {r.lessons.length > 0 && <><h3>Lessons</h3><ul>{r.lessons.map((l, i) => <li key={i}>{l.lesson} <span className="muted">(evidence: {l.evidence.length} experience{l.evidence.length === 1 ? '' : 's'})</span></li>)}</ul></>}
          {r.proposals.length > 0 && <><h3>Proposals</h3><ul>{r.proposals.map((p, i) => <li key={i}><span className="badge">{p.kind}</span> {p.text} {p.status === 'open' ? <><button onClick={() => void learner.decideProposal(r.id, i, true)}>Approve</button> <button className="link" onClick={() => void learner.decideProposal(r.id, i, false)}>Dismiss</button></> : <span className="muted">{p.status}</span>}</li>)}</ul></>}
        </div>))}
    </div>
  );
}

function SettingsTab() {
  const st = learner.settings; const up = (p: Partial<typeof st>) => void learner.updateSettings(p);
  return (
    <div className="learn-settings" data-testid="learn-settings">
      <label className="holo-check"><input type="checkbox" checked={st.collect} onChange={(e) => up({ collect: e.target.checked })} /> Record experiences (corrections, ratings, failures, gaps)</label>
      <label className="holo-check"><input type="checkbox" checked={st.useKnowledge} onChange={(e) => up({ useKnowledge: e.target.checked })} /> Use learned knowledge in conversations (sent with the message, with its status)</label>
      <label>When NEXUS notices a knowledge gap <select value={st.gapResearch} onChange={(e) => up({ gapResearch: e.target.value as typeof st.gapResearch })}><option value="off">do nothing</option><option value="ask">ask me first (queue)</option><option value="auto">research it automatically</option></select></label>
      <label className="holo-check"><input type="checkbox" checked={st.background} onChange={(e) => up({ background: e.target.checked })} /> Background learning while NEXUS is open (off by default)</label>
      {st.background && <label className="holo-check"><input type="checkbox" checked={st.paused} onChange={(e) => up({ paused: e.target.checked })} /> Paused</label>}
      <label>Research runs per day <input type="number" min={0} max={50} value={st.dailyResearch} onChange={(e) => up({ dailyResearch: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })} /></label>
      <label>Minutes between background tasks <input type="number" min={5} max={240} value={st.intervalMin} onChange={(e) => up({ intervalMin: Math.max(5, Math.min(240, Number(e.target.value) || 20)) })} /></label>
      <label>Re-check knowledge after (days) <input type="number" min={7} max={730} value={st.reviewDays} onChange={(e) => up({ reviewDays: Math.max(7, Math.min(730, Number(e.target.value) || 180)) })} /></label>
      <p className="muted">Each research run uses one AI request (counted against the server's daily allowance) plus up to three web searches through the server's research provider. Background learning never runs while the tab is hidden or while you are talking to NEXUS.</p>
      <div className="row wrap"><button onClick={() => void learner.tick(true).then((r) => learner.notice(r ? null : 'Nothing to do right now (no approved question and no knowledge due for a re-check), or the daily limit is reached.'))} disabled={!!learner.busy}>Run one background step now</button>
        <button className="danger" onClick={() => { if (confirm('Delete ALL learning data (knowledge, reports, experiences, queue)? Skills and the activity log are kept.')) void learner.clear('all'); }}>Delete all learning data</button></div>
    </div>
  );
}

function ActivityTab() {
  return (
    <div data-testid="learn-activity">
      <p className="muted">Every change to knowledge, skills and settings, and every research / reflection / background run — by you or by NEXUS.</p>
      {!learner.audit.length && <p className="muted">Nothing yet.</p>}
      <table className="learn-table"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody>{learner.audit.slice(0, 200).map((a, i) => <tr key={i}><td>{fmtDate(a.at)}</td><td>{a.actor === 'user' ? 'you' : 'NEXUS'}</td><td>{a.action}{a.target ? `: ${a.target}` : ''}</td><td className="muted">{a.detail}</td></tr>)}</tbody></table>
    </div>
  );
}
