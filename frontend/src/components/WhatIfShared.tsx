import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

/**
 * Shared pieces for the What-If views (Spotlight / Clusters / Flow / Map):
 * the graph fetch, the land/curate simulation hook, and the right-side control panel.
 * All four views drive the SAME simulation so switching views never loses state.
 */

export type GraphData = Awaited<ReturnType<typeof api.whatifGraph>>;
export type RawNode = GraphData['nodes']['raw'][number];
export type ProductNode = GraphData['nodes']['product'][number];
export type UseCaseNode = GraphData['nodes']['use_case'][number];

export function money(n?: number) {
  if (!n) return '$0';
  return n >= 1 ? `$${n.toFixed(1)}M` : `$${(n * 1000).toFixed(0)}K`;
}

export const KIND_ACCENT: Record<string, string> = { raw: '#4a8fe7', product: '#b07be7', use_case: '#00a972' };

/** Readiness → {border,bg,color} for a use-case node/card. */
export function ucColors(readiness: string | null) {
  switch (readiness) {
    case 'shovel_ready': return { border: '#00a972', bg: 'rgba(0,169,114,.16)', color: '#7ee0b8', label: 'Shovel-ready' };
    case 'awaiting_prerequisites': return { border: '#4a8fe7', bg: 'rgba(74,143,231,.12)', color: '#a9c9f5', label: 'Awaiting prereqs' };
    case 'nearly_ready': return { border: '#ffab00', bg: 'rgba(255,171,0,.12)', color: '#ffd98a', label: 'Nearly ready' };
    default: return { border: '#e5484d', bg: 'rgba(229,72,77,.10)', color: '#f4a3a5', label: 'Blocked' };
  }
}

export function useGraphData() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.whatifGraph().then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setErr(e?.message || String(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);
  return { data, loading, err };
}

export type UnlockedUC = { id: number; title: string; phase: number | null; value_mm: number; in_portfolio: boolean; readiness: string };

/** How many top-value newly-unlocked non-portfolio use cases to surface by default. */
export const TOP_UNLOCKED = 8;

/** The use cases a view should render by default: everything in the portfolio, plus —
 *  while simulating — the top-value use cases the selection newly unlocks (which may
 *  not be in the portfolio). `showAll` reveals the ENTIRE catalog. This keeps the
 *  default readable (not 200+ boxes) while making the full opportunity reachable. */
export function visibleUseCases(data: GraphData, unlocked: UnlockedUC[], showAll: boolean): UseCaseNode[] {
  if (showAll) return data.nodes.use_case;
  const top = new Set(unlocked.slice(0, TOP_UNLOCKED).map((u) => u.id));
  return data.nodes.use_case.filter((u) => u.in_portfolio || top.has(u.id));
}

/** The whole land/curate simulation: which assets are selected, the gating rule
 *  (a product can't be curated until all its feeding raws are landed), the cost
 *  readout (whatifSimulate), AND the live projection (whatifProject) that recolours
 *  every use case as you select and lists what NEWLY unlocks — including use cases
 *  not yet in the portfolio. Shared by every view + the panel. */
