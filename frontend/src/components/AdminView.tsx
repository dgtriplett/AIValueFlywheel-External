import React, { useEffect, useState } from 'react';
import { api, type FeatureFlagAdminRow, type FeatureFlagState } from '../lib/api';
import { useFeatureFlags } from '../lib/featureFlags';
import { UseCaseEditor } from './UseCaseEditor';

/**
 * Admin — cross-account portal (admins only). A SEPARATE experience from the per-account
 * Assess/Operate: it shows every customer/user/assessment, not the active account's data.
 * Wired to the real /api/admin/* endpoints (the old grafted AdminPage called the
 * assessment app's endpoints that don't exist here and 404'd — this replaces it).
 */
export function AdminView() {
  const [tab, setTab] = useState<'setup' | 'accounts' | 'assessments' | 'features' | 'use cases' | 'datasets' | 'assumptions' | 'trends' | 'admins'>('accounts');
  const [ov, setOv] = useState<any>(null);
  const [assess, setAssess] = useState<any[]>([]);
  const [flags, setFlags] = useState<FeatureFlagAdminRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [newAdmin, setNewAdmin] = useState('');
  const ff = useFeatureFlags();

  const deleteAccount = async (a: any) => {
    const hard = window.confirm(`Delete business unit "${a.name}"?\n\nOK = permanently DELETE all its data (assessments, portfolio, status).\nCancel = keep it.`);
    if (!hard) return;
    if (!window.confirm(`This permanently deletes "${a.name}" and everything captured for it. This cannot be undone. Proceed?`)) return;
    try { await api.deleteAccount(a.id, true); await load(); } catch (e: any) { setErr(e?.message || String(e)); }
  };
  const load = async () => {
    setErr(null);
    try {
      const [o, a, f] = await Promise.all([
        api.adminOverview(),
        api.adminAssessments().catch(() => ({ assessments: [] })),
        api.adminListFeatureFlags().catch(() => [] as FeatureFlagAdminRow[]),
      ]);
      setOv(o); setAssess(a.assessments || []); setFlags(f || []);
    } catch (e: any) { setErr(e?.message || String(e)); }
  };
  useEffect(() => { void load(); }, []);

  const setFlagState = async (key: string, state: FeatureFlagState) => {
    setFlags(prev => prev.map(fl => fl.key === key ? { ...fl, state } : fl));  // optimistic
    try {
      await api.adminUpdateFeatureFlag(key, state);
      ff.refresh();  // re-resolve flags app-wide so betas light up / hide immediately
    } catch (e: any) { setErr(String(e)); await load(); }
  };

  const addAdmin = async () => {
    const email = newAdmin.trim(); if (!email) return;
    try { await api.adminAddAdmin(email); setNewAdmin(''); await load(); } catch (e: any) { setErr(String(e)); }
  };
  const removeAdmin = async (email: string) => {
    if (!window.confirm(`Remove admin ${email}?`)) return;
    try { await api.adminRemoveAdmin(email); await load(); } catch (e: any) { setErr(String(e)); }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 w-full">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <h1 className="text-2xl font-bold text-heading">Admin portal</h1>
        <span className="text-xs px-2 py-1 rounded-full border border-info-600/40 bg-info-600/10 text-info-500">Cross-customer · admin only</span>
      </div>
      <p className="text-sm text-navy-400 mb-5">Across all customers and users — separate from your own accounts in Assess/Operate.</p>

      <div className="flex items-center rounded-lg bg-navy-800 p-0.5 text-sm mb-4 w-fit">
        {(['setup', 'accounts', 'assessments', 'features', 'use cases', 'datasets', 'assumptions', 'trends', 'admins'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1 rounded-md capitalize font-medium ${tab === t ? 'bg-navy-700 text-heading shadow-sm' : 'text-navy-400 hover:text-heading'}`}>{t === 'accounts' ? 'business units' : t}</button>
        ))}
      </div>
      {err && <div className="text-rose-500 text-sm mb-3">{err}</div>}

      {tab === 'accounts' && ov && (
        <>
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <p className="text-xs text-navy-400">
              Business units, their members, and assessments. Download a full backup of every
              table before an upgrade; restore it with <code>scripts/restore.py</code>.
            </p>
            <a href="/api/admin/backup" download
              className="text-xs rounded border border-navy-600 text-navy-300 px-3 py-1.5 hover:bg-navy-700 whitespace-nowrap">
              ⬇ Download backup</a>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Tile label="Business units" value={String(ov.totals?.accounts ?? ov.accounts?.length ?? 0)} />
            <Tile label="Users" value={String(ov.totals?.users ?? ov.users?.length ?? 0)} />
            <Tile label="Admins" value={String(ov.admins?.length ?? 0)} />
            <Tile label="Assessments" value={String(ov.accounts?.reduce((s: number, a: any) => s + (a.assessments || 0), 0) ?? 0)} />
          </div>
          <div className="overflow-x-auto border border-navy-600 rounded-lg">
            <table className="w-full text-sm">
              <thead><tr className="text-navy-400 text-xs">
                {['Customer', 'Utility', 'Members', 'Assessments', 'Portfolio', 'Last promoted', ''].map((h) => <th key={h} className="text-left p-2">{h}</th>)}
              </tr></thead>
              <tbody>
                {(ov.accounts || []).map((a: any) => (
                  <tr key={a.id} className="border-t border-navy-600/50">
                    <td className="p-2 text-heading">{a.name}</td>
                    <td className="p-2 text-navy-300">{a.utility_type || '—'}</td>
                    <td className="p-2 text-navy-300">{a.members}</td>
                    <td className="p-2 text-navy-300">{a.assessments} ({a.submitted} submitted)</td>
                    <td className="p-2 text-navy-300">{a.portfolio}</td>
                    <td className="p-2 text-navy-300">{a.last_promoted ? new Date(a.last_promoted).toLocaleDateString() : '—'}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <button onClick={() => deleteAccount(a)} className="text-rose-500 text-xs hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(ov.accounts || []).length === 0 && <div className="p-4 text-navy-400 text-sm text-center">No customers.</div>}
          </div>
        </>
      )}

      {tab === 'assessments' && (
        <Table head={['Account', 'Status', 'Label', 'Score', 'Phase', 'By', 'When']}
          rows={assess.map((x) => [x.account_name, x.status, x.label || '—', x.overall_score ?? '—', x.current_phase ?? '—', x.created_by || '—', x.submitted_at ? new Date(x.submitted_at).toLocaleDateString() : (x.created_at ? new Date(x.created_at).toLocaleDateString() : '—')])} />
      )}

      {tab === 'features' && (
        <div className="max-w-3xl">
          <p className="text-sm text-navy-400 mb-4">
            Turn beta features on for everyone, limit them to admins for dogfooding, or switch them off.
            Changes apply immediately across the app for the matching audience.
          </p>
          {flags.length === 0 ? (
            <div className="p-4 text-navy-400 text-sm border border-navy-600 rounded-lg">No feature flags registered.</div>
          ) : (
            Object.entries(flags.reduce((acc: Record<string, FeatureFlagAdminRow[]>, fl) => {
              (acc[fl.category || 'Beta'] ||= []).push(fl); return acc;
            }, {})).map(([cat, rows]) => (
              <div key={cat} className="mb-5">
                <div className="text-xs uppercase tracking-wide text-navy-500 mb-2">{cat}</div>
                <div className="border border-navy-600 rounded-lg divide-y divide-navy-600/50">
                  {rows.map((fl) => (
                    <div key={fl.key} className="flex items-start justify-between gap-4 px-3 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-heading">{fl.name}</div>
                        <div className="text-xs text-navy-400 mt-0.5">{fl.description}</div>
                        <div className="text-[10px] text-navy-600 mt-1 font-mono">{fl.key}</div>
                      </div>
                      <div className="flex items-center rounded-lg bg-navy-800 p-0.5 text-xs shrink-0">
                        {(['off', 'admin', 'on'] as const).map((st) => (
                          <button key={st} onClick={() => setFlagState(fl.key, st)}
                            className={`px-2.5 py-1 rounded-md font-medium capitalize ${fl.state === st
                              ? (st === 'on' ? 'bg-emerald-600 text-white' : st === 'admin' ? 'bg-info-600 text-white' : 'bg-navy-600 text-heading')
                              : 'text-navy-400 hover:text-heading'}`}>
                            {st === 'on' ? 'Everyone' : st === 'admin' ? 'Admins' : 'Off'}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'setup' && <SetupTab />}
      {tab === 'use cases' && <UseCasesTab />}
      {tab === 'datasets' && <DatasetsTab />}
      {tab === 'assumptions' && <AssumptionsTab />}
      {tab === 'trends' && <TrendsTab />}

      {tab === 'admins' && ov && (
        <div className="max-w-lg">
          <div className="flex gap-2 mb-3">
            <input value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} placeholder="name@yourcompany.com"
              className="flex-1 rounded-lg border border-navy-600 bg-navy-800 px-3 py-1.5 text-sm text-heading" />
            <button onClick={addAdmin} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-heading hover:bg-emerald-700">Add admin</button>
          </div>
          <div className="border border-navy-600 rounded-lg divide-y divide-navy-600/50">
            {(ov.admins || []).map((e: string) => (
              <div key={e} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-heading">{e}</span>
                <button onClick={() => removeAdmin(e)} className="text-rose-500 text-xs hover:underline">Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="border border-navy-600 rounded-lg p-3 bg-navy-800/40"><div className="text-xs text-navy-400">{label}</div><div className="text-xl font-bold text-heading mt-1">{value}</div></div>;
}

const INPUT = 'rounded-lg border border-navy-600 bg-navy-800 px-3 py-1.5 text-sm text-heading';
const UC_STATUSES = ['not_started', 'scoping', 'in_progress', 'live', 'value_realized'];

// --- Use Cases: catalog editor (add / edit / delete) -----------------------
/** Install health: storage, schema, catalog, warehouse, model endpoints, and the
 *  optional discovery / Genie features — each with the exact fix when it fails. */
function SetupTab() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.setupStatus>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = async (recheck = false) => {
    setBusy(true); setErr(null);
    try { if (recheck) await api.setupRecheck(); setData(await api.setupStatus()); }
    catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const grants = Array.from(new Set((data?.checks || []).flatMap((c) => c.grants || [])));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-heading">
          {data ? (data.ready ? '✓ Ready — every required check passes.' : '✕ Not ready — fix the first failing required check.') : 'Checking…'}
        </div>
        <button onClick={() => load(true)} disabled={busy}
          className="text-xs rounded border border-navy-600 text-navy-300 px-3 py-1.5 hover:bg-navy-700 disabled:opacity-50">
          {busy ? 'Checking…' : 'Re-check'}</button>
      </div>
      {err && <div className="text-rose-500 text-sm">{err}</div>}
      <div className="border border-navy-600 rounded-lg divide-y divide-navy-700">
        {(data?.checks || []).map((c) => (
          <div key={c.name} className="p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className={c.ok ? 'text-emerald-500' : c.required ? 'text-rose-500' : 'text-warning-500'}>{c.ok ? '✓' : '✕'}</span>
              <span className="text-heading font-medium">{c.label}</span>
              {!c.required && <span className="text-[10px] text-navy-500 uppercase">optional</span>}
              <span className="text-navy-400 text-xs">{c.detail}</span>
            </div>
            {!c.ok && c.fix && <div className="text-xs text-navy-300 mt-1 ml-5">{c.fix}</div>}
          </div>
        ))}
      </div>
      {grants.length > 0 && (
        <div>
          <div className="text-xs text-navy-400 mb-1">GRANT statements for a catalog owner or metastore admin:</div>
          <pre className="text-[11px] bg-navy-800 border border-navy-600 rounded p-2 overflow-x-auto">{grants.map((g) => g + ';').join('\n')}</pre>
        </div>
      )}
    </div>
  );
}

function UseCasesTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [lobName, setLobName] = useState<Record<number, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null | undefined>(undefined); // undefined=closed, null=new, obj=edit

  const load = async () => {
    setErr(null);
    try { setRows((await api.useCases()) || []); }
    catch (e: any) { setErr(e?.message || String(e)); setRows([]); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    api.lobs().then((ls: any[]) => setLobName(Object.fromEntries((ls || []).map((l) => [l.id, l.name]))))
      .catch(() => {});
  }, []);

  const del = async (u: any) => {
    if (!window.confirm(`Delete use case "${u.title}"?`)) return;
    try { await api.deleteUseCase(u.id); await load(); } catch (e: any) { setErr(String(e)); }
  };

  return (
    <div>
      {err && <div className="text-rose-500 text-sm mb-3">{err}</div>}
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-navy-400">Edit the catalog: datasets required (raw + product) and use-case dependencies, via search — no ids to type.</p>
        <button onClick={() => setEditing(null)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">+ New use case</button>
      </div>
      {rows === null ? <div className="text-navy-400 text-sm">Loading…</div> : (
        <div className="overflow-x-auto border border-navy-600 rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="text-navy-400 text-xs">{['Use case', 'Phase', 'Domain', 'Category', 'Complexity', ''].map((h) => <th key={h} className="text-left p-2">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((u: any) => (
                <tr key={u.id} className="border-t border-navy-600/50">
                  <td className="p-2 text-heading">{u.title}</td>
                  <td className="p-2 text-navy-300">{u.phase ?? '—'}</td>
                  <td className="p-2 text-navy-300">{lobName[u.lob_id] || u.domain || '—'}</td>
                  <td className="p-2 text-navy-300">{u.category || u.sub_vertical || '—'}</td>
                  <td className="p-2 text-navy-300">{u.effort_tshirt || u.complexity || '—'}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(u)} className="text-info-400 text-xs hover:underline mr-3">Edit</button>
                    <button onClick={() => del(u)} className="text-rose-500 text-xs hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="p-4 text-navy-400 text-sm text-center">No use cases.</div>}
        </div>
      )}
      {editing !== undefined && (
        <UseCaseEditor useCase={editing} onClose={() => setEditing(undefined)} onSaved={load} />
      )}
    </div>
  );
}

// --- Datasets: manage raw datasets + curated data products -----------------
function DsBadge({ tier }: { tier: string }) {
  return <span className={`text-[9px] px-1.5 py-0.5 rounded border ${tier === 'product'
    ? 'text-info-500 border-info-600/40 bg-info-600/10' : 'text-navy-400 border-navy-600'}`}>{tier === 'product' ? 'product' : 'raw'}</span>;
}

function DatasetsTab() {
  const [assets, setAssets] = useState<any[] | null>(null);
  const [lobs, setLobs] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'raw' | 'product'>('all');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [std, setStd] = useState(false);
  const blank = { module: '', source_category: '', description: '', owning_lob_id: '', tier: 'raw', curate_effort: 'M', fed_by: [] as number[] };
  const [form, setForm] = useState<any>(blank);
  const [feedQ, setFeedQ] = useState('');

  const load = async () => {
    setErr(null);
    try { setAssets((await api.dataAssets()) || []); } catch (e: any) { setErr(e?.message || String(e)); setAssets([]); }
  };
  useEffect(() => { void load(); api.lobs().then(setLobs).catch(() => {}); }, []);

  const raws = (assets || []).filter((a) => a.tier !== 'product');
  const byId: Record<number, any> = Object.fromEntries((assets || []).map((a) => [a.id, a]));
  const needle = q.trim().toLowerCase();
  const rows = (assets || [])
    .filter((a) => filter === 'all' || (filter === 'product' ? a.tier === 'product' : a.tier !== 'product'))
    .filter((a) => !needle || (a.module || '').toLowerCase().includes(needle) || (a.source_category || '').toLowerCase().includes(needle))
    .sort((a, b) => (a.source_category || '').localeCompare(b.source_category || '') || (a.module || '').localeCompare(b.module || ''));

  const standardize = async () => {
    if (!form.module.trim()) return;
    setStd(true); setErr(null);
    try {
      const r = await api.standardizeAsset({ module: form.module, description: form.description, source_category: form.source_category, tier: form.tier });
      const s = r.suggestion;
      setForm((f: any) => ({ ...f, module: s.module || f.module, description: s.description || f.description,
        source_category: s.source_category || f.source_category, tier: s.tier || f.tier, curate_effort: s.curate_effort || f.curate_effort }));
    } catch (e: any) { setErr(e?.message || String(e)); } finally { setStd(false); }
  };
  const create = async () => {
    if (!form.module.trim() || !form.source_category.trim()) { setErr('Module and source category are required'); return; }
    setBusy(true); setErr(null);
    try {
      await api.createDataAsset({
        source_category: form.source_category, module: form.module, description: form.description,
        owning_lob_id: form.owning_lob_id ? Number(form.owning_lob_id) : null,
        tier: form.tier, curate_effort: form.tier === 'product' ? form.curate_effort : null,
        fed_by: form.tier === 'product' ? form.fed_by : [],
      });
      setForm(blank); setAdding(false); await load();
    } catch (e: any) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };
  const flipTier = async (a: any) => {
    const t = a.tier === 'product' ? 'raw' : 'product';
    try { await api.setAssetTier(a.id, t, t === 'product' ? (a.curate_effort || 'M') : null); await load(); } catch (e: any) { setErr(String(e)); }
  };
  const editFeeds = async (a: any) => {
    const cur = (a.fed_by || []).map((r: number) => byId[r]?.module).filter(Boolean).join(', ');
    const input = window.prompt(`Comma-separated raw dataset names that feed "${a.module}":`, cur);
    if (input === null) return;
    const names = input.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const ids = raws.filter((r) => names.includes((r.module || '').toLowerCase())).map((r) => r.id);
    try { await api.setAssetFeeds(a.id, ids); await load(); } catch (e: any) { setErr(String(e)); }
  };
  const feedMatches = raws.filter((r) => feedQ && (r.module || '').toLowerCase().includes(feedQ.toLowerCase()) && !form.fed_by.includes(r.id)).slice(0, 6);

  return (
    <div>
      {err && <div className="text-rose-500 text-sm mb-3">{err}</div>}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center rounded-lg bg-navy-800 p-0.5 text-sm">
          {(['all', 'raw', 'product'] as const).map((t) => (
            <button key={t} onClick={() => setFilter(t)}
              className={`px-3 py-1 rounded-md capitalize font-medium ${filter === t ? 'bg-navy-700 text-heading shadow-sm' : 'text-navy-400 hover:text-heading'}`}>{t === 'all' ? 'All' : t === 'raw' ? 'Raw' : 'Products'}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="rounded-lg border border-navy-600 bg-navy-800 px-3 py-1.5 text-sm text-heading w-48" />
          <button onClick={() => setAdding((s) => !s)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">+ Add</button>
        </div>
      </div>

      {adding && (
        <div className="border border-navy-600 rounded-lg p-3 bg-navy-800/40 mb-3 space-y-2">
          <div className="grid md:grid-cols-2 gap-2">
            <input value={form.module} onChange={(e) => setForm({ ...form, module: e.target.value })} placeholder="Module / dataset name" className="rounded-lg border border-navy-600 bg-navy-900 px-3 py-1.5 text-sm text-heading" />
            <input value={form.source_category} onChange={(e) => setForm({ ...form, source_category: e.target.value })} placeholder="Source category (e.g. Meter/AMI/MDM)" className="rounded-lg border border-navy-600 bg-navy-900 px-3 py-1.5 text-sm text-heading" />
            <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })} className="rounded-lg border border-navy-600 bg-navy-900 px-3 py-1.5 text-sm text-heading">
              <option value="raw">Raw dataset</option><option value="product">Data product</option>
            </select>
            <select value={form.owning_lob_id} onChange={(e) => setForm({ ...form, owning_lob_id: e.target.value })} className="rounded-lg border border-navy-600 bg-navy-900 px-3 py-1.5 text-sm text-heading">
              <option value="">Owning LOB…</option>{lobs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" rows={2} className="w-full rounded-lg border border-navy-600 bg-navy-900 px-3 py-1.5 text-sm text-heading" />
          {form.tier === 'product' && (
            <div className="border border-navy-600 rounded-lg p-2 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-navy-500">Curation effort</span>
                <select value={form.curate_effort} onChange={(e) => setForm({ ...form, curate_effort: e.target.value })} className="rounded border border-navy-600 bg-navy-900 px-2 py-0.5 text-xs text-heading">
                  {['S', 'M', 'L', 'XL'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="relative">
                <input value={feedQ} onChange={(e) => setFeedQ(e.target.value)} placeholder="Built from raw datasets — search to add…" className="w-full rounded border border-navy-600 bg-navy-900 px-2 py-1 text-xs text-heading" />
                {feedMatches.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-navy-900 border border-navy-600 rounded max-h-40 overflow-y-auto">
                    {feedMatches.map((r) => (
                      <button key={r.id} onClick={() => { setForm((f: any) => ({ ...f, fed_by: [...f.fed_by, r.id] })); setFeedQ(''); }}
                        className="w-full text-left px-2 py-1 text-xs text-navy-300 hover:bg-navy-700">{r.module} <span className="text-navy-600">· {r.source_category}</span></button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {form.fed_by.map((id: number) => (
                  <span key={id} className="text-[11px] bg-navy-800 border border-navy-600 rounded px-2 py-0.5 flex items-center gap-1">
                    {byId[id]?.module || `#${id}`}
                    <button onClick={() => setForm((f: any) => ({ ...f, fed_by: f.fed_by.filter((x: number) => x !== id) }))} className="text-rose-500">×</button>
                  </span>
                ))}
                {form.fed_by.length === 0 && <span className="text-[11px] text-navy-500">No feeders yet.</span>}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <button onClick={standardize} disabled={std || !form.module.trim()} className="text-xs px-2 py-1 rounded border border-info-600/40 text-info-500 hover:bg-info-600/10 disabled:opacity-50">{std ? 'Standardizing…' : '🪄 Standardize'}</button>
            <button onClick={create} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? 'Adding…' : `Add ${form.tier === 'product' ? 'data product' : 'raw dataset'}`}</button>
          </div>
        </div>
      )}

      {assets === null ? <div className="text-navy-400 text-sm">Loading…</div> : (
        <div className="overflow-x-auto border border-navy-600 rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="text-navy-400 text-xs">{['Dataset', 'Tier', 'Source category', 'Built from', 'Curate', ''].map((h) => <th key={h} className="text-left p-2">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-t border-navy-600/50">
                  <td className="p-2 text-heading">{a.module}</td>
                  <td className="p-2"><DsBadge tier={a.tier} /></td>
                  <td className="p-2 text-navy-300">{a.source_category}</td>
                  <td className="p-2 text-navy-400 text-xs">{a.tier === 'product' ? ((a.fed_by || []).map((r: number) => byId[r]?.module).filter(Boolean).join(', ') || '—') : `feeds ${(a.feeds || []).length}`}</td>
                  <td className="p-2 text-navy-300">{a.tier === 'product' ? (a.curate_effort || '—') : '—'}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <button onClick={() => flipTier(a)} className="text-info-400 text-xs hover:underline mr-3">Make {a.tier === 'product' ? 'raw' : 'product'}</button>
                    {a.tier === 'product' && <button onClick={() => editFeeds(a)} className="text-navy-300 text-xs hover:underline">Edit feeds</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="p-4 text-navy-400 text-sm text-center">No datasets{needle ? ' match your search' : ''}.</div>}
        </div>
      )}
    </div>
  );
}

