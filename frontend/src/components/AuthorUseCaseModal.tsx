import React, { useEffect, useState } from 'react';
import { api, type AuthorProposal, type AuthorProposalResponse } from '../lib/api';

/**
 * Add a use case by hand (or re-map an existing custom one). The person writes a
 * title + a few sentences; the agent proposes every mapping — data assets, data
 * domains, prerequisites, enabled use cases, value model — grounded in the catalog.
 * Every mapping is shown with the agent's reason and can be removed before saving;
 * nothing is written until the reviewer confirms.
 */
export function AuthorUseCaseModal({ onClose, onSaved, existing }: {
  onClose: () => void;
  onSaved: (useCaseId: number) => void;
  /** Re-map mode: an existing custom use case. */
  existing?: { id: number; title: string; description?: string | null; lob_id?: number | null };
}) {
  const [lobs, setLobs] = useState<Array<{ id: number; name: string }>>([]);
  const [title, setTitle] = useState(existing?.title || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [lobId, setLobId] = useState<number | null>(existing?.lob_id ?? null);
  const [notes, setNotes] = useState('');
  const [res, setRes] = useState<AuthorProposalResponse | null>(null);
  const [p, setP] = useState<AuthorProposal | null>(null);
  const [busy, setBusy] = useState<'propose' | 'save' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.lobs().then((l: any) => setLobs(l || [])).catch(() => setLobs([])); }, []);

  const propose = async () => {
    if (!title.trim()) { setErr('Give the use case a title.'); return; }
    setBusy('propose'); setErr(null);
    try {
      const r = await api.authorPropose({ title: title.trim(), description, lob_id: lobId, notes, use_case_id: existing?.id ?? null });
      setRes(r); setP(r.proposal);
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(null); }
  };

  const save = async () => {
    if (!p) return;
    setBusy('save'); setErr(null);
    try {
      const card = await api.authorCommit({ proposal: p, use_case_id: existing?.id ?? null, in_portfolio: true });
      const done = await api.confirmWrite(card.token);
      if (!done?.use_case_id) throw new Error(done?.skipped ? `Not saved: ${done.skipped}` : 'Save failed');
      onSaved(done.use_case_id);
    } catch (e: any) { setErr(e?.message || String(e)); setBusy(null); }
  };

  const drop = <K extends 'data_assets' | 'domains' | 'prerequisites' | 'enables'>(key: K, idx: number) =>
    setP((cur) => cur ? { ...cur, [key]: (cur[key] as any[]).filter((_, i) => i !== idx) } : cur);
  const flip = (idx: number) => setP((cur) => cur ? {
    ...cur, data_assets: cur.data_assets.map((a, i) => i === idx ? { ...a, criticality: a.criticality === 'required' ? 'helpful' : 'required' } : a),
  } : cur);

  const input = 'w-full rounded border border-navy-600 bg-navy-800 px-2 py-1.5 text-sm text-heading';
  const required = p ? p.data_assets.filter((a) => a.criticality === 'required') : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-navy-900 border border-navy-600 rounded-xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-navy-600">
          <div>
            <h3 className="text-lg font-bold text-heading">{existing ? 'Re-map use case with the agent' : 'Add a use case'}</h3>
            <p className="text-xs text-navy-400">Describe it in your own words. The agent maps it to your data, dependencies, and value model for you to review.</p>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-heading text-xl leading-none">×</button>
        </div>

        <div className="p-4 space-y-4 overflow-auto">
          {!p && (
            <div className="space-y-3">
              <label className="block text-xs text-navy-300">Title
                <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Transformer overload prediction" />
              </label>
              <label className="block text-xs text-navy-300">What does it do, and why does it matter?
                <textarea className={input} rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="A few sentences: the decision it supports, who uses it, the outcome you expect." />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-navy-300">Line of business (optional)
                  <select className={input} value={lobId ?? ''} onChange={(e) => setLobId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Let the agent pick</option>
                    {lobs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
                <label className="block text-xs text-navy-300">Notes for the agent (optional)
                  <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. we already have AMI in the lakehouse" />
                </label>
              </div>
            </div>
          )}

          {p && res && (
            <div className="space-y-4">
              <div className="text-[11px] text-navy-400">
                {res.used_llm ? <>Mapped by <b>{res.model}</b>.</> : <span className="text-warning-500">The AI agent was unavailable — these are keyword matches. Review carefully.</span>}
                {' '}Remove anything that doesn't apply; nothing is saved until you click Save.
              </div>
              {res.warnings.length > 0 && (
                <ul className="text-[11px] text-warning-500 list-disc pl-4">{res.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-navy-300 col-span-2">Title
                  <input className={input} value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} />
                </label>
                <label className="block text-xs text-navy-300 col-span-2">Description
                  <textarea className={input} rows={3} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />
                </label>
                <label className="block text-xs text-navy-300">Line of business
                  <select className={input} value={p.lob_id ?? ''} onChange={(e) => setP({ ...p, lob_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">—</option>
                    {lobs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
                <label className="block text-xs text-navy-300">Effort
                  <select className={input} value={p.effort_tshirt} onChange={(e) => setP({ ...p, effort_tshirt: e.target.value as AuthorProposal['effort_tshirt'] })}>
                    {['S', 'M', 'L', 'XL'].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
              </div>

              <Section title="Data assets" hint={`${required.filter((a) => a.ready).length} of ${required.length} required assets are already ready in this business unit. Click a badge to toggle required/helpful.`}>
                {p.data_assets.map((a, i) => (
                  <Item key={a.id} onRemove={() => drop('data_assets', i)} reason={a.rationale}
                    badge={<button onClick={() => flip(i)} className={`text-[10px] px-1.5 py-0.5 rounded border ${a.criticality === 'required' ? 'text-info-500 border-info-600/40' : 'text-navy-400 border-navy-600'}`}>{a.criticality}</button>}
                    extra={a.ready ? <span className="text-[10px] text-emerald-500">ready</span> : <span className="text-[10px] text-navy-500">not ready</span>}>
                    {a.label}
                  </Item>
                ))}
              </Section>
              <Section title="Data domains">
                {p.domains.map((d, i) => (
                  <Item key={d.name} onRemove={() => drop('domains', i)} reason={d.rationale}
                    badge={<span className="text-[10px] text-navy-400">{d.necessity}</span>}>{d.label || d.name}</Item>
                ))}
              </Section>
              <Section title="Builds on (prerequisites)" hint="These use cases must be in place first.">
                {p.prerequisites.map((e, i) => <Item key={e.id} onRemove={() => drop('prerequisites', i)} reason={e.rationale}>{e.label}</Item>)}
              </Section>
              <Section title="Enables" hint="These use cases get easier once this one is live.">
                {p.enables.map((e, i) => <Item key={e.id} onRemove={() => drop('enables', i)} reason={e.rationale}>{e.label}</Item>)}
              </Section>
              {p.value_model?.components && p.value_model.components.length > 0 && (
                <Section title="Value model" hint="Computed from your value assumptions; adjust later in the use case's Value tab.">
                  {p.value_model.components.map((c, i) => (
                    <div key={i} className="text-xs text-navy-300"><b className="text-heading">{c.name}</b>{c.calculationDisplay ? ` — ${c.calculationDisplay}` : ''}</div>
                  ))}
                </Section>
              )}
              {p.notes && <div className="text-[11px] text-navy-400"><b>Agent notes:</b> {p.notes}</div>}
            </div>
          )}
          {err && <div className="text-rose-500 text-sm">{err}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-navy-600">
          {p && <button onClick={() => { setP(null); setRes(null); }} disabled={busy !== null} className="text-xs rounded border border-navy-600 text-navy-300 px-3 py-1.5 hover:bg-navy-700">← Edit description</button>}
          <button onClick={onClose} className="text-xs rounded border border-navy-600 text-navy-300 px-3 py-1.5 hover:bg-navy-700">Cancel</button>
          {!p ? (
            <button onClick={propose} disabled={busy !== null} className="btn-primary text-sm disabled:opacity-50">
              {busy === 'propose' ? 'Mapping… (about 30s)' : 'Map with agent →'}</button>
          ) : (
            <button onClick={save} disabled={busy !== null || !p.title.trim()} className="btn-primary text-sm disabled:opacity-50">
              {busy === 'save' ? 'Saving…' : existing ? 'Save mappings' : 'Save use case'}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const empty = React.Children.count(children) === 0;
  return (
    <div>
      <div className="text-sm font-semibold text-heading">{title}</div>
      {hint && <div className="text-[11px] text-navy-500 mb-1">{hint}</div>}
      <div className="space-y-1">{empty ? <div className="text-xs text-navy-500">None proposed.</div> : children}</div>
    </div>
  );
}

function Item({ children, reason, badge, extra, onRemove }: {
  children: React.ReactNode; reason?: string; badge?: React.ReactNode; extra?: React.ReactNode; onRemove: () => void;
}) {
  return (
    <div className="flex items-start gap-2 border border-navy-700 rounded px-2 py-1.5 bg-navy-800/40">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs text-heading">{children} {badge} {extra}</div>
        {reason && <div className="text-[11px] text-navy-400">{reason}</div>}
      </div>
      <button onClick={onRemove} title="Remove this mapping" className="text-navy-500 hover:text-rose-400 text-sm leading-none">×</button>
    </div>
  );
}
