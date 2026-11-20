import React, { useEffect, useMemo, useState } from 'react';
import { Upload, X, Sparkles, AlertTriangle, Check, FileJson } from 'lucide-react';
import { api, type RoadmapPreview, type RoadmapDecision, type RoadmapSource } from '../lib/api';

/**
 * Import a roadmap into the active business unit: the AI Transformation Roadmap deck
 * (.html, as published) or a roadmap package (.json, ROADMAP_PACKAGE.md).
 *
 *   1. Choose the file           — read and validated server-side; nothing is written.
 *                                   A deck is converted to a package in memory and the
 *                                   HTML itself is never stored.
 *   2. Review every use case     — map to a catalog use case, create it new, or skip.
 *                                   Suggestions come from word overlap (and, on request,
 *                                   the model); the person decides.
 *   3. Import                    — writes exactly the reviewed decisions.
 */
type Choice = { action: 'map' | 'create' | 'skip'; use_case_id: number | null };

function money(v: number | null | undefined, currency = 'USD') {
  if (v == null || !isFinite(v) || v === 0) return '—';
  const sym = currency === 'USD' ? '$' : `${currency} `;
  return v >= 1e6 ? `${sym}${(v / 1e6).toFixed(1)}M` : `${sym}${Math.round(v / 1e3)}K`;
}