// --- Assumptions: custom value-model fields --------------------------------
function AssumptionsTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blank = { label: '', value: '', unit: '', category: '' };
  const [form, setForm] = useState<any>(blank);

  const load = async () => {
    setErr(null);
    try { setRows(await api.listValueFields()); }
    catch (e: any) { setErr(e?.message || String(e)); setRows([]); }
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (!form.label.trim()) { setErr('Label is required.'); return; }
    setBusy(true); setErr(null);
    try {
      await api.createValueField({
        label: form.label.trim(), value: Number(form.value) || 0,
        unit: form.unit || null, category: form.category || null,
      });
      setForm(blank); await load();
    } catch (e: any) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  };
  const save = async (r: any) => {
    try {
      await api.updateValueField(r.key, {
        label: r.label, value: Number(r.value) || 0, unit: r.unit || null,
        category: r.category || null, description: r.description || null,
      });
      await load();
    } catch (e: any) { setErr(String(e)); }
  };
  const del = async (r: any) => {
    if (!window.confirm(`Delete assumption "${r.label}"?`)) return;
    try { await api.adminDeleteAssumptionField(r.key); await load(); } catch (e: any) { setErr(String(e)); }
  };
  const patch = (key: string, field: string, val: any) =>
    setRows((prev) => prev ? prev.map((r) => r.key === key ? { ...r, [field]: val } : r) : prev);

  const byCat: Record<string, any[]> = {};
  for (const r of (rows || [])) (byCat[r.category || 'Other'] ||= []).push(r);

  return (
    <div className="max-w-4xl">
      <p className="text-sm text-navy-400 mb-3">Value-model inputs used across the assessment's $ math. Add customer-specific ones, tune values, or remove.</p>
      {err && <div className="text-rose-500 text-sm mb-3">{err}</div>}
      <div className="border border-navy-600 rounded-lg p-3 bg-navy-800/40 mb-4 grid md:grid-cols-4 gap-2 items-end">
        <input className={INPUT} placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <input className={INPUT} placeholder="Value" type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
        <input className={INPUT} placeholder="Unit (e.g. $M)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        <div className="flex gap-2">
          <input className={`${INPUT} flex-1`} placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <button onClick={create} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Add</button>
        </div>
      </div>
      {rows === null ? <div className="text-navy-400 text-sm">Loading…</div> :
        Object.entries(byCat).sort().map(([cat, list]) => (
          <div key={cat} className="mb-4">
            <div className="text-xs uppercase tracking-wide text-navy-500 mb-2">{cat}</div>
            <div className="border border-navy-600 rounded-lg divide-y divide-navy-600/50">
              {list.map((r) => (
                <div key={r.key} className="flex items-center gap-2 px-3 py-2">
                  <input className={`${INPUT} flex-1`} value={r.label} onChange={(e) => patch(r.key, 'label', e.target.value)} />
                  <input className={`${INPUT} w-28`} type="number" value={r.value} onChange={(e) => patch(r.key, 'value', e.target.value)} />
                  <input className={`${INPUT} w-24`} value={r.unit || ''} placeholder="unit" onChange={(e) => patch(r.key, 'unit', e.target.value)} />
                  <button onClick={() => save(r)} className="text-emerald-500 text-xs hover:underline">Save</button>
                  <button onClick={() => del(r)} className="text-rose-500 text-xs hover:underline">Delete</button>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

// --- Trends: cross-account program rollup ----------------------------------
function TrendsTab() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.adminTrends().then(setD).catch((e) => setErr(e?.message || String(e))); }, []);
  if (err) return <div className="text-rose-500 text-sm">{err}</div>;
  if (!d) return <div className="text-navy-400 text-sm">Loading…</div>;

  const Bars = ({ title, data }: { title: string; data: Record<string, number> }) => {
    const entries = Object.entries(data || {});
    const max = Math.max(1, ...entries.map(([, v]) => v));
    return (
      <div className="border border-navy-600 rounded-lg p-3 bg-navy-800/40">
        <div className="text-xs uppercase tracking-wide text-navy-500 mb-2">{title}</div>
        {entries.length === 0 ? <div className="text-navy-400 text-sm">No data.</div> : entries.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 mb-1">
            <span className="text-xs text-navy-300 w-24 shrink-0 truncate">{k}</span>
            <div className="flex-1 bg-navy-700 rounded h-4"><div className="bg-info-600 h-4 rounded" style={{ width: `${(v / max) * 100}%` }} /></div>
            <span className="text-xs text-heading w-8 text-right">{v}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="max-w-4xl space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Assessments" value={String(d.total_assessments ?? 0)} />
        <Tile label="Submitted" value={String(d.submitted ?? 0)} />
        <Tile label="Avg score" value={d.avg_score != null ? String(d.avg_score) : '—'} />
        <Tile label="Months active" value={String(Object.keys(d.submissions_by_month || {}).length)} />
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <Bars title="Score distribution" data={d.score_buckets} />
        <Bars title="Phase distribution" data={d.phase_distribution} />
      </div>
      <Bars title="Submissions by month" data={d.submissions_by_month} />
      <div className="border border-navy-600 rounded-lg p-3 bg-navy-800/40">
        <div className="text-xs uppercase tracking-wide text-navy-500 mb-2">Most-recommended use cases</div>
        {(d.top_recommended_use_cases || []).length === 0 ? <div className="text-navy-400 text-sm">No data.</div> :
          (d.top_recommended_use_cases || []).map((u: any, i: number) => (
            <div key={i} className="flex items-center justify-between py-1 text-sm">
              <span className="text-heading">{u.title}</span>
              <span className="text-navy-400 text-xs">{u.count}×</span>
            </div>
          ))}
      </div>
    </div>
  );
}
function Table({ head, rows }: { head: string[]; rows: any[][] }) {
  return (
    <div className="overflow-x-auto border border-navy-600 rounded-lg">
      <table className="w-full text-sm">
        <thead><tr className="text-navy-400 text-xs">{head.map((h) => <th key={h} className="text-left p-2">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-navy-600/50">{r.map((c, j) => <td key={j} className="p-2 text-heading">{String(c)}</td>)}</tr>)}</tbody>
      </table>
      {rows.length === 0 && <div className="p-4 text-navy-400 text-sm text-center">Nothing yet.</div>}
    </div>
  );
}
