import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { WhatIfGraph } from './WhatIfGraph';
import { ErrorBoundary } from './ErrorBoundary';
import { AuthorUseCaseModal } from './AuthorUseCaseModal';
import { RoadmapImportModal } from './RoadmapImportModal';
import type { PortfolioRow, RoadmapSummary, RoadmapUseCase } from '../lib/api';

/**
 * Operate — build and track the roadmap for the active business unit:
 *   Roadmap · Data · Value calibration · What-if · Discover & reconcile
 * The Roadmap tab is seeded by importing a roadmap package (RoadmapImportModal) and
 * grows with use cases added from the catalog or authored here. Everything is scoped
 * to the active business unit and defensively fetched.
 */
const READINESS_LABEL: Record<string, string> = {
  shovel_ready: 'Shovel-ready', awaiting_prerequisites: 'Awaiting prerequisites',
  nearly_ready: 'Nearly ready', blocked: 'Blocked',
};
const READINESS_COLOR: Record<string, string> = {
  shovel_ready: 'text-emerald-500 border-emerald-600/40 bg-emerald-600/10',
  awaiting_prerequisites: 'text-info-500 border-info-600/40 bg-info-600/10',
  nearly_ready: 'text-warning-500 border-warning-600/40 bg-warning-600/10',
  blocked: 'text-rose-500 border-rose-600/40 bg-rose-600/10',
};
const STATUS_COLOR: Record<string, string> = {
  governed: 'text-emerald-500 border-emerald-600/40 bg-emerald-600/10',
  curated: 'text-info-500 border-info-600/40 bg-info-600/10',
  landed: 'text-warning-500 border-warning-600/40 bg-warning-600/10',
  not_started: 'text-navy-500 border-navy-600',
};
function money(n?: number) {
  if (!n) return '—';
  return n >= 1 ? `$${n.toFixed(1)}M` : `$${(n * 1000).toFixed(0)}K`;
}

type Tab = 'roadmap' | 'data' | 'value' | 'whatif' | 'discovery';
const TAB_LABEL: Record<Tab, string> = {
  roadmap: 'Roadmap', data: 'Data', value: 'Value calibration',
  whatif: 'What-if', discovery: 'Discover & reconcile',
};

export function OperateView({ accountName }: { accountName?: string }) {
  const [tab, setTab] = useState<Tab>('roadmap');
  const tabs: Tab[] = ['roadmap', 'data', 'value', 'whatif', 'discovery'];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 w-full">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-heading">Operate — {accountName || 'roadmap'}</h1>
          <p className="text-sm text-navy-400">Build out the roadmap: what's ready to start, what's blocked and by which data, and the value realized.</p>
        </div>
        <div className="flex items-center rounded-lg bg-navy-800 p-0.5 text-sm flex-wrap">
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-md font-medium ${tab === t ? 'bg-navy-700 text-heading shadow-sm' : 'text-navy-400 hover:text-heading'}`}>
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      {tab === 'roadmap' && <RoadmapTab accountName={accountName} />}
      {tab === 'data' && <DataTab />}
      {tab === 'value' && <ValueTab />}
      {tab === 'whatif' && <WhatIfTab />}
      {tab === 'discovery' && <DiscoverReconcileTab />}
    </div>
  );
}

// --- shared bits -----------------------------------------------------------
function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-navy-600 rounded-lg p-3 bg-navy-800/40">
      <div className="text-xs text-navy-400">{label}</div>
      <div className="text-xl font-bold text-heading mt-1">{value}</div>
      {sub && <div className="text-[11px] text-navy-500 mt-0.5">{sub}</div>}
    </div>
  );
}
function Loading() { return <div className="text-navy-400 text-sm">Loading…</div>; }
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-navy-400 text-sm border border-navy-600 rounded-lg p-6 text-center">{children}</div>;
}
function useFetch<T>(fn: () => Promise<T>, deps: any[] = []): { data: T | null; loading: boolean; err: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true; setLoading(true); setErr(null);
    fn().then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setErr(e?.message || String(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading, err };
}

// --- Roadmap (the business unit's portfolio) --------------------------------
const TIER_LABEL: Record<string, string> = { now: 'Now', next: 'Next', later: 'Later' };
const TIER_COLOR: Record<string, string> = {
  now: 'text-emerald-500 border-emerald-600/40', next: 'text-info-500 border-info-600/40', later: 'text-navy-400 border-navy-600',
};

function RoadmapBanner({ summary, onImport }: { summary: RoadmapSummary | null; onImport: () => void }) {
  const r = summary?.roadmap;
  if (!summary) return null;
  if (!r) {
    return (
      <div className="border border-info-600/40 bg-info-600/10 rounded-lg p-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-heading font-semibold">Start from your roadmap</div>
          <div className="text-sm text-navy-300">Import the roadmap package your planning tool produced. Each use case lands here with its pillar, priority, value estimate and first-version plan, ready to track.</div>
        </div>
        <button onClick={onImport} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">Import roadmap</button>
      </div>
    );
  }
  const when = r.imported_at ? new Date(r.imported_at).toLocaleDateString() : '';
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-navy-300">
          <span className="text-heading font-semibold">{r.title || r.roadmap_id}</span>
          {r.version && <span className="text-navy-400"> · version {r.version}</span>}
          <span className="text-navy-500"> · imported {when}{r.imported_by ? ` by ${r.imported_by}` : ''}</span>
        </div>
        <button onClick={onImport} className="text-xs rounded border border-navy-600 text-navy-300 px-3 py-1.5 hover:bg-navy-700">⟳ Import a new version</button>
      </div>
      {summary.pillars.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {summary.pillars.map((p) => {
            const pct = p.use_cases ? Math.round((p.live / p.use_cases) * 100) : 0;
            return (
              <div key={p.pillar_id} className="border border-navy-600 rounded-lg p-3 bg-navy-800/40" title={p.description || ''}>
                <div className="text-xs text-navy-400 truncate">{p.name}</div>
                <div className="text-sm text-heading mt-1"><b>{p.live}</b> of {p.use_cases} live <span className="text-navy-500">· {p.in_flight} in flight</span></div>
                <div className="h-1.5 rounded bg-navy-700 mt-2 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                <div className="text-[11px] text-navy-500 mt-1">{p.value_live ? money(p.value_live / 1e6) : '$0'} of {money(p.value_base / 1e6)} roadmap value live</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RoadmapTab({ accountName }: { accountName?: string }) {
  const [nonce, setNonce] = useState(0);  // bump to refetch after catalog add / import
  const { data, loading, err } = useFetch(() => api.operateRoadmap(), [nonce]);
  const { data: roadmap } = useFetch(() => api.roadmapSummary().catch(() => null), [nonce]);
  const [showImport, setShowImport] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [showAuthor, setShowAuthor] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);  // active readiness filter
  const [removing, setRemoving] = useState<number | null>(null);
  const remove = async (u: any) => {
    if (!window.confirm(`Remove “${u.title}” from this account's portfolio?\n\nIt stays in the catalog and can be re-added anytime with ＋ Add from catalog.`)) return;
    setRemoving(u.id);
    try { await api.setPortfolio(u.id, false); setNonce((n) => n + 1); }
    finally { setRemoving(null); }
  };
  if (loading) return <Loading />;
  if (err) return <div className="text-rose-500 text-sm">{err}</div>;
  const portfolio: PortfolioRow[] = data?.use_cases || [];
  const summary: any = data?.summary || {};
  const pillarName = new Map((roadmap?.pillars || []).map((p) => [p.pillar_id, p.name]));
  const hasRoadmap = portfolio.some((u) => u.roadmap);
  const dist: Record<string, any> = { shovel_ready: summary.shovel_ready, awaiting_prerequisites: summary.awaiting_prerequisites, nearly_ready: summary.nearly_ready, blocked: summary.blocked };
  // With a roadmap: the roadmap's own order (rank), then anything added since. Without
  // one: phase, then value.
  const rank = (u: PortfolioRow) => (u.roadmap && !u.roadmap.dropped ? (u.roadmap.priority_rank ?? 9e3) : 1e4);
  const shown = [...portfolio]
    .filter((u) => !filter || u.readiness === filter)
    .sort((a, b) => hasRoadmap
      ? rank(a) - rank(b) || (b.hypothesized_mm ?? 0) - (a.hypothesized_mm ?? 0)
      : (a.phase ?? 1) - (b.phase ?? 1) || (b.hypothesized_mm ?? 0) - (a.hypothesized_mm ?? 0));
  return (
    <div className="space-y-6">
      <RoadmapBanner summary={roadmap} onImport={() => setShowImport(true)} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label={summary.on_roadmap ? 'Planned value' : 'Portfolio value (hyp.)'}
          value={money(summary.hypothesized_mm)}
          sub={summary.on_roadmap ? `roadmap estimates, catalog models for the rest (catalog models alone: ${money(summary.model_mm)})` : undefined} />
        <Tile label="Realized" value={money(summary.realized_mm)} />
        <Tile label="Shovel-ready" value={String(summary.shovel_ready ?? 0)} sub="all data needs met" />
        <Tile label="Use cases" value={String(summary.total ?? portfolio.length)}
          sub={summary.on_roadmap ? `${summary.on_roadmap} from the roadmap` : undefined} />
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Clickable readiness chips — filter the table. */}
          {Object.entries(dist).filter(([, v]) => v !== undefined).map(([k, v]) => (
            <button key={k} onClick={() => setFilter((f) => (f === k ? null : k))}
              title="Click to filter the portfolio by this readiness"
              className={`text-xs px-2 py-1 rounded border transition ${READINESS_COLOR[k] || 'text-navy-400 border-navy-600'} ${filter === k ? 'ring-2 ring-offset-1 ring-offset-navy-900 ring-current font-semibold' : filter ? 'opacity-50 hover:opacity-100' : 'hover:brightness-125'}`}>
              {READINESS_LABEL[k] || k}: {String(v)}</button>
          ))}
          {filter && <button onClick={() => setFilter(null)} className="text-xs px-2 py-1 rounded border border-navy-600 text-navy-300 hover:bg-navy-700">✕ All</button>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setShowCatalog(true)} className="text-xs rounded border border-navy-600 text-navy-300 px-3 py-1.5 hover:bg-navy-700">＋ Add from catalog</button>
          <button onClick={() => setShowAuthor(true)} className="text-xs rounded border border-info-600/40 text-info-500 bg-info-600/10 px-3 py-1.5 hover:bg-info-600/20">＋ Add use case</button>
        </div>
      </div>
      {showImport && <RoadmapImportModal accountName={accountName} onClose={() => setShowImport(false)}
        onImported={() => setNonce((n) => n + 1)} />}
      {showAuthor && <AuthorUseCaseModal onClose={() => setShowAuthor(false)}
        onSaved={(id) => { setShowAuthor(false); setNonce((n) => n + 1); setOpenId(id); }} />}
      {portfolio.length === 0 && <Empty>No use cases in this business unit's portfolio yet. <b>Import roadmap</b> above, pick use cases in <b>Explore</b> or with <b>＋ Add from catalog</b>, or describe your own with <b>＋ Add use case</b>.</Empty>}

      {portfolio.length > 0 && (
        <div className="overflow-x-auto border border-navy-600 rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="text-navy-400 text-xs bg-navy-800/60">
              <th className="text-left p-2">Use case</th>
              {hasRoadmap ? <th className="text-left p-2">Priority</th> : <th className="text-left p-2">Phase</th>}
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Readiness</th>
              <th className="text-right p-2">Hypothesized</th>
              <th className="text-right p-2">Realized</th>
              <th className="p-2 w-10"></th>
            </tr></thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} onClick={() => setOpenId(u.id)}
                  className="border-t border-navy-600/50 hover:bg-navy-800/40 cursor-pointer">
                  <td className="p-2 text-heading">
                    {u.title}
                    {u.roadmap?.dropped && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-warning-600/40 text-warning-500" title="No longer on the latest imported roadmap">dropped from roadmap</span>}
                    {u.roadmap && !u.roadmap.dropped && u.roadmap.pillar_ids.length > 0 && (
                      <div className="text-[11px] text-navy-500">{u.roadmap.pillar_ids.map((p) => pillarName.get(p) || p).join(' · ')}{u.roadmap.workstream ? ` · ${u.roadmap.workstream}` : ''}</div>
                    )}
                  </td>
                  {hasRoadmap ? (
                    <td className="p-2">
                      {u.roadmap?.priority_tier && !u.roadmap.dropped
                        ? <span className={`text-[11px] px-1.5 py-0.5 rounded border ${TIER_COLOR[u.roadmap.priority_tier] || ''}`}>{TIER_LABEL[u.roadmap.priority_tier]}</span>
                        : <span className="text-[11px] text-navy-500">{u.roadmap ? '—' : 'added'}</span>}
                    </td>
                  ) : <td className="p-2 text-navy-400">Phase {u.phase ?? 1}</td>}
                  <td className="p-2 text-navy-400 capitalize">{(u.status || '').replace(/_/g, ' ')}</td>
                  <td className="p-2">
                    {u.readiness && <span className={`text-[11px] px-1.5 py-0.5 rounded border ${READINESS_COLOR[u.readiness] || 'text-navy-400 border-navy-600'}`}>{READINESS_LABEL[u.readiness] || u.readiness}</span>}
                  </td>
                  <td className="p-2 text-right text-heading"
                    title={u.value_source === 'roadmap' ? `Roadmap estimate. Catalog value model: ${money(u.model_mm)}` : 'Catalog value model'}>
                    {money(u.hypothesized_mm)}{u.value_source === 'roadmap' && <span className="text-[10px] text-navy-500 ml-1">plan</span>}
                  </td>
                  <td className="p-2 text-right text-navy-400">{money(u.realized_mm)}</td>
                  <td className="p-2 text-right">
                    <button onClick={(e) => { e.stopPropagation(); remove(u); }} disabled={removing === u.id}
                      title="Remove from portfolio (stays in the catalog)"
                      className="text-navy-500 hover:text-rose-400 disabled:opacity-40 px-1.5 py-0.5 rounded hover:bg-rose-500/10 leading-none">
                      {removing === u.id ? '…' : '✕'}</button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-navy-400">No use cases match the <b className="text-heading">{READINESS_LABEL[filter || ''] || filter}</b> filter.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {openId != null && (
        <ErrorBoundary label="use case details" onClose={() => setOpenId(null)}>
          <UseCaseDrawer id={openId} onClose={() => setOpenId(null)}
            onRemoved={() => { setOpenId(null); setNonce((n) => n + 1); }} />
        </ErrorBoundary>
      )}
      {showCatalog && <CatalogModal onClose={() => setShowCatalog(false)} onAdded={() => { setShowCatalog(false); setNonce((n) => n + 1); }} />}
    </div>
  );
}