export function useWhatIfSim(data: GraphData | null) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sim, setSim] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  // live projection
  const [projected, setProjected] = useState<Record<string, string>>({});
  const [unlocked, setUnlocked] = useState<UnlockedUC[]>([]);
  const projectTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const feedersByProduct = useMemo(() => {
    const m: Record<number, number[]> = {};
    data?.edges.feeds.forEach((e) => { (m[e.product_id] ||= []).push(e.raw_id); });
    return m;
  }, [data]);

  const rawLanded = useCallback((id: number) => {
    const r = data?.nodes.raw.find((x) => x.id === id);
    return (r?.ready ?? false) || selected.has(id);
  }, [data, selected]);

  const productActivatable = useCallback((pid: number) => {
    const feeders = feedersByProduct[pid] || [];
    return feeders.length > 0 ? feeders.every(rawLanded) : true;
  }, [feedersByProduct, rawLanded]);

  const recompute = useCallback((next: Set<number>) => {
    const pruned = new Set(next);
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of [...pruned]) {
        if (data?.nodes.product.some((p) => p.id === id)) {
          const feeders = feedersByProduct[id] || [];
          const ok = feeders.every((rid) => (data?.nodes.raw.find((x) => x.id === rid)?.ready) || pruned.has(rid));
          if (feeders.length > 0 && !ok) { pruned.delete(id); changed = true; }
        }
      }
    }
    setSelected(pruned);
    if (projectTimer.current) clearTimeout(projectTimer.current);
    if (pruned.size === 0) { setSim(null); setProjected({}); setUnlocked([]); return; }
    setBusy(true);
    api.whatifSimulate([...pruned]).then(setSim).catch(() => {}).finally(() => setBusy(false));
    // Debounced live projection: recolour every use case + list what newly unlocks.
    projectTimer.current = setTimeout(() => {
      api.whatifProject([...pruned])
        .then((r) => { setProjected(r.projected_readiness || {}); setUnlocked(r.unlocked || []); })
        .catch(() => {});
    }, 250);
  }, [data, feedersByProduct]);

  const toggle = useCallback((id: number, on: boolean) => {
    setSelected((prev) => { const n = new Set(prev); on ? n.add(id) : n.delete(id); recompute(n); return n; });
  }, [recompute]);

  const active = selected.size > 0;
  /** A use case's readiness in the current projection (falls back to its baseline). */
  const readinessFor = useCallback((ucId: number, baseline: string | null) =>
    (active ? projected[String(ucId)] : null) ?? baseline, [active, projected]);

  /** Baseline-ready use cases are what's ALREADY possible — muted while simulating so
   *  the eye goes to the incremental unlock, not the status quo. */
  const isBaselineReady = useCallback((n: { id: number; readiness: string | null }) =>
    n.readiness === 'shovel_ready', []);

  const newlyUnlockedIds = useMemo(() => new Set(unlocked.map((u) => u.id)), [unlocked]);

  const addToPortfolio = useCallback((id: number) => {
    setUnlocked((prev) => prev.map((u) => (u.id === id ? { ...u, in_portfolio: true } : u)));
    api.setPortfolio(id, true).catch(() => {});
  }, []);

  // node ids that should glow: the selected assets + the newly-unlocked use cases
  const highlightIds = useMemo(() => {
    const s = new Set<string>();
    selected.forEach((id) => { s.add(`raw-${id}`); s.add(`prod-${id}`); });
    unlocked.forEach((u) => s.add(`uc-${u.id}`));
    return s;
  }, [selected, unlocked]);

  const addedValue = useMemo(() => unlocked.reduce((a, u) => a + (u.value_mm || 0), 0), [unlocked]);

  return {
    selected, toggle, sim, busy, feedersByProduct, rawLanded, productActivatable, highlightIds,
    active, projected, readinessFor, isBaselineReady, unlocked, newlyUnlockedIds, addToPortfolio, addedValue,
  };
}

export type SimState = ReturnType<typeof useWhatIfSim>;

