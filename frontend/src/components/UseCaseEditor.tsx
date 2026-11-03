import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

/**
 * Use-case editor modal. Replaces the broken inline form: title/desc/LOB/status/category,
 * plus searchable multi-selects for required DATASETS (raw + product, with tier badges)
 * and use-case DEPENDENCIES (by title — no id typing). AI "Suggest dependencies" prefills
 * from the detect-dependencies agent. Shows a raw-vs-product build-effort hint.
 */
const STATUSES = ['not_started', 'scoping', 'in_progress', 'live', 'value_realized'];

type UC = { id?: number; title?: string; description?: string; lob_id?: number | null; status?: string; category?: string; sub_vertical?: string; effort_tshirt?: string };

function TierBadge({ tier }: { tier: string }) {
  return <span className={`text-[9px] px-1 py-0.5 rounded border ml-1 ${tier === 'product'
    ? 'text-info-500 border-info-600/40 bg-info-600/10' : 'text-navy-400 border-navy-600'}`}>{tier === 'product' ? 'product' : 'raw'}</span>;
}

/** Generic searchable add-list: type to filter `options`, click to add; current items shown with remove. */
function SearchAdd({ placeholder, options, onAdd }: {
  placeholder: string; options: { id: number; label: string; tier?: string }[]; onAdd: (id: number) => void;
}) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return options.filter((o) => o.label.toLowerCase().includes(s)).slice(0, 8);
  }, [q, options]);
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
        className="input-field text-sm w-full" />
      {matches.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-navy-900 border border-navy-600 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {matches.map((o) => (
            <button key={o.id} onClick={() => { onAdd(o.id); setQ(''); }}
              className="w-full text-left px-3 py-1.5 text-xs text-navy-300 hover:bg-navy-700 flex items-center">
              <span className="truncate">{o.label}</span>{o.tier && <TierBadge tier={o.tier} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function UseCaseEditor({ useCase, onClose, onSaved }: { useCase: UC | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!useCase?.id;
  const [form, setForm] = useState<UC>({
    title: useCase?.title || '', description: useCase?.description || '',
    lob_id: useCase?.lob_id ?? null, status: useCase?.status || 'not_started', category: useCase?.category || '',
    sub_vertical: useCase?.sub_vertical || 'cross', effort_tshirt: useCase?.effort_tshirt || undefined,
  });
  const [standardizing, setStandardizing] = useState(false);
  const [stdNote, setStdNote] = useState<string | null>(null);
  const [lobs, setLobs] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [ucs, setUcs] = useState<any[]>([]);
  const [requires, setRequires] = useState<{ data_asset_id: number; criticality: string }[]>([]);
  const [prereqs, setPrereqs] = useState<number[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggest, setSuggest] = useState<any>(null);

  useEffect(() => {
    api.lobs().then(setLobs).catch(() => {});
    api.dataAssets().then(setAssets).catch(() => {});
    api.useCases().then(setUcs).catch(() => {});
    if (useCase?.id) {
      api.ucRequires(useCase.id).then((r: any[]) => setRequires(r.map((x) => ({ data_asset_id: x.data_asset_id, criticality: x.criticality })))).catch(() => {});
      api.ucNetwork(useCase.id).then((n) => { setPrereqs(n.prerequisites || []); setTitles(n.titles || {}); }).catch(() => {});
    }
  }, [useCase?.id]);

  const assetById = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a])), [assets]);
  const ucById = useMemo(() => Object.fromEntries(ucs.map((u) => [u.id, u])), [ucs]);
  const rawCount = requires.filter((r) => assetById[r.data_asset_id]?.tier !== 'product').length;
  const productCount = requires.filter((r) => assetById[r.data_asset_id]?.tier === 'product').length;

  const saveFields = async () => {
    if (!form.title?.trim()) { setErr('Title is required'); return; }
    setBusy(true); setErr(null);
    try {
      const payload: any = { title: form.title, description: form.description, lob_id: form.lob_id, status: form.status, category: form.category, sub_vertical: form.sub_vertical };
      if (form.effort_tshirt) payload.effort_tshirt = form.effort_tshirt;
      if (isEdit) await api.updateUseCase(useCase!.id!, payload);
      else { await api.createUseCase(payload); onSaved(); onClose(); return; }
      onSaved();
    } catch (e: any) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };

  // Agent standardization: conform the fields to the catalog's structure/house style.
  const doStandardize = async () => {
    setStandardizing(true); setErr(null); setStdNote(null);
    try {
      const r = await api.standardizeUseCase(
        useCase?.id ? { use_case_id: useCase.id } : { title: form.title, description: form.description });
      const s = r.suggestion;
      setForm((f) => ({ ...f, title: s.title || f.title, description: s.description || f.description,
        category: s.category || f.category, sub_vertical: s.sub_vertical || f.sub_vertical, effort_tshirt: s.effort_tshirt || f.effort_tshirt }));
      setStdNote(`Standardized${r.used_llm ? '' : ' (heuristic)'} — review and Save.`);
    } catch (e: any) { setErr(e?.message || String(e)); } finally { setStandardizing(false); }
  };

  const addAsset = async (assetId: number) => {
    if (!useCase?.id || requires.some((r) => r.data_asset_id === assetId)) return;
    try { await api.addRequires(useCase.id, assetId, 'required'); setRequires((r) => [...r, { data_asset_id: assetId, criticality: 'required' }]); onSaved(); }
    catch (e: any) { setErr(e?.message || String(e)); }
  };
  const removeAsset = async (assetId: number) => {
    if (!useCase?.id) return;
    try { await api.removeRequires(useCase.id, assetId); setRequires((r) => r.filter((x) => x.data_asset_id !== assetId)); onSaved(); }
    catch (e: any) { setErr(e?.message || String(e)); }
  };
  const addDep = async (fromUcId: number) => {
    if (!useCase?.id || prereqs.includes(fromUcId) || fromUcId === useCase.id) return;
    try { await api.addEnables(fromUcId, useCase.id); setPrereqs((p) => [...p, fromUcId]); setTitles((t) => ({ ...t, [fromUcId]: ucById[fromUcId]?.title })); onSaved(); }
    catch (e: any) { setErr(e?.message || String(e)); }
  };
  const removeDep = async (fromUcId: number) => {
    if (!useCase?.id) return;
    try { await api.removeEnables(fromUcId, useCase.id); setPrereqs((p) => p.filter((x) => x !== fromUcId)); onSaved(); }
    catch (e: any) { setErr(e?.message || String(e)); }
  };
  const doSuggest = async () => {
    if (!useCase?.id) return;
    setSuggesting(true);
    try { setSuggest(await api.detectDependencies(useCase.id)); } catch (e: any) { setErr(e?.message || String(e)); } finally { setSuggesting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-navy-900 border border-navy-600 rounded-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-navy-600 sticky top-0 bg-navy-900">
          <h3 className="text-lg font-bold text-heading">{isEdit ? 'Edit use case' : 'New use case'}</h3>
          <button onClick={onClose} className="text-navy-400 hover:text-heading text-xl leading-none">×</button>
        </div>
        <div className="p-4 space-y-4">
          {err && <div className="text-rose-500 text-xs">{err}</div>}
          {/* Fields */}
          <div className="grid md:grid-cols-2 gap-3">
            <label className="text-[11px] text-navy-500 md:col-span-2">Title
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input-field text-sm mt-1 block w-full" />
            </label>
            <label className="text-[11px] text-navy-500">Line of business
              <select value={form.lob_id ?? ''} onChange={(e) => setForm({ ...form, lob_id: e.target.value ? Number(e.target.value) : null })} className="input-field text-sm mt-1 block w-full">
                <option value="">—</option>
                {lobs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-navy-500">Status
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input-field text-sm mt-1 block w-full">
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-navy-500 md:col-span-2">Category
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input-field text-sm mt-1 block w-full" />
            </label>
            <label className="text-[11px] text-navy-500 md:col-span-2">Description
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="input-field text-sm mt-1 block w-full" />
            </label>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button onClick={doStandardize} disabled={standardizing || !form.title?.trim()}
                title="Have an agent normalize this to the catalog's structure/house style"
                className="text-xs px-2 py-1 rounded border border-info-600/40 text-info-500 hover:bg-info-600/10 disabled:opacity-50">
                {standardizing ? 'Standardizing…' : '🪄 Standardize'}</button>
              {stdNote && <span className="text-[11px] text-emerald-500">{stdNote}</span>}
              {form.effort_tshirt && <span className="text-[11px] text-navy-500">effort {form.effort_tshirt}</span>}
            </div>
            <button onClick={saveFields} disabled={busy} className="btn-primary text-sm">{busy ? 'Saving…' : isEdit ? 'Save details' : 'Create use case'}</button>
          </div>

          {!isEdit && <p className="text-[11px] text-navy-500">Create the use case first, then reopen it to attach datasets and dependencies.</p>}

          {isEdit && (
            <>
              {/* Datasets */}
              <div className="border-t border-navy-600 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-heading">Required datasets</div>
                  <div className="text-[11px] text-navy-500">{rawCount} raw · {productCount} product
                    <span className="ml-1 text-navy-600">(products = extra curation work)</span></div>
                </div>
                <SearchAdd placeholder="Search datasets to add…"
                  options={assets.map((a) => ({ id: a.id, label: `${a.module} (${a.source_category})`, tier: a.tier }))}
                  onAdd={addAsset} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {requires.map((r) => {
                    const a = assetById[r.data_asset_id];
                    return (
                      <span key={r.data_asset_id} className="text-xs bg-navy-800 border border-navy-600 rounded px-2 py-1 flex items-center gap-1">
                        {a ? a.module : (assets.length ? 'Unknown dataset' : '…')}{a && <TierBadge tier={a.tier} />}
                        <button onClick={() => removeAsset(r.data_asset_id)} className="text-rose-500 hover:text-rose-400 ml-1">×</button>
                      </span>
                    );
                  })}
                  {requires.length === 0 && <span className="text-[11px] text-navy-500">None yet.</span>}
                </div>
              </div>

              {/* Dependencies */}
              <div className="border-t border-navy-600 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-heading">Prerequisite use cases</div>
                  <button onClick={doSuggest} disabled={suggesting} className="text-xs px-2 py-0.5 rounded border border-info-600/40 text-info-500 hover:bg-info-600/10 disabled:opacity-50">
                    {suggesting ? 'Suggesting…' : '✨ Suggest dependencies'}</button>
                </div>
                <SearchAdd placeholder="Search use cases to add as a prerequisite…"
                  options={ucs.filter((u) => u.id !== useCase!.id).map((u) => ({ id: u.id, label: u.title }))}
                  onAdd={addDep} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {prereqs.map((pid) => (
                    <span key={pid} className="text-xs bg-navy-800 border border-navy-600 rounded px-2 py-1 flex items-center gap-1">
                      {titles[pid] || ucById[pid]?.title || `#${pid}`}
                      <button onClick={() => removeDep(pid)} className="text-rose-500 hover:text-rose-400 ml-1">×</button>
                    </span>
                  ))}
                  {prereqs.length === 0 && <span className="text-[11px] text-navy-500">None yet.</span>}
                </div>
                {suggest && (
                  <div className="mt-2 text-[11px] text-navy-400 border border-navy-600 rounded-lg p-2">
                    <div className="font-semibold mb-1">AI suggestions {suggest.used_llm ? '' : '(heuristic)'}:</div>
                    {(suggest.requires || []).length > 0 && <div>Data: {(suggest.requires || []).map((r: any) => r.label).join(', ')}</div>}
                    {(suggest.enables || []).length > 0 && <div>Enables: {(suggest.enables || []).map((e: any) => e.label).join(', ')}</div>}
                    <div className="text-navy-600 mt-1">Add the ones you want via the search boxes above.</div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