export function RoadmapImportModal({ accountName, onClose, onImported }: {
  accountName?: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [pkg, setPkg] = useState<RoadmapSource | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [preview, setPreview] = useState<RoadmapPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [catalog, setCatalog] = useState<Array<{ id: number; title: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [errList, setErrList] = useState<string[]>([]);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiWhy, setAiWhy] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, any> | null>(null);
  const [filter, setFilter] = useState<'all' | 'map' | 'create' | 'skip'>('all');

  useEffect(() => {
    api.catalogUseCases().then((r) => setCatalog(r.map((u) => ({ id: u.id, title: u.title }))
      .sort((a, b) => a.title.localeCompare(b.title)))).catch(() => setCatalog([]));
  }, []);

  const titleOf = useMemo(() => new Map(catalog.map((c) => [c.id, c.title])), [catalog]);

  const readFile = async (f: File) => {
    setErr(null); setErrList([]); setPreview(null); setDone(null);
    setFileName(f.name);
    const isHtml = /\.html?$/i.test(f.name) || f.type === 'text/html';
    if (f.size > (isHtml ? 15_000_000 : 5_000_000)) { setErr(`That file is larger than ${isHtml ? 15 : 5} MB.`); return; }
    const text = await f.text();
    let src: RoadmapSource;
    if (isHtml || /^\s*</.test(text)) {
      src = { deck_html: text, file_name: f.name };
    } else {
      try { src = { package: JSON.parse(text) }; }
      catch { setErr('That file is neither an AITR deck (.html) nor a roadmap package (.json).'); return; }
    }
    setPkg(src);
    setBusy('preview');
    try {
      const p = await api.roadmapImportPreview(src);
      setPreview(p);
      const c: Record<string, Choice> = {};
      for (const m of p.matches) c[m.external_id] = { action: m.suggestion.action, use_case_id: m.suggestion.use_case_id };
      setChoices(c);
    } catch (e: any) {
      const msg = String(e?.message || e);
      const m = msg.match(/\{.*\}$/s);
      try {
        const detail = m ? JSON.parse(m[0]).detail : null;
        if (detail?.errors) { setErr(detail.message); setErrList(detail.errors); }
        else setErr(msg);
      } catch { setErr(msg); }
    } finally { setBusy(null); }
  };

  const setChoice = (ext: string, value: string) => {
    setChoices((cur) => {
      const next = { ...cur };
      if (value === 'create' || value === 'skip') next[ext] = { action: value, use_case_id: null };
      else next[ext] = { action: 'map', use_case_id: Number(value) };
      return next;
    });
  };

  const downloadPackage = async () => {
    if (!pkg) return;
    try {
      const r = await api.roadmapImportPackage(pkg);
      const blob = new Blob([JSON.stringify(r.package, null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `${preview?.roadmap.id || 'roadmap'}-package.json`; link.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setErr(String(e?.message || e)); }
  };

  const askAi = async () => {
    if (!preview || !pkg) return;
    const ids = preview.matches.filter((m) => choices[m.external_id]?.action === 'create').map((m) => m.external_id);
    if (ids.length === 0) { setAiNote('Every use case already has a catalog match.'); return; }
    setBusy('ai'); setAiNote(null);
    try {
      const r = await api.roadmapImportSuggest(pkg, ids.slice(0, 40));
      if (!r.model_used) { setAiNote(r.message || 'The model is unavailable; match these by hand.'); return; }
      let found = 0;
      const why: Record<string, string> = {};
      setChoices((cur) => {
        const next = { ...cur };
        for (const s of r.suggestions) {
          why[s.external_id] = s.why;
          if (s.use_case_id != null && next[s.external_id]?.action === 'create') {
            next[s.external_id] = { action: 'map', use_case_id: s.use_case_id }; found++;
          }
        }
        return next;
      });
      setAiWhy((w) => ({ ...w, ...why }));
      setAiNote(`The model suggested a catalog match for ${found} of ${ids.length}. Check each one before importing.`);
    } catch (e: any) { setAiNote(String(e?.message || e)); }
    finally { setBusy(null); }
  };

  const duplicates = useMemo(() => {
    const seen = new Map<number, string[]>();
    for (const [ext, c] of Object.entries(choices)) {
      if (c.action === 'map' && c.use_case_id != null) seen.set(c.use_case_id, [...(seen.get(c.use_case_id) || []), ext]);
    }
    return new Set([...seen.values()].filter((v) => v.length > 1).flat());
  }, [choices]);

  const apply = async () => {
    if (!preview || !pkg) return;
    setBusy('apply'); setErr(null);
    const decisions: RoadmapDecision[] = preview.matches.map((m) => ({
      external_id: m.external_id, action: choices[m.external_id].action,
      use_case_id: choices[m.external_id].action === 'map' ? choices[m.external_id].use_case_id : null,
    }));
    try {
      const r = await api.roadmapImportApply(pkg, decisions);
      setDone(r.summary);
      onImported();
    } catch (e: any) {
      const msg = String(e?.message || e);
      setErr(msg.includes('403') ? 'You have view-only access to this business unit. Ask an owner to make you an editor.' : msg);
    } finally { setBusy(null); }
  };

  const counts = useMemo(() => {
    const c = { map: 0, create: 0, skip: 0 };
    Object.values(choices).forEach((x) => { c[x.action]++; });
    return c;
  }, [choices]);
  const pillarName = useMemo(() => new Map((preview?.pillars || []).map((p) => [p.id, p.name])), [preview]);
  const changedIds = useMemo(() => new Set((preview?.diff.changed || []).map((c) => c.id)), [preview]);
  const addedIds = useMemo(() => new Set(preview && !preview.diff.first_import ? preview.diff.added : []), [preview]);
  const rows = (preview?.matches || []).filter((m) => filter === 'all' || choices[m.external_id]?.action === filter);
  const currency = preview?.roadmap.currency || 'USD';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 md:p-8" onClick={onClose}>
      <div className="bg-navy-900 border border-navy-600 rounded-xl w-full max-w-5xl max-h-[92vh] flex flex-col"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-navy-600">
          <div>
            <h3 className="text-heading font-semibold">Import a roadmap{accountName ? ` into ${accountName}` : ''}</h3>
            <p className="text-xs text-navy-400">The AI Transformation Roadmap deck (.html) or a roadmap package (.json). Nothing is saved until you click Import.</p>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-heading"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Step 1 — file */}
          {!done && (
            <label className="flex items-center gap-3 border border-dashed border-navy-500 rounded-lg p-4 cursor-pointer hover:bg-navy-800/60">
              <FileJson className="w-6 h-6 text-navy-400" />
              <div className="flex-1">
                <div className="text-sm text-heading">{fileName || 'Choose the roadmap deck or package'}</div>
                <div className="text-[11px] text-navy-500">AITR deck <code>.html</code> as published, or an <code>aivr.roadmap</code> v1 package <code>.json</code> (ROADMAP_PACKAGE.md).</div>
              </div>
              <span className="inline-flex items-center gap-1 text-xs rounded border border-navy-600 px-2.5 py-1 text-navy-300">
                <Upload className="w-3.5 h-3.5" /> {busy === 'preview' ? 'Reading…' : fileName ? 'Choose another' : 'Choose file'}
              </span>
              <input type="file" accept=".html,.htm,text/html,.json,application/json" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ''; }} />
            </label>
          )}

          {err && (
            <div className="border border-rose-600/40 bg-rose-600/10 rounded-lg p-3 text-sm text-rose-400">
              {err}
              {errList.length > 0 && <ul className="list-disc ml-5 mt-1 text-xs">{errList.slice(0, 12).map((x, i) => <li key={i}>{x}</li>)}</ul>}
            </div>
          )}

          {done && (
            <div className="border border-emerald-600/40 bg-emerald-600/10 rounded-lg p-4 text-sm text-navy-200 space-y-1">
              <div className="flex items-center gap-2 text-emerald-500 font-semibold"><Check className="w-4 h-4" /> Roadmap imported</div>
              <div>{done.mapped} mapped to the catalog · {done.created} created · {done.reused} refreshed from a previous import · {done.skipped} skipped</div>
              {done.dropped > 0 && <div>{done.dropped} use case{done.dropped !== 1 ? 's are' : ' is'} no longer on the roadmap. They stay in the portfolio, marked <i>dropped</i>, until you remove them.</div>}
              {done.created > 0 && <div className="text-xs text-navy-400">New use cases were linked to {done.data_needs_linked} catalog data assets ({done.data_needs_unresolved} data needs did not match a catalog asset). Open a new use case and use <b>✦ Re-map with agent</b> to complete its data mapping.</div>}
            </div>
          )}

          {/* Step 2 — review */}
          {preview && !done && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Roadmap" value={preview.roadmap.title || preview.roadmap.id}
                  sub={`${preview.roadmap.version ? `Version ${preview.roadmap.version} · ` : ''}${preview.generator.name}`} />
                <Stat label="Use cases" value={String(preview.counts.use_cases)} sub={`${preview.counts.pillars} pillars`} />
                <Stat label="Roadmap value" value={money(preview.counts.total_value, currency)} sub="annual, base case" />
                <Stat label="Changes" value={preview.diff.first_import ? 'First import'
                  : `+${preview.diff.added.length} · ~${preview.diff.changed.length} · −${preview.diff.removed.length}`}
                  sub={preview.diff.first_import ? undefined : 'added · changed · removed'} />
              </div>
              {preview.source === 'deck' && (
                <div className="text-xs text-navy-400">
                  Read from the deck: pillars, stages, workstreams, data needs and each use case's description, priority, plan and gross annual value.
                  The deck's other content is not imported, and the file itself is not stored.{' '}
                  <button onClick={downloadPackage} className="text-info-500 hover:underline">Download what was read (.json)</button>
                </div>
              )}
              {preview.replaces && (
                <Note>This business unit already has the roadmap <b>{preview.replaces.title || preview.replaces.roadmap_id}</b>. Importing this one makes it the current roadmap; use cases only on the old one are marked dropped (never deleted).</Note>
              )}
              {preview.industry_note && <Note>{preview.industry_note}</Note>}
              {!preview.diff.first_import && preview.diff.removed.length > 0 && (
                <Note>No longer on the roadmap: {preview.diff.removed.join(', ')}. They will be marked dropped.</Note>
              )}
              {preview.warnings.length > 0 && (
                <details className="text-xs text-warning-500">
                  <summary className="cursor-pointer">{preview.warnings.length} warning{preview.warnings.length !== 1 ? 's' : ''} (the import will still work)</summary>
                  <ul className="list-disc ml-5 mt-1 text-navy-400">{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </details>
              )}

              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center rounded-lg bg-navy-800 p-0.5 text-xs">
                  {(['all', 'map', 'create', 'skip'] as const).map((f) => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`px-2.5 py-1 rounded-md font-medium ${filter === f ? 'bg-navy-700 text-heading' : 'text-navy-400 hover:text-heading'}`}>
                      {f === 'all' ? `All ${preview.matches.length}` : f === 'map' ? `Map ${counts.map}` : f === 'create' ? `Create ${counts.create}` : `Skip ${counts.skip}`}
                    </button>
                  ))}
                </div>
                <button onClick={askAi} disabled={busy != null || counts.create === 0}
                  title="Ask the model to find catalog matches for the use cases marked Create"
                  className="inline-flex items-center gap-1 text-xs rounded border border-info-600/40 text-info-500 bg-info-600/10 px-3 py-1.5 hover:bg-info-600/20 disabled:opacity-40">
                  <Sparkles className="w-3.5 h-3.5" /> {busy === 'ai' ? 'Asking the model…' : 'Suggest matches with AI'}
                </button>
              </div>
              {aiNote && <div className="text-xs text-navy-400">{aiNote}</div>}

              <div className="border border-navy-600 rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-navy-400 text-xs bg-navy-800/60">
                    <th className="text-left p-2">Roadmap use case</th>
                    <th className="text-left p-2 w-24">Priority</th>
                    <th className="text-right p-2 w-24">Value</th>
                    <th className="text-left p-2 w-[22rem]">In this app</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((m) => {
                      const c = choices[m.external_id];
                      const value = c?.action === 'map' && c.use_case_id != null ? String(c.use_case_id) : c?.action || 'create';
                      const candIds = new Set(m.candidates.map((x) => x.use_case_id));
                      const extra = c?.action === 'map' && c.use_case_id != null && !candIds.has(c.use_case_id) ? c.use_case_id : null;
                      return (
                        <tr key={m.external_id} className="border-t border-navy-600/50 align-top">
                          <td className="p-2">
                            <div className="text-heading">{m.name}
                              {addedIds.has(m.external_id) && <Badge tone="info">new in this version</Badge>}
                              {changedIds.has(m.external_id) && <Badge tone="warning">changed</Badge>}
                              {m.previously_imported && <Badge tone="muted">imported before</Badge>}
                            </div>
                            {m.summary && <div className="text-[11px] text-navy-500 mt-0.5 line-clamp-2">{m.summary}</div>}
                            {m.pillar_ids.length > 0 && <div className="text-[11px] text-navy-400 mt-0.5">{m.pillar_ids.map((p) => pillarName.get(p) || p).join(' · ')}</div>}
                          </td>
                          <td className="p-2 text-xs text-navy-300 capitalize">{m.priority_tier || '—'}</td>
                          <td className="p-2 text-right text-xs text-heading">{money(m.value_base, currency)}</td>
                          <td className="p-2">
                            <select value={value} onChange={(e) => setChoice(m.external_id, e.target.value)}
                              className={`w-full rounded-lg border bg-navy-800 px-2 py-1.5 text-xs text-heading ${duplicates.has(m.external_id) ? 'border-rose-500' : 'border-navy-600'}`}>
                              <optgroup label="Suggested">
                                {m.candidates.map((cand) => (
                                  <option key={cand.use_case_id} value={String(cand.use_case_id)}>
                                    Map → {cand.title} ({cand.reason === 'similar title' ? `${Math.round(cand.score * 100)}% similar` : cand.reason})
                                  </option>
                                ))}
                                <option value="create">Create as a new use case</option>
                                <option value="skip">Skip — don't import</option>
                              </optgroup>
                              {extra != null && <option value={String(extra)}>Map → {titleOf.get(extra) || `#${extra}`}</option>}
                              <optgroup label="Any catalog use case">
                                {catalog.filter((x) => !candIds.has(x.id)).map((x) => (
                                  <option key={x.id} value={String(x.id)}>Map → {x.title}</option>
                                ))}
                              </optgroup>
                            </select>
                            {aiWhy[m.external_id] && <div className="text-[11px] text-info-500 mt-1">✦ {aiWhy[m.external_id]}</div>}
                            {duplicates.has(m.external_id) && <div className="text-[11px] text-rose-400 mt-1">Another roadmap use case is mapped to the same catalog use case.</div>}
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-xs text-navy-500">Nothing here.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-navy-600">
          <span className="text-xs text-navy-400">
            {preview && !done ? `${counts.map} map · ${counts.create} create · ${counts.skip} skip` : ''}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-sm text-navy-400 hover:text-heading px-3 py-1.5">{done ? 'Close' : 'Cancel'}</button>
            {preview && !done && (
              <button onClick={apply} disabled={busy != null || duplicates.size > 0 || counts.map + counts.create === 0}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy === 'apply' ? 'Importing…' : `Import ${counts.map + counts.create} use cases`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-navy-600 rounded-lg p-3 bg-navy-800/40 min-w-0">
      <div className="text-xs text-navy-400">{label}</div>
      <div className="text-base font-bold text-heading mt-1 truncate" title={value}>{value}</div>
      {sub && <div className="text-[11px] text-navy-500 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs text-warning-500 border border-warning-600/40 bg-warning-600/10 rounded-lg p-3">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><div className="text-navy-300">{children}</div>
    </div>
  );
}
function Badge({ tone, children }: { tone: 'info' | 'warning' | 'muted'; children: React.ReactNode }) {
  const cls = tone === 'info' ? 'text-info-500 border-info-600/40' : tone === 'warning' ? 'text-warning-500 border-warning-600/40' : 'text-navy-400 border-navy-600';
  return <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded border align-middle ${cls}`}>{children}</span>;
}