/** The right-side land/curate control panel + value readout. Shared by all views. */
export function WhatIfPanel({ data, s }: { data: GraphData; s: SimState }) {
  const raws = data.nodes.raw.filter((r) => !r.ready);
  const products = data.nodes.product.filter((p) => !p.ready);
  const [showAll, setShowAll] = useState(false);
  const TOP_N = 8;
  const shown = showAll ? s.unlocked : s.unlocked.slice(0, TOP_N);
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-heading">What if we land / curate…</div>
      <p className="text-[11px] text-navy-500">Land raw datasets freely. A data product can only be curated once <b>all</b> the raw datasets that feed it are landed.</p>

      <div className="text-[10px] uppercase tracking-wide text-info-400/80">Raw datasets</div>
      <div className="border border-navy-600 rounded-lg divide-y divide-navy-600/50 max-h-40 overflow-y-auto">
        {raws.map((r) => (
          <label key={r.id} className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-navy-800/40">
            <input type="checkbox" checked={s.selected.has(r.id)} onChange={(e) => s.toggle(r.id, e.target.checked)} />
            <span className="text-navy-300 truncate">{r.module}</span>
          </label>
        ))}
        {raws.length === 0 && <div className="px-2 py-2 text-[11px] text-navy-500">All raw datasets are landed.</div>}
      </div>

      <div className="text-[10px] uppercase tracking-wide text-violet-300/80">Data products</div>
      <div className="border border-navy-600 rounded-lg divide-y divide-navy-600/50 max-h-40 overflow-y-auto">
        {products.map((p) => {
          const feeders = s.feedersByProduct[p.id] || [];
          const activatable = s.productActivatable(p.id);
          const pending = feeders.filter((rid) => !s.rawLanded(rid)).length;
          return (
            <label key={p.id}
              title={activatable ? 'Curate this data product' : `Land all ${feeders.length} feeding dataset${feeders.length === 1 ? '' : 's'} first (${pending} pending) — a product can't be curated before its raw inputs are landed.`}
              className={`flex items-center gap-2 px-2 py-1.5 text-xs ${activatable ? 'cursor-pointer hover:bg-navy-800/40' : 'opacity-50 cursor-not-allowed'}`}>
              <input type="checkbox" disabled={!activatable} checked={s.selected.has(p.id)} onChange={(e) => s.toggle(p.id, e.target.checked)} />
              <span className="text-navy-300 truncate flex-1">{p.module}</span>
              {!activatable && <span className="text-[9px] text-warning-500 shrink-0">🔒 {pending} raw pending</span>}
            </label>
          );
        })}
        {products.length === 0 && <div className="px-2 py-2 text-[11px] text-navy-500">All data products are curated.</div>}
      </div>

      {/* Incremental unlock — the point of the What-If: additional potential the new
          data brings, NOT what's already possible today. */}
      {s.active && (
        <div className="border border-emerald-600/40 rounded-lg p-3 bg-emerald-600/5 text-xs space-y-1.5">
          <div className="text-heading font-semibold">
            ＋{s.unlocked.length} use case{s.unlocked.length === 1 ? '' : 's'} unlocked
            <span className="text-emerald-400"> · ＋{money(s.addedValue)}/yr</span>
          </div>
          {s.unlocked.some((u) => !u.in_portfolio) &&
            <div className="text-[10px] text-violet-300">{s.unlocked.filter((u) => !u.in_portfolio).length} not yet in your portfolio — the full opportunity</div>}
          {s.busy && <div className="text-[10px] text-navy-500">Simulating…</div>}
          {shown.length > 0 && (
            <div className="border border-navy-600 rounded-lg divide-y divide-navy-600/50 max-h-56 overflow-y-auto mt-1">
              {shown.map((u) => (
                <div key={u.id} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="text-[11px] text-navy-200 truncate flex-1">{u.title}</span>
                  <span className="text-[10px] text-emerald-400 shrink-0">{money(u.value_mm)}</span>
                  {u.in_portfolio
                    ? <span className="text-[9px] text-navy-500 shrink-0">in portfolio</span>
                    : <button onClick={() => s.addToPortfolio(u.id)} title="Not in your portfolio yet — add it"
                        className="text-[9px] shrink-0 px-1.5 py-0.5 rounded border border-violet-500/50 text-violet-300 hover:bg-violet-500/10">＋ add</button>}
                </div>
              ))}
            </div>
          )}
          {s.unlocked.length > TOP_N && (
            <button onClick={() => setShowAll((v) => !v)} className="text-[10px] text-info-400 hover:underline">
              {showAll ? 'Show top 8' : `Show all ${s.unlocked.length}`}
            </button>
          )}
          {s.unlocked.length === 0 && !s.busy && <div className="text-[10px] text-navy-500">No new use cases cross the line yet — add more feeders.</div>}
          {s.sim?.cost?.total_mid != null && <div className="text-[10px] text-navy-400 pt-1">Est. cost ~${(s.sim.cost.total_mid / 1e6).toFixed(1)}M{s.sim.payback_months != null ? ` · payback ~${s.sim.payback_months}mo` : ''}</div>}
        </div>
      )}
    </div>
  );
}