/** Browse the full use-case catalog and add selected cases to the account portfolio. */
function CatalogModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { data, loading } = useFetch(() => api.catalogUseCases());
  const [recs, setRecs] = useState<any[] | null>(null);
  const [lobs, setLobs] = useState<Array<{ id: number; name: string }>>([]);
  const [q, setQ] = useState('');
  const [lobFilter, setLobFilter] = useState<number | 'all'>('all');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.recommendCatalog(8).then((r) => setRecs(r.recommendations || [])).catch(() => setRecs([]));
    api.lobs().then((l: any) => setLobs(l || [])).catch(() => setLobs([]));
  }, []);

  const lobName = (id: number | null) => lobs.find((l) => l.id === id)?.name || '';
  const inPortfolio = new Set((data || []).filter((u) => u.in_portfolio).map((u) => u.id));
  const recIds = new Set((recs || []).map((r) => r.id));
  const catalog = (data || []).filter((u) =>
    !recIds.has(u.id) &&
    (!q || u.title.toLowerCase().includes(q.toLowerCase())) &&
    (lobFilter === 'all' || u.lob_id === lobFilter));
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const add = async () => {
    const ids = [...sel].filter((id) => !inPortfolio.has(id));
    if (ids.length === 0) return;
    setBusy(true);
    try { await api.bulkPortfolio(ids, true); onAdded(); } catch { setBusy(false); }
  };

  const Row = ({ id, title, right, disabled }: { id: number; title: string; right?: React.ReactNode; disabled?: boolean }) => (
    <label className={`flex items-center gap-3 px-3 py-2 rounded-lg ${disabled ? 'opacity-50' : 'hover:bg-navy-800 cursor-pointer'}`}>
      <input type="checkbox" disabled={disabled} checked={disabled || sel.has(id)} onChange={() => toggle(id)} />
      <span className="flex-1 min-w-0 text-sm text-heading truncate">{title}</span>
      {right}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-6" onClick={onClose}>
      <div className="bg-navy-900 border border-navy-600 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-navy-600">
          <h3 className="text-heading font-semibold">Add use cases to the portfolio</h3>
          <button onClick={onClose} className="text-navy-400 hover:text-heading">×</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Recommended first */}
          <div className="p-3 border-b border-navy-600/60">
            <div className="text-[11px] uppercase tracking-wide text-navy-500 mb-1 px-1">✦ Recommended for you</div>
            {recs == null ? <Loading /> : recs.length === 0 ? (
              <div className="text-xs text-navy-500 px-3 py-2">No recommendations right now.</div>
            ) : recs.map((r) => (
              <Row key={r.id} id={r.id} title={r.title} disabled={inPortfolio.has(r.id)}
                right={<span className="flex items-center gap-2 shrink-0">
                  {r.value_mm != null && <span className="text-[11px] text-emerald-500">{money(r.value_mm)}</span>}
                  {r.readiness && <span className={`text-[10px] px-1.5 py-0.5 rounded border ${READINESS_COLOR[r.readiness] || 'text-navy-400 border-navy-600'}`}>{READINESS_LABEL[r.readiness] || r.readiness}</span>}
                  {r.lob_name && <span className="text-[10px] text-navy-500">{r.lob_name}</span>}
                </span>} />
            ))}
          </div>
          {/* Full catalog with search + BU filter */}
          <div className="sticky top-0 bg-navy-900 p-3 border-b border-navy-600/60 flex gap-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the full catalog…"
              className="flex-1 rounded-lg border border-navy-600 bg-navy-800 px-3 py-1.5 text-sm text-heading" />
            <select value={lobFilter} onChange={(e) => setLobFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="rounded-lg border border-navy-600 bg-navy-800 px-2 py-1.5 text-sm text-heading">
              <option value="all">All business units</option>
              {lobs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="p-2">
            {loading ? <Loading /> : catalog.length === 0 ? (
              <div className="text-xs text-navy-500 px-3 py-4 text-center">No matching use cases.</div>
            ) : catalog.map((u) => (
              <Row key={u.id} id={u.id} title={u.title} disabled={u.in_portfolio}
                right={<span className="flex items-center gap-2 shrink-0">
                  {u.lob_id != null && <span className="text-[10px] text-navy-500">{lobName(u.lob_id)}</span>}
                  {u.phase != null && <span className="text-[11px] text-navy-500">Phase {u.phase}</span>}
                  {u.in_portfolio && <span className="text-[11px] text-emerald-500">in portfolio</span>}
                </span>} />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between p-4 border-t border-navy-600">
          <span className="text-xs text-navy-400">{[...sel].filter((id) => !inPortfolio.has(id)).length} selected</span>
          <button onClick={add} disabled={busy || [...sel].filter((id) => !inPortfolio.has(id)).length === 0}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? 'Adding…' : 'Add to portfolio'}</button>
        </div>
      </div>
    </div>
  );
}

const UC_STATUS_FLOW = ['not_started', 'scoping', 'in_progress', 'live', 'value_realized'];
const UC_STATUS_LABEL: Record<string, string> = {
  not_started: 'Not started', scoping: 'Scoping', in_progress: 'In progress',
  live: 'Live', value_realized: 'Value realized',
};
const readyStatus = (s: string) => ['curated', 'governed'].includes(s);

/** Full-height slide-over drawer: the operational "living roadmap" record for one use
 *  case — Overview / Tracking / Value / Proposal / Notes, all editable + persisted. */
function UseCaseDrawer({ id, onClose, onRemoved }: { id: number; onClose: () => void; onRemoved?: () => void }) {
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [editMeta, setEditMeta] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [eTitle, setETitle] = useState('');
  const [eDesc, setEDesc] = useState('');
  const [tab, setTab] = useState<'overview' | 'roadmap' | 'tracking' | 'value' | 'proposal' | 'notes'>('overview');
  const [remap, setRemap] = useState(false);
  const [road, setRoad] = useState<RoadmapUseCase | null>(null);
  useEffect(() => { api.roadmapUseCase(id).then((r) => setRoad(r.roadmap)).catch(() => setRoad(null)); }, [id]);

  const reload = React.useCallback(() => {
    setErr(null);
    return api.useCaseDetail(id).then(setD).catch((e) => {
      const msg = e?.message || String(e);
      // A Databricks gateway 502 (app restarting) returns an HTML page — never dump
      // that raw into the drawer; show a friendly, retryable message instead.
      const gateway = /<!DOCTYPE|<html|502|Bad Gateway|App Not Available|not available/i.test(msg);
      setErr(gateway ? '__unavailable__' : msg);
    });
  }, [id]);
  const retry = React.useCallback(() => { setLoading(true); reload().finally(() => setLoading(false)); }, [reload]);
  useEffect(() => { setLoading(true); reload().finally(() => setLoading(false)); }, [reload]);

  const uc: any = d || {};
  const startEditMeta = () => { setETitle(uc.title || ''); setEDesc(uc.description || ''); setEditMeta(true); };
  const saveMeta = async () => {
    if (!eTitle.trim()) return;
    setSavingMeta(true);
    try { await api.patchUseCase(id, { title: eTitle.trim(), description: eDesc }); setEditMeta(false); await reload(); }
    finally { setSavingMeta(false); }
  };
  const removeFromPortfolio = async () => {
    if (!window.confirm(`Remove “${uc.title || 'this use case'}” from this business unit's portfolio?\n\nIt stays in the catalog and can be re-added anytime.`)) return;
    setRemoving(true);
    try { await api.setPortfolio(id, false); (onRemoved || onClose)(); }
    finally { setRemoving(false); }
  };
  const req: any[] = uc.required_assets || [];
  const enables: any[] = uc.enables || [];
  const enabledBy: any[] = uc.enabled_by || [];
  const vr: any = uc.value_range || {};
  const hyp = vr.mid ?? uc.computed_value;

  return (
    <>
    {remap && <AuthorUseCaseModal existing={{ id, title: uc.title, description: uc.description, lob_id: uc.lob_id }}
      onClose={() => setRemap(false)} onSaved={() => { setRemap(false); void reload(); }} />}
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-y-0 right-0 w-full max-w-xl bg-navy-900 border-l border-navy-600 overflow-y-auto shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="sticky top-0 bg-navy-900 border-b border-navy-600 px-5 py-3 z-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] text-navy-500">
                {road ? <>On the roadmap{road.priority_tier ? ` · ${TIER_LABEL[road.priority_tier] || road.priority_tier}` : ''}{road.stage ? ` · ${road.stage}` : ''}</> : <>Phase {uc.phase ?? '—'} · Use case</>}
              </div>
              <h2 className="text-lg font-bold text-heading">{uc.title || 'Use case'}</h2>
            </div>
            <button onClick={onClose} className="text-navy-400 hover:text-heading text-xl leading-none px-2">×</button>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {uc.readiness && <span className={`text-[11px] px-2 py-0.5 rounded border ${READINESS_COLOR[uc.readiness] || 'text-navy-400 border-navy-600'}`}>{READINESS_LABEL[uc.readiness] || uc.readiness}</span>}
            <span className="text-xs text-navy-400" title={uc.value_source && uc.value_source !== 'model' ? 'From the imported roadmap' : 'Catalog value model'}>{uc.value_source && uc.value_source !== 'model' ? 'Planned' : 'Hypothesized'} <b className="text-heading">{money(hyp)}</b>{vr.low != null && vr.high != null ? ` (${money(vr.low)}–${money(vr.high)})` : ''}</span>
            {uc.origin === 'custom' && (
              <button onClick={() => setRemap(true)}
                title="Ask the agent to re-propose this use case's data, dependency, and value mappings"
                className="ml-auto text-[11px] px-2 py-0.5 rounded border border-info-600/40 text-info-500 hover:bg-info-600/10">
                ✦ Re-map with agent</button>
            )}
            <button onClick={removeFromPortfolio} disabled={removing}
              title="Remove from this business unit's portfolio (stays in the catalog)"
              className={`${uc.origin === 'custom' ? '' : 'ml-auto '}text-[11px] px-2 py-0.5 rounded border border-navy-600 text-navy-400 hover:text-rose-400 hover:border-rose-500/40 disabled:opacity-40`}>
              {removing ? 'Removing…' : '✕ Remove from portfolio'}</button>
          </div>
          <div className="flex items-center rounded-lg bg-navy-800 p-0.5 text-xs mt-3 w-max">
            {(['overview', ...(road ? ['roadmap'] as const : []), 'tracking', 'value', 'proposal', 'notes'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-2.5 py-1 rounded-md capitalize font-medium ${tab === t ? 'bg-navy-700 text-heading shadow-sm' : 'text-navy-400 hover:text-heading'}`}>{t}</button>
            ))}
          </div>
        </div>

        <div className="px-5 py-4">
          {loading && <Loading />}
          {err === '__unavailable__'
            ? <div className="text-sm text-navy-400 border border-navy-600 rounded-lg p-4">
                Details temporarily unavailable — the app may be restarting.
                <button onClick={retry} className="text-info-400 hover:underline ml-1">Retry</button>
              </div>
            : err && <div className="text-rose-500 text-sm">{err}</div>}
          {!loading && d && (
            <>
              {tab === 'overview' && (
                <div className="space-y-4">
                  {editMeta ? (
                    <div className="border border-navy-600 rounded-lg p-3 bg-navy-800/40 space-y-2">
                      <label className="block text-[11px] text-navy-500">Title
                        <input value={eTitle} onChange={(e) => setETitle(e.target.value)} className="input-field mt-1 text-sm" /></label>
                      <label className="block text-[11px] text-navy-500">Description
                        <textarea value={eDesc} onChange={(e) => setEDesc(e.target.value)} rows={4} className="input-field mt-1 text-sm w-full" /></label>
                      <div className="flex items-center gap-2">
                        <button onClick={saveMeta} disabled={savingMeta || !eTitle.trim()} className="btn-primary text-sm">{savingMeta ? 'Saving…' : 'Save'}</button>
                        <button onClick={() => setEditMeta(false)} className="text-xs rounded border border-navy-600 text-navy-300 px-2.5 py-1 hover:bg-navy-700">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      {uc.description ? <p className="text-sm text-navy-300">{uc.description}</p> : <p className="text-sm text-navy-500 italic">No description.</p>}
                      <button onClick={startEditMeta} title="Edit title & description"
                        className="shrink-0 text-[11px] px-2 py-0.5 rounded border border-navy-600 text-navy-400 hover:text-heading hover:bg-navy-700">✎ Edit</button>
                    </div>
                  )}
                  {(() => {
                    // Show the SAME basis the readiness verdict used. readiness_map
                    // picks the DOMAIN path when a use case has required domains (and
                    // isn't requires_locked); showing only module edges there produced
                    // the "shovel-ready but 1/2 modules ready" contradiction. The count
                    // comes from the driving path's authoritative required_ready/total.
                    const model = uc.requirement_model === 'domain' ? 'domain' : 'module';
                    const domains: any[] = uc.required_domains || [];
                    const total = uc.required_total ?? (model === 'domain' ? domains.length : req.length);
                    const ready = uc.required_ready ?? (model === 'domain'
                      ? domains.filter((x) => x.satisfied).length
                      : req.filter((a) => readyStatus(a.ingestion_status)).length);
                    return (
                      <div>
                        <div className="text-xs font-semibold text-navy-400 mb-1">
                          Required data ({ready}/{total} ready for this account)
                        </div>
                        {model === 'domain' ? (
                          domains.length === 0 ? <div className="text-xs text-navy-500">No data-domain requirements recorded.</div> : (
                            <>
                              <div className="text-[11px] text-navy-500 mb-1">Readiness is evaluated at the data-domain level — any serving system satisfies a need.</div>
                              <div className="space-y-1">
                                {domains.map((dm, i) => (
                                  <div key={i} className="flex items-center justify-between gap-2 text-xs border border-navy-600 rounded px-2 py-1.5">
                                    <span className="text-navy-300">{dm.label || dm.name}{dm.category ? ` · ${dm.category}` : ''}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${dm.satisfied ? 'text-emerald-500 border-emerald-600/40 bg-emerald-600/10' : 'text-navy-500 border-navy-600'}`}>
                                      {dm.satisfied ? 'met' : 'not met'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </>
                          )
                        ) : (
                          req.length === 0 ? <div className="text-xs text-navy-500">No specific module requirements recorded.</div> : (
                            <div className="space-y-1">
                              {req.map((a, i) => (
                                <div key={i} className="flex items-center justify-between gap-2 text-xs border border-navy-600 rounded px-2 py-1.5">
                                  <span className="text-navy-300">{a.module || a.source_category}{a.source_system && a.module ? ` · ${a.source_system}` : ''}</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_COLOR[a.ingestion_status] || 'text-navy-500 border-navy-600'}`}>
                                    {readyStatus(a.ingestion_status) ? 'ready' : (a.ingestion_status || 'not_started').replace(/_/g, ' ')}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )
                        )}
                      </div>
                    );
                  })()}
                  <div>
                    <div className="text-xs font-semibold text-navy-400 mb-1">Blast radius</div>
                    <div className="text-xs text-navy-300">Unlocks {enables.length} downstream use case{enables.length !== 1 ? 's' : ''}{enables.length ? ':' : ''}</div>
                    {enables.length > 0 && <div className="text-[11px] text-navy-500 mt-0.5">{enables.map((e) => e.title).join(' · ')}</div>}
                    {enabledBy.length > 0 && <div className="text-[11px] text-navy-500 mt-1">Depends on: {enabledBy.map((e) => e.title).join(' · ')}</div>}
                  </div>
                </div>
              )}
              {tab === 'roadmap' && road && <RoadmapSection r={road} />}
              {tab === 'tracking' && <TrackingSection uc={uc} onChange={reload} />}
              {tab === 'value' && <ValueSection uc={uc} onChange={reload} />}
              {tab === 'proposal' && <ProposalSection id={id} />}
              {tab === 'notes' && <NotesSection uc={uc} onChange={reload} />}
            </>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

/** What the imported roadmap said about this use case: why it matters, how it will be
 *  measured, the value estimate and its assumptions, and the first-version plan. */
function RoadmapSection({ r }: { r: RoadmapUseCase }) {
  const v = r.value_json || {};
  const plan = r.plan_json;
  const needs = r.data_needs_json || {};
  const cur = r.value_currency || 'USD';
  const m = (x: number | null | undefined) => (x == null ? '—' : money(x / 1e6));
  return (
    <div className="space-y-4 text-sm">
      {r.dropped_at && (
        <div className="text-xs text-warning-500 border border-warning-600/40 bg-warning-600/10 rounded p-2">
          Not on the latest imported roadmap (dropped {new Date(r.dropped_at).toLocaleDateString()}). It stays in the portfolio until you remove it.
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {r.pillars.map((p) => <span key={p.id} className="text-[11px] px-2 py-0.5 rounded-full border border-info-600/40 text-info-500">{p.name}</span>)}
        {r.workstream && <span className="text-[11px] px-2 py-0.5 rounded-full border border-navy-600 text-navy-300">{r.workstream}</span>}
        {r.effort && <span className="text-[11px] px-2 py-0.5 rounded-full border border-navy-600 text-navy-300">Effort {r.effort}{r.effort_quadrant ? ` · ${r.effort_quadrant}` : ''}</span>}
      </div>
      {r.summary && <p className="text-navy-300">{r.summary}</p>}
      {r.business_problem && (
        <div><div className="text-xs font-semibold text-navy-400 mb-1">Why it matters</div>
          <p className="text-navy-300 whitespace-pre-line">{r.business_problem}</p></div>
      )}
      {r.kpi && <div><div className="text-xs font-semibold text-navy-400 mb-1">How success is measured</div><p className="text-navy-300">{r.kpi}</p></div>}
      {r.value_base != null && (
        <div className="border border-navy-600 rounded-lg p-3 bg-navy-800/40">
          <div className="text-xs font-semibold text-navy-400">Roadmap value estimate {cur !== 'USD' ? `(${cur})` : ''}</div>
          <div className="text-heading mt-1"><b>{m(r.value_base)}</b> a year <span className="text-navy-500 text-xs">range {m(r.value_low)}–{m(r.value_high)}</span></div>
          {v.formula && <div className="text-[11px] text-navy-500 mt-1">{v.formula}</div>}
          {v.basis && <div className="text-[11px] text-navy-400 mt-1">{v.basis}</div>}
          {(v.assumptions || []).length > 0 && (
            <details className="mt-2 text-[11px]">
              <summary className="cursor-pointer text-navy-400">{(v.assumptions || []).length} assumptions</summary>
              <ul className="mt-1 space-y-1">
                {(v.assumptions || []).map((a, i) => (
                  <li key={i} className="text-navy-300">
                    <b className="text-navy-200">{a.label}</b>
                    {a.base != null && <> — {a.low != null && a.high != null && a.low !== a.high ? `${a.low}–${a.high}, base ${a.base}` : a.base}{a.unit && a.unit !== 'USD' ? ` ${a.unit}` : ''}</>}
                    {a.source && <span className="text-navy-500"> · {a.source}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="text-[11px] text-navy-500 mt-2">Track what's actually delivered in the <b>Value</b> tab.</div>
        </div>
      )}
      {plan && (
        <div>
          <div className="text-xs font-semibold text-navy-400 mb-1">First-version plan</div>
          {plan.headline && <div className="text-heading">{plan.headline}</div>}
          {plan.pilot && <div className="text-xs text-navy-400 mt-0.5">Pilot: {plan.pilot}</div>}
          <ol className="mt-2 space-y-2">
            {plan.phases.map((ph, i) => (
              <li key={i} className="border border-navy-600 rounded-lg p-2.5">
                <div className="text-[11px] text-navy-500">{[ph.name, ph.when].filter(Boolean).join(' · ')}</div>
                {ph.title && <div className="text-heading text-sm">{ph.title}</div>}
                {ph.summary && <div className="text-xs text-navy-300 mt-0.5">{ph.summary}</div>}
                {ph.steps.length > 0 && <ul className="list-disc ml-4 mt-1 text-xs text-navy-300">{ph.steps.map((st, k) => <li key={k}>{st}</li>)}</ul>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {((needs.datasets || []).length > 0 || (needs.sources || []).length > 0) && (
        <div>
          <div className="text-xs font-semibold text-navy-400 mb-1">Data the roadmap expects</div>
          <div className="text-xs text-navy-300">{[...(needs.datasets || []), ...(needs.assets || [])].filter((x, i, a) => a.indexOf(x) === i).join(' · ')}</div>
          {(needs.sources || []).length > 0 && <div className="text-[11px] text-navy-500 mt-1">From: {(needs.sources || []).join(' · ')}</div>}
          {needs.rationale && <div className="text-[11px] text-navy-500 mt-1">{needs.rationale}</div>}
          <div className="text-[11px] text-navy-500 mt-1">Readiness on the <b>Overview</b> tab uses this app's data catalog.</div>
        </div>
      )}
    </div>
  );
}

function TrackingSection({ uc, onChange }: { uc: any; onChange: () => Promise<any> }) {
  const [busy, setBusy] = useState(false);
  const rm = useFetch(() => api.roadmapForUseCase(uc.id), [uc.id]);
  const item: any = (rm.data && rm.data[0]) || {};
  const [target, setTarget] = useState('');
  const [completion, setCompletion] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    setTarget((item.target_date || '').slice(0, 10));
    setCompletion((item.completion_date || '').slice(0, 10));
    setNotes(item.notes || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rm.data]);

  const setStatus = async (status?: string, advance = false) => {
    setBusy(true);
    try { await api.setUseCaseStatus(uc.id, status, advance); await onChange(); }
    finally { setBusy(false); }
  };
  const saveRoadmap = async () => {
    setBusy(true);
    try {
      await api.upsertRoadmap({ use_case_id: uc.id,
        target_date: target || null, completion_date: completion || null, notes: notes || null });
      await onChange();
    } finally { setBusy(false); }
  };
  const idx = UC_STATUS_FLOW.indexOf(uc.status);
  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold text-navy-400 mb-2">Delivery status</div>
        <div className="flex items-center gap-1 flex-wrap">
          {UC_STATUS_FLOW.map((s, i) => (
            <button key={s} disabled={busy} onClick={() => setStatus(s)}
              className={`text-[11px] px-2 py-1 rounded border ${i === idx ? 'bg-emerald-600/15 border-emerald-600/40 text-emerald-500' : i < idx ? 'border-navy-600 text-navy-400' : 'border-navy-600 text-navy-500 hover:text-heading'}`}>
              {UC_STATUS_LABEL[s]}
            </button>
          ))}
          {idx < UC_STATUS_FLOW.length - 1 && (
            <button disabled={busy} onClick={() => setStatus(undefined, true)}
              className="text-[11px] px-2 py-1 rounded bg-lava hover:bg-lava-600 text-white ml-1">Advance →</button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-navy-400">Target / go-live date
          <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} className="input-field mt-1 text-sm" />
        </label>
        <label className="text-xs text-navy-400">Completion date
          <input type="date" value={completion} onChange={(e) => setCompletion(e.target.value)} className="input-field mt-1 text-sm" />
        </label>
      </div>
      <label className="text-xs text-navy-400 block">Roadmap notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="input-field mt-1 text-sm" placeholder="Delivery notes, dependencies, owner…" />
      </label>
      <button onClick={saveRoadmap} disabled={busy} className="btn-primary text-sm">{busy ? 'Saving…' : 'Save tracking'}</button>
    </div>
  );
}

function ValueSection({ uc, onChange }: { uc: any; onChange: () => Promise<any> }) {
  const vr: any = uc.value_range || {};
  const hasValue = vr.mid != null || vr.low != null || vr.high != null;
  const records: any[] = uc.value_records || [];
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState('');
  const [busy, setBusy] = useState(false);
  // --- Hypothesized-value editor (non-admin): AI estimate + manual override ---
  const [estimating, setEstimating] = useState(false);
  const [manual, setManual] = useState(false);
  const [vErr, setVErr] = useState<string | null>(null);
  const [lo, setLo] = useState(vr.low != null ? String(vr.low) : '');
  const [mi, setMi] = useState((vr.mid ?? uc.computed_value) != null ? String(vr.mid ?? uc.computed_value) : '');
  const [hi, setHi] = useState(vr.high != null ? String(vr.high) : '');
  const estimateAI = async () => {
    setEstimating(true); setVErr(null);
    try {
      const r = await api.estimateValue(uc.id);
      if (r?.value_model) { await api.patchUseCase(uc.id, { hypothesized_value_json: r.value_model }); await onChange(); }
    } catch (e: any) { setVErr(e?.message || String(e)); }
    finally { setEstimating(false); }
  };
  const saveManual = async () => {
    const low = Number(lo), high = Number(hi);
    let mid = mi === '' ? NaN : Number(mi);
    if (Number.isNaN(mid) && !Number.isNaN(low) && !Number.isNaN(high)) mid = (low + high) / 2;
    if ([low, mid, high].some((n) => Number.isNaN(n))) { setVErr('Enter numbers (in $M) for at least low and high.'); return; }
    setVErr(null); setEstimating(true);
    try {
      await api.patchUseCase(uc.id, { hypothesized_value_json: {
        driver: uc.title, low_mm: low, mid_mm: mid, high_mm: high,
        note: 'Set manually', roiMonths: uc.value_breakdown?.roiMonths ?? null } });
      setManual(false); await onChange();
    } catch (e: any) { setVErr(e?.message || String(e)); }
    finally { setEstimating(false); }
  };
  const fromRoadmap = uc.value_source === 'roadmap' || uc.value_source === 'roadmap_override';
  const mv: any = uc.model_value_range;
  const resetToRoadmap = async () => {
    setEstimating(true); setVErr(null);
    try { await api.patchUseCase(uc.id, { reset_roadmap_value: true }); await onChange(); }
    catch (e: any) { setVErr(e?.message || String(e)); }
    finally { setEstimating(false); }
  };
  const addRealized = async () => {
    if (!amount) return;
    setBusy(true);
    try {
      await api.addValueRecord({ use_case_id: uc.id, kind: 'realized',
        metric_type: 'realized annual value', amount: Number(amount), unit: 'USD',
        fiscal_period: period || undefined, confidence: 'med' });
      setAmount(''); setPeriod(''); await onChange();
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Low" value={money(vr.low)} />
        <Tile label={fromRoadmap ? 'Planned' : 'Hypothesized'} value={money(vr.mid ?? uc.computed_value)} />
        <Tile label="High" value={money(vr.high)} />
      </div>
      {fromRoadmap && (
        <div className="text-[11px] text-navy-400 border border-info-600/30 bg-info-600/5 rounded-lg p-2.5">
          {uc.value_source === 'roadmap_override'
            ? <>Value set for this business unit (replaces the imported roadmap's estimate here only).{' '}
                <button onClick={resetToRoadmap} disabled={estimating} className="text-info-500 hover:underline">Reset to the roadmap's estimate</button></>
            : <>From the imported roadmap, sized for this organization. Adjusting it here changes it for this business unit only.</>}
          {mv && <div className="text-navy-500 mt-1">The catalog's generic value model would give {money(mv.mid)} ({money(mv.low)}–{money(mv.high)}).</div>}
        </div>
      )}

      {/* Value editor — available to anyone (a generated use case starts blank). */}
      <div className="border border-navy-600 rounded-lg p-3 bg-navy-800/40">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs font-semibold text-heading">
            {hasValue ? (fromRoadmap ? 'Adjust the planned value' : 'Adjust hypothesized value') : 'This use case has no value yet'}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={estimateAI} disabled={estimating}
              className="text-xs rounded border border-info-600/40 text-info-500 bg-info-600/10 px-2.5 py-1 hover:bg-info-600/20 disabled:opacity-50">
              {estimating ? 'Working…' : '✦ Estimate with AI'}</button>
            <button onClick={() => { setManual((m) => !m); setVErr(null); }}
              className="text-xs rounded border border-navy-600 text-navy-300 px-2.5 py-1 hover:bg-navy-700">
              {manual ? 'Cancel' : '✎ Set manually'}</button>
          </div>
        </div>
        {!hasValue && !manual && <div className="text-[11px] text-navy-500 mt-1">Estimate a value model from your calibrated assumptions, or enter a range by hand.</div>}
        {manual && (
          <div className="mt-2 flex items-end gap-2 flex-wrap">
            <label className="text-[11px] text-navy-500">Low ($M)
              <input value={lo} onChange={(e) => setLo(e.target.value)} placeholder="0.5" className="input-field mt-1 text-sm w-24" /></label>
            <label className="text-[11px] text-navy-500">Mid ($M)
              <input value={mi} onChange={(e) => setMi(e.target.value)} placeholder="auto" className="input-field mt-1 text-sm w-24" /></label>
            <label className="text-[11px] text-navy-500">High ($M)
              <input value={hi} onChange={(e) => setHi(e.target.value)} placeholder="2.0" className="input-field mt-1 text-sm w-24" /></label>
            <button onClick={saveManual} disabled={estimating} className="btn-primary text-sm">Save value</button>
          </div>
        )}
        {vErr && <div className="text-rose-500 text-[11px] mt-1">{vErr}</div>}
      </div>

      {uc.value_breakdown && (
        <div className="border border-navy-600 rounded-lg p-3 bg-navy-800/40">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs font-semibold text-heading">How this value is calculated</div>
            <div className="text-[11px] text-navy-500 whitespace-nowrap">
              {money(uc.value_breakdown.low)}–{money(uc.value_breakdown.high)}/yr
              {uc.value_breakdown.roiMonths ? ` · ROI ~${uc.value_breakdown.roiMonths}mo` : ''}
            </div>
          </div>
          {uc.value_breakdown.driver && <div className="text-[11px] text-navy-400 mb-2">{uc.value_breakdown.driver}</div>}
          {uc.value_breakdown.note && <div className="text-[11px] text-navy-500 italic mb-2">{uc.value_breakdown.note}</div>}
          {(uc.value_breakdown.components || []).length > 0 && (
            <div className="space-y-2">
              {uc.value_breakdown.components.map((c: any, i: number) => (
                <div key={i} className="border border-navy-600/60 rounded p-2 bg-navy-900/30">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-heading font-medium">{c.name || `Component ${i + 1}`}</span>
                    <span className="text-[11px] text-emerald-500 whitespace-nowrap">{money(c.low_mm)}–{money(c.high_mm)}/yr</span>
                  </div>
                  {c.calculationDisplay && <div className="text-[11px] text-navy-400 mt-0.5">{c.calculationDisplay}</div>}
                  {(c.assumptions || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {c.assumptions.map((a: any, j: number) => (
                        <span key={j} className="text-[10px] font-mono text-navy-300 border border-navy-600 rounded px-1 py-0.5"
                          title="Value assumption — tune it in the Value tab">
                          {a.key} = {typeof a.value === 'number' ? a.value.toLocaleString() : a.value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="text-[11px] text-navy-500 text-right">value = Σ components = <span className="text-navy-300">{money(uc.value_breakdown.mid)}/yr</span> (mid)</div>
            </div>
          )}
        </div>
      )}
      <div>
        <div className="text-xs font-semibold text-navy-400 mb-1">Value records (hypothesized vs realized)</div>
        {records.length === 0 ? <div className="text-xs text-navy-500">No value records yet.</div> : (
          <div className="space-y-1">
            {records.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-xs border border-navy-600 rounded px-2 py-1.5">
                <span className={r.kind === 'realized' ? 'text-emerald-500' : 'text-navy-300'}>{r.kind} · {r.metric_type || ''}</span>
                <span className="text-heading">{r.unit === 'USD_M' ? `$${r.amount}M` : (r.unit === 'USD' ? money((r.amount || 0) / 1_000_000) : r.amount)}{r.fiscal_period ? ` · ${r.fiscal_period}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-navy-600/50 pt-3">
        <div className="text-xs font-semibold text-navy-400 mb-1">Record realized value</div>
        <div className="flex items-end gap-2">
          <label className="text-[11px] text-navy-500 flex-1">Amount (USD)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1400000" className="input-field mt-1 text-sm" /></label>
          <label className="text-[11px] text-navy-500 w-28">Period
            <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="FY26" className="input-field mt-1 text-sm" /></label>
          <button onClick={addRealized} disabled={busy || !amount} className="btn-primary text-sm">Add</button>
        </div>
      </div>
    </div>
  );
}

function ProposalSection({ id }: { id: number }) {
  const [prop, setProp] = useState<any>(null);
  const [article, setArticle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = React.useCallback(async () => {
    setErr(null);
    try {
      const p = await api.getProposal(id);
      setProp(p);
      if (p?.exists && p.proposal?.slug) {
        setArticle(await api.kbArticle(p.proposal.slug).catch(() => null));
      } else setArticle(null);
    } catch (e: any) { setErr(e?.message || String(e)); }
  }, [id]);
  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);
  const generate = async () => {
    setBusy(true); setErr(null);
    try {
      // generateProposal stages the write behind a confirm token (proposals can be
      // hand-edited, so the write is gated). Clicking "Generate" IS the intent to
      // create it, so confirm the token here — otherwise nothing is ever persisted
      // and the tab keeps saying "No proposal yet".
      const res = await api.generateProposal(id, prop?.exists);
      const token = res?.confirm?.token;
      if (token) await api.confirmWrite(token);
      await load();
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };
  if (loading) return <Loading />;
  const body = article?.body || article?.content || prop?.proposal?.summary;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-navy-400">{prop?.exists ? `Proposal v${prop.proposal?.version || 1} · ${prop.proposal?.status || ''}` : 'No proposal yet.'}</div>
        <button onClick={generate} disabled={busy} className="btn-primary text-sm">{busy ? 'Generating…' : prop?.exists ? 'Regenerate' : 'Generate proposal'}</button>
      </div>
      {err && <div className="text-rose-500 text-xs">{err}</div>}
      {prop?.exists && (
        <div className="border border-navy-600 rounded-lg p-3 bg-navy-800/40">
          {prop.proposal?.title && <div className="text-sm font-semibold text-heading mb-1">{prop.proposal.title}</div>}
          <div className="text-xs text-navy-300 whitespace-pre-wrap">{body || 'Proposal generated — open the knowledge base for full sections.'}</div>
        </div>
      )}
      {busy && <div className="text-[11px] text-navy-500">Generating eight prose sections — this takes a moment.</div>}
    </div>
  );
}

function NotesSection({ uc, onChange }: { uc: any; onChange: () => Promise<any> }) {
  const comments: any[] = uc.comments || [];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await api.addComment(uc.id, text.trim()); setText(''); await onChange(); }
    finally { setBusy(false); }
  };
  const del = async (cid: number) => { await api.deleteComment(cid).catch(() => {}); await onChange(); };
  return (
    <div className="space-y-3">
      {comments.length === 0 ? <div className="text-xs text-navy-500">No notes yet.</div> : (
        <div className="space-y-2">
          {comments.map((c, i) => (
            <div key={i} className="border border-navy-600 rounded-lg p-2.5 bg-navy-800/40">
              <div className="flex items-center justify-between text-[11px] text-navy-500">
                <span>{c.created_by || 'user'} · {(c.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                <button onClick={() => del(c.id)} className="hover:text-rose-500">delete</button>
              </div>
              <div className="text-sm text-navy-300 mt-1 whitespace-pre-wrap">{c.body}</div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="input-field text-sm flex-1" placeholder="Add a note (go-live blockers, owner, decisions)…" />
        <button onClick={add} disabled={busy || !text.trim()} className="btn-primary text-sm">Add</button>
      </div>
    </div>
  );
}

// --- Data ------------------------------------------------------------------
const ING_STATUSES = ['not_started', 'landed', 'curated', 'governed'];
const ING_LABEL: Record<string, string> = {
  not_started: 'Not started', landed: 'Landed', curated: 'Curated', governed: 'Governed',
};
const PROVENANCE_LABEL: Record<string, string> = {
  survey: 'survey rolldown', discovered: 'discovered', manual: 'manual',
};

/** Data tab: the account's data estate as two clean tables — RAW source datasets vs
 *  CURATED data products — with per-account ingestion status editable inline. A raw
 *  dataset is ready once LANDED; a data product needs CURATED (its raw feeders shown). */
const rawReady = (s: string) => ['landed', 'curated', 'governed'].includes(s);
const prodReady = (s: string) => ['curated', 'governed'].includes(s);

function DataTab() {
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [tier, setTier] = useState<'raw' | 'product'>(() => {
    try { return (localStorage.getItem('gc.dataTab') as any) || 'raw'; } catch { return 'raw'; }
  });
  const [q, setQ] = useState('');

  const load = React.useCallback(() => {
    setErr(null);
    return api.dataAssets().then((a: any[]) => setAssets(a || []))
      .catch((e) => setErr(e?.message || String(e))).finally(() => setLoading(false));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const pickTier = (t: 'raw' | 'product') => { setTier(t); try { localStorage.setItem('gc.dataTab', t); } catch { /* private */ } };

  const change = async (assetId: number, status: string) => {
    setSaving(assetId);
    try {
      await api.setAssetStatus(assetId, status); await load();
      setSavedId(assetId); setTimeout(() => setSavedId((v) => (v === assetId ? null : v)), 2000);
    } catch (e) { setErr(String(e)); } finally { setSaving(null); }
  };

  if (loading) return <Loading />;
  if (err) return <div className="text-rose-500 text-sm">{err}</div>;

  const byId: Record<number, any> = Object.fromEntries(assets.map((a) => [a.id, a]));
  const raws = assets.filter((a) => a.tier !== 'product');
  const products = assets.filter((a) => a.tier === 'product');
  const rawsReadyN = raws.filter((a) => rawReady(a.ingestion_status)).length;
  const prodReadyN = products.filter((a) => prodReady(a.ingestion_status)).length;
  const needle = q.trim().toLowerCase();
  const rows = (tier === 'raw' ? raws : products).filter((a) =>
    !needle || (a.module || '').toLowerCase().includes(needle) || (a.source_category || '').toLowerCase().includes(needle))
    .sort((a, b) => (a.source_category || '').localeCompare(b.source_category || '') || (a.module || '').localeCompare(b.module || ''));

  const StatusSelect = ({ a }: { a: any }) => (
    <div className="flex items-center gap-1.5 justify-end">
      {savedId === a.id && <span className="text-[10px] text-emerald-500">updated</span>}
      <select value={a.ingestion_status} disabled={saving === a.id}
        onChange={(e) => change(a.id, e.target.value)}
        className={`text-[11px] rounded border px-1.5 py-0.5 bg-navy-900 ${STATUS_COLOR[a.ingestion_status] || 'text-navy-400 border-navy-600'}`}>
        {ING_STATUSES.map((st) => <option key={st} value={st}>{ING_LABEL[st]}</option>)}
      </select>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-navy-400">
        Your data estate split into <b className="text-navy-300">raw source datasets</b> and the
        <b className="text-navy-300"> curated data products</b> built from them. A raw dataset is ready once
        <b className="text-navy-300"> landed</b>; a product needs <b className="text-navy-300">curated</b> (its
        raw feeders must land first). Set status inline — readiness recomputes.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Raw datasets" value={String(raws.length)} sub={`${rawsReadyN} landed+`} />
        <Tile label="Data products" value={String(products.length)} sub={`${prodReadyN} curated+`} />
        <Tile label="Ready / total" value={`${rawsReadyN + prodReadyN}/${assets.length}`} />
        <Tile label="Products awaiting feeders"
              value={String(products.filter((p) => !prodReady(p.ingestion_status) && (p.fed_by || []).some((r: number) => !rawReady(byId[r]?.ingestion_status || 'not_started'))).length)} />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center rounded-lg bg-navy-800 p-0.5 text-sm">
          <button onClick={() => pickTier('raw')}
            className={`px-3 py-1 rounded-md font-medium ${tier === 'raw' ? 'bg-navy-700 text-heading shadow-sm' : 'text-navy-400 hover:text-heading'}`}>Raw datasets ({raws.length})</button>
          <button onClick={() => pickTier('product')}
            className={`px-3 py-1 rounded-md font-medium ${tier === 'product' ? 'bg-navy-700 text-heading shadow-sm' : 'text-navy-400 hover:text-heading'}`}>Data products ({products.length})</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
          className="rounded-lg border border-navy-600 bg-navy-800 px-3 py-1.5 text-sm text-heading w-56" />
      </div>

      <div className="overflow-x-auto border border-navy-600 rounded-lg">
        <table className="w-full text-sm">
          <thead><tr className="text-navy-400 text-xs bg-navy-800/60">
            <th className="text-left p-2">{tier === 'raw' ? 'Raw dataset' : 'Data product'}</th>
            <th className="text-left p-2">Source category</th>
            <th className="text-left p-2">{tier === 'raw' ? 'Feeds' : 'Built from'}</th>
            {tier === 'product' && <th className="text-left p-2">Curation</th>}
            <th className="text-center p-2">Ready</th>
            <th className="text-right p-2">Status</th>
          </tr></thead>
          <tbody>
            {rows.map((a) => {
              const ready = tier === 'raw' ? rawReady(a.ingestion_status) : prodReady(a.ingestion_status);
              const feeders = (a.fed_by || []).map((r: number) => byId[r]).filter(Boolean);
              const feedersLanded = feeders.every((f: any) => rawReady(f.ingestion_status));
              return (
                <tr key={a.id} className="border-t border-navy-600/50 hover:bg-navy-800/40">
                  <td className="p-2 text-heading">
                    {a.module}
                    {tier === 'product' && !ready && !feedersLanded &&
                      <span className="text-[10px] text-warning-500 ml-1" title="Feeding raw datasets not all landed">🔒</span>}
                  </td>
                  <td className="p-2 text-navy-400">{a.source_category}</td>
                  <td className="p-2 text-navy-400 text-xs">
                    {tier === 'raw'
                      ? ((a.feeds || []).length ? `${(a.feeds || []).length} product${(a.feeds || []).length === 1 ? '' : 's'}` : '—')
                      : (feeders.length ? feeders.map((f: any) => f.module).join(', ') : '—')}
                  </td>
                  {tier === 'product' && <td className="p-2 text-navy-400">{a.curate_effort || '—'}</td>}
                  <td className="p-2 text-center">{ready ? <span className="text-emerald-500">✓</span> : <span className="text-navy-600">–</span>}</td>
                  <td className="p-2"><StatusSelect a={a} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="p-4 text-navy-400 text-sm text-center">No {tier === 'raw' ? 'raw datasets' : 'data products'}{needle ? ' match your search' : ''}.</div>}
      </div>
    </div>
  );
}

// --- Value -----------------------------------------------------------------
function ValueTab() {
  const { data: rm } = useFetch(() => api.roadmapSummary().catch(() => null), []);
  return (
    <div className="space-y-3">
      {rm?.roadmap && (
        <p className="text-xs text-navy-400 border border-info-600/30 bg-info-600/5 rounded-lg p-2.5">
          Use cases on the imported roadmap keep the roadmap's own estimate (or a value you set on the use case).
          These assumptions drive the catalog value models for everything else in this business unit.
        </p>
      )}
      <ValueAssumptionsSection />
    </div>
  );
}

/** Per-customer calibration of the value-model assumptions that drive every use
 *  case's $ range. Account-scoped rows win over global defaults (account_id NULL);
 *  editing here writes an account override. The "Recalibrate from company research"
 *  button runs the research agent to propose values, which the user can apply. */
function ValueAssumptionsSection({ onSaved }: { onSaved?: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [research, setResearch] = useState<any>(null);
  const [researchBusy, setResearchBusy] = useState(false);
  const [companyName, setCompanyName] = useState('');

  const load = React.useCallback(() => {
    setErr(null);
    return api.listValueAssumptions()
      .then((r) => setRows(r || []))
      .catch((e) => setErr(e?.message || String(e)));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (key: string) => {
    const raw = edits[key];
    if (raw == null || raw === '') return;
    const value = Number(raw);
    if (Number.isNaN(value)) { setErr('Value must be a number'); return; }
    setSavingKey(key);
    try {
      await api.updateValueAssumption(key, value);
      setEdits((e) => { const n = { ...e }; delete n[key]; return n; });
      await load();
      onSaved?.();
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setSavingKey(null); }
  };

  const recalibrate = async () => {
    if (!companyName.trim()) { setErr('Enter the company name to research'); return; }
    setResearchBusy(true); setErr(null); setResearch(null);
    try { setResearch(await api.researchCompany(companyName.trim())); }
    catch (e: any) { setErr(e?.message || String(e)); }
    finally { setResearchBusy(false); }
  };
  const applyResearch = async () => {
    if (!research?.run_id) return;
    setResearchBusy(true);
    try { await api.researchApply(research.run_id, []); setResearch(null); await load(); }
    catch (e: any) { setErr(e?.message || String(e)); }
    finally { setResearchBusy(false); }
  };

  if (rows == null) return <div><h3 className="text-sm font-semibold text-heading mb-2">Value assumptions</h3><Loading /></div>;
  const byCat: Record<string, any[]> = {};
  for (const r of rows) { const c = r.category || 'General'; (byCat[c] = byCat[c] || []).push(r); }

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <h3 className="text-sm font-semibold text-heading">Value assumptions <span className="text-xs font-normal text-navy-500">— calibrate the $ model to this customer</span></h3>
      </div>
      {err && <div className="text-rose-500 text-xs mb-2">{err}</div>}

      <div className="border border-navy-600 rounded-lg p-3 bg-navy-800/40 mb-3">
        <div className="text-xs font-semibold text-navy-400 mb-1">Recalibrate from company research</div>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-[11px] text-navy-500 flex-1 min-w-[180px]">Company
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Example Power & Light" className="input-field mt-1 text-sm" /></label>
          <button onClick={recalibrate} disabled={researchBusy} className="btn-primary text-sm">{researchBusy ? 'Researching…' : 'Research'}</button>
          {research?.run_id && <button onClick={applyResearch} disabled={researchBusy} className="text-sm rounded border border-emerald-600/40 text-emerald-500 px-3 py-1.5 hover:bg-emerald-600/10">Apply {(research.assumptions || []).length} proposed</button>}
        </div>
        {research && (
          <div className="text-[11px] text-navy-400 mt-2">
            {(research.assumptions || []).length} assumptions proposed{research.used_llm === false ? ' (heuristic)' : ''}. Review below, then Apply.
          </div>
        )}
      </div>

      <div className="space-y-4">
        {Object.entries(byCat).map(([cat, list]) => (
          <div key={cat}>
            <div className="text-[11px] uppercase tracking-wide text-navy-500 mb-1">{cat}</div>
            <div className="border border-navy-600 rounded-lg divide-y divide-navy-600/50">
              {list.map((r) => {
                const proposed = research?.assumptions?.find((a: any) => a.key === r.key);
                const scoped = r.account_id != null;
                return (
                  <div key={r.key} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm text-navy-300">{r.label || r.key}
                        {scoped && <span className="text-[10px] text-emerald-500 ml-2 border border-emerald-600/40 rounded px-1">account</span>}
                      </div>
                      <div className="text-[10px] text-navy-600 font-mono">{r.key}{r.unit ? ` · ${r.unit}` : ''}
                        {proposed?.recommended_value != null && <span className="text-info-500 ml-1">→ research: {proposed.recommended_value}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        value={edits[r.key] ?? String(r.value ?? '')}
                        onChange={(e) => setEdits((s) => ({ ...s, [r.key]: e.target.value }))}
                        className="input-field text-sm w-28 text-right" />
                      <button onClick={() => save(r.key)} disabled={savingKey === r.key || edits[r.key] == null}
                        className="text-xs rounded bg-navy-700 text-heading px-2 py-1.5 hover:bg-navy-600 disabled:opacity-40">
                        {savingKey === r.key ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {rows.length === 0 && <Empty>No value assumptions configured.</Empty>}
      </div>
    </div>
  );
}

// --- What-if ---------------------------------------------------------------
function WhatIfTab() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-navy-400">
        The dependency tree: <b className="text-navy-300">raw datasets</b> → <b className="text-navy-300">curated data products</b> → <b className="text-navy-300">use cases</b>.
        Toggle a raw datasource to land it and watch the products it feeds and the use cases it unblocks light up.
      </p>
      <WhatIfGraph />
    </div>
  );
}

// --- Reconciliation --------------------------------------------------------
const RECON_BADGE: Record<string, string> = {
  confirmed: 'text-emerald-500 border-emerald-600/40 bg-emerald-600/10',
  additional: 'text-info-500 border-info-600/40 bg-info-600/10',
  gap: 'text-warning-500 border-warning-600/40 bg-warning-600/10',
  none: 'text-navy-500 border-navy-600',
};
function DiscoverReconcileTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const load = React.useCallback(() => {
    return api.reconciliation().then(setData).catch(() => setData({})).finally(() => setLoading(false));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const refresh = async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } };
  const recon: any = data || {};
  const c = recon.counts || {};
  return (
    <div className="space-y-5">
      <p className="text-sm text-navy-400">
        Find out what data you <b>actually have</b>: sweep your workspaces and Unity Catalog, attribute what
        you find to the catalog, and compare it with what your team recorded in <b>Data</b>.
        Attributed data makes use cases ready, and the result is reconciled source by source below.
      </p>
      {!loading && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs px-2 py-1 rounded border text-emerald-500 border-emerald-600/40 bg-emerald-600/10" title="Recorded by your team and found by discovery">Confirmed: {c.confirmed ?? 0}</span>
          <span className="text-xs px-2 py-1 rounded border text-info-500 border-info-600/40 bg-info-600/10" title="Found by discovery, not recorded by your team">Additional: {c.additional ?? 0}</span>
          <span className="text-xs px-2 py-1 rounded border text-warning-500 border-warning-600/40 bg-warning-600/10" title="Recorded by your team, not yet found by discovery">Gap: {c.gap ?? 0}</span>
          <button onClick={refresh} disabled={refreshing}
            className="ml-auto text-xs rounded border border-navy-600 text-navy-300 px-3 py-1.5 hover:bg-navy-700 disabled:opacity-50">
            {refreshing ? 'Refreshing…' : '↻ Refresh after attributing'}</button>
        </div>
      )}

      <DiscoverySteps />

      <div>
        <h3 className="text-sm font-semibold text-heading mb-1">Reconciliation by data source</h3>
        {loading ? <Loading /> : (
          <div className="overflow-x-auto border border-navy-600 rounded-lg">
            <table className="w-full text-sm">
              <thead><tr className="text-navy-400 text-xs">
                <th className="text-left p-2">Data source</th><th className="text-left p-2">Category</th>
                <th className="text-center p-2">Recorded</th>
                <th className="text-center p-2">Discovered</th>
                <th className="text-center p-2">Modules</th><th className="text-left p-2">Status</th>
              </tr></thead>
              <tbody>
                {(recon.sources || []).map((src: any) => (
                  <tr key={src.id} className="border-t border-navy-600/50">
                    <td className="p-2 text-heading">{src.name}</td>
                    <td className="p-2 text-navy-400">{src.category}</td>
                    <td className="p-2 text-center">{src.self_reported ? '✓' : '—'}</td>
                    <td className="p-2 text-center">{src.discovered ? '✓' : '—'}</td>
                    <td className="p-2 text-center text-navy-400">{src.modules}</td>
                    <td className="p-2"><span className={`text-[11px] px-1.5 py-0.5 rounded border ${RECON_BADGE[src.status]}`}>{src.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-navy-500 mt-2">
          Recorded wrong? Correct any module's status in the <b>Data</b> tab and readiness recomputes.
        </p>
      </div>
    </div>
  );
}

function Step({ n, title, why, children }: {
  n: number; title: string; why: string; children: React.ReactNode;
}) {
  return (
    <div className="border border-navy-600 rounded-lg p-4 bg-navy-800/40">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-bold text-heading bg-navy-700 rounded-full w-6 h-6 flex items-center justify-center shrink-0">{n}</span>
        <h3 className="text-sm font-semibold text-heading">{title}</h3>
      </div>
      <p className="text-xs text-navy-400 mt-1 mb-3 ml-8">{why}</p>
      <div className="ml-8">{children}</div>
    </div>
  );
}

function StepResult({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <div className={`mt-2 text-xs px-3 py-2 rounded border ${
      ok === false ? 'text-rose-500 border-rose-600/40 bg-rose-600/10'
      : 'text-emerald-500 border-emerald-600/40 bg-emerald-600/10'}`}>{children}</div>
  );
}

function CsvUpload({ label, kind }: { label: string; kind: 'schemas' | 'tables' | 'columns' }) {
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await api.ingestUpload(kind, file)); }
    catch (ex: any) { setErr(ex?.message || String(ex)); }
    finally { setBusy(false); }
  };
  const written = res ? (res.rows_written ?? res.tables_updated ?? res.rows_in_file) : null;
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <label className="text-xs text-navy-300 border border-navy-600 rounded px-3 py-1.5 cursor-pointer hover:bg-navy-700">
        {busy ? 'Uploading…' : `Upload ${label} CSV`}
        <input type="file" accept=".csv" className="hidden" onChange={onFile} disabled={busy} />
      </label>
      {written != null && <span className="text-xs text-emerald-500">✓ {written} rows written</span>}
      {err && <span className="text-xs text-rose-500">{err}</span>}
    </div>
  );
}

function ActionButton({ label, run }: { label: string; run: () => Promise<any> }) {
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await run()); } catch (ex: any) { setErr(ex?.message || String(ex)); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <button onClick={go} disabled={busy}
        className="text-xs rounded bg-navy-700 text-heading px-3 py-1.5 hover:bg-navy-600 disabled:opacity-50">
        {busy ? 'Running…' : label}
      </button>
      {res && <StepResult>{summarizeRun(res)}</StepResult>}
      {err && <StepResult ok={false}>{err}</StepResult>}
    </div>
  );
}

function summarizeRun(r: any): string {
  const parts: string[] = [];
  const map: Record<string, string> = {
    schemas_enriched_total: 'schemas enriched', staged_ok: 'rows staged',
    staged_errors: 'errors', exact: 'exact', normalized: 'normalized', llm: 'LLM-mapped',
    assets_matched: 'modules matched', assets_advanced: 'modules advanced',
    canonicals_discovered: 'canonical systems',
  };
  for (const [k, label] of Object.entries(map)) {
    if (r[k] != null) parts.push(`${r[k]} ${label}`);
  }
  return parts.length ? `Done — ${parts.join(', ')}.` : (r.status || 'Done.');
}

function DiscoverySteps() {
  const status = useFetch(() => api.setupStatus(), []);
  const extractor = useFetch(() => api.extractorInfo(), []);
  const summary = useFetch(() => api.ingestionSummary(), []);
  const [grantsSql, setGrantsSql] = useState<string | null>(null);

  const s = summary.data;
  return (
    <div className="space-y-4">

      {s?.configured && s?.available && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Schemas discovered" value={String(s.schemas ?? 0)} />
          <Tile label="Tables discovered" value={String(s.tables ?? 0)} />
          <Tile label="Enriched tables" value={String(s.enriched_tables ?? 0)} />
          <Tile label="Canonical systems" value={String(s.canonicals ?? 0)} />
        </div>
      )}

      <Step n={1} title="Check the workspace"
        why="Discovery needs Lakebase, a SQL warehouse, and Unity Catalog. Probe first — a missing grant shows up here with the SQL to fix it, not as a 403 mid-pipeline.">
        {status.loading && <div className="text-xs text-navy-500">Probing…</div>}
        {status.data && (
          <div className="space-y-1">
            {status.data.checks?.map((c) => (
              <div key={c.name} className="flex items-center gap-2 text-xs">
                <span className={c.ok ? 'text-emerald-500' : c.required ? 'text-rose-500' : 'text-warning-500'}>
                  {c.ok ? '✓' : c.required ? '✕' : '○'}</span>
                <span className="text-navy-300">{c.label}</span>
                <span className="text-navy-500">— {c.detail}</span>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <button onClick={() => status && api.setupRecheck().then(() => location.reload())}
                className="text-xs rounded bg-navy-700 text-heading px-3 py-1.5 hover:bg-navy-600">Re-check</button>
              <button onClick={() => api.setupGrants().then(g => setGrantsSql(g.sql)).catch(() => {})}
                className="text-xs rounded border border-navy-600 text-navy-300 px-3 py-1.5 hover:bg-navy-700">Show all GRANTs</button>
            </div>
            {grantsSql && <pre className="mt-2 text-[11px] text-navy-300 bg-navy-900 border border-navy-600 rounded p-2 overflow-x-auto whitespace-pre-wrap">{grantsSql}</pre>}
          </div>
        )}
      </Step>

      <Step n={2} title="Sweep your estate"
        why="This app can only authenticate to the workspace it runs in. Download the extractor and run it on your machine under your own credentials, so it reaches every workspace you can. Metadata only — no table contents — and nothing leaves your machine until you upload the CSVs back.">
        {extractor.data?.available ? (
          <div className="text-xs text-navy-300 space-y-1">
            <a href="/api/ingestion/extractor/download"
              className="inline-block rounded bg-lava text-heading px-3 py-1.5 hover:bg-lava-600">⬇ Download extractor (.zip)</a>
            <div className="text-navy-500">{extractor.data.files?.length} files · {Math.round((extractor.data.total_bytes || 0)/1024)} KB · {extractor.data.requires?.join(', ')}</div>
            <div className="text-navy-500">Produces: {extractor.data.produces?.join(', ')}</div>
          </div>
        ) : <div className="text-xs text-navy-500">Extractor unavailable.</div>}
      </Step>

      <Step n={3} title="Upload the inventory"
        why="Upload the three CSVs the extractor produced. Re-uploading updates rows rather than duplicating them.">
        <div className="space-y-2">
          <CsvUpload label="schemas" kind="schemas" />
          <CsvUpload label="tables" kind="tables" />
          <CsvUpload label="columns" kind="columns" />
        </div>
      </Step>

      <Step n={4} title="Enrich"
        why="Raw table names don't say what a system is. AI names each schema and table in business terms so they can be matched to the catalog.">
        <div className="flex gap-2 flex-wrap">
          <ActionButton label="Enrich schemas" run={() => api.enrichSchemas()} />
          <ActionButton label="Enrich tables" run={() => api.enrichTables()} />
        </div>
      </Step>

      <Step n={5} title="Canonicalize"
        why="Collapse the free-text labels — otherwise ~1,000 distinct strings describe ~50 real systems and every rollup is noise.">
        <ActionButton label="Canonicalize" run={() => api.canonicalize()} />
      </Step>

      <Step n={6} title="Attribute to the catalog"
        why="Attach discovered tables to catalog modules — this is what turns 'we have 40,000 tables' into 'these use cases are now shovel-ready'. Attributed modules appear as discovered in the reconciliation below.">
        <ActionButton label="Attribute discovered tables" run={() => api.attribute()} />
      </Step>
    </div>
  );
}
