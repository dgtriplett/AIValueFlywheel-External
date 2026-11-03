import React, { useCallback, useMemo, useState } from 'react';
import ReactFlow, { Background, Controls, MarkerType, Position, type Node, type Edge, type NodeProps } from 'reactflow';
import 'reactflow/dist/style.css';
import {
  GraphData, useGraphData, useWhatIfSim, WhatIfPanel, money, KIND_ACCENT, visibleUseCases,
} from './WhatIfShared';
import { WhatIfClusters } from './WhatIfClusters';

// Re-exported so RoadmapTimelapse can keep importing from './WhatIfGraph'.
export { useGraphData } from './WhatIfShared';

/**
 * The What-If tab: TWO views behind a toggle, sharing one land/curate panel + the live
 * projection, so switching views never loses the simulation:
 *   Clusters — the whole estate grouped by source system (default; readable)
 *   Map      — the full bottom-up dependency graph (power-user overview)
 * As datasets are selected, use cases recolour live and the panel lists the INCREMENTAL
 * unlock (including use cases not yet in the portfolio). The banded React-Flow graph
 * (`toFlow`/`DependencyFlow`) also powers the timelapse.
 */

// ---- Map view: bottom-up banded React Flow graph ----------------------------
const LAYER_Y = { use_case: 70, product: 400, raw: 730 };
const BAND_H = 250;
const COL_W = 230;
const NODE_W = 200;
const BAND_LABEL: Record<string, string> = { raw: 'RAW DATASETS', product: 'DATA PRODUCTS', use_case: 'USE CASES' };
const BAND_TINT: Record<string, string> = {
  raw: 'rgba(74,143,231,.06)', product: 'rgba(176,123,231,.07)', use_case: 'rgba(0,169,114,.05)',
};
const BAND_BORDER: Record<string, string> = { raw: '#2b4a6b', product: '#4a3a63', use_case: '#274a3f' };

function nodeStyle(kind: 'raw' | 'product' | 'use_case', ready: boolean, readiness: string | null, lit: boolean): React.CSSProperties {
  let border = '#3a4a63', bg = '#0f1a2b', color = '#9fb3d0';
  if (kind === 'use_case') {
    if (readiness === 'shovel_ready') { border = '#00a972'; bg = 'rgba(0,169,114,.16)'; color = '#7ee0b8'; }
    else if (readiness === 'awaiting_prerequisites') { border = '#4a8fe7'; bg = 'rgba(74,143,231,.12)'; color = '#a9c9f5'; }
    else if (readiness === 'nearly_ready') { border = '#ffab00'; bg = 'rgba(255,171,0,.12)'; color = '#ffd98a'; }
    else { border = '#e5484d'; bg = 'rgba(229,72,77,.10)'; color = '#f4a3a5'; }
  } else if (kind === 'product') {
    if (ready) { border = '#00a972'; bg = 'rgba(0,169,114,.16)'; color = '#7ee0b8'; }
    else { border = '#7d5aa8'; bg = 'rgba(176,123,231,.10)'; color = '#c9b3e7'; }
  } else {
    if (ready) { border = '#00a972'; bg = 'rgba(0,169,114,.14)'; color = '#7ee0b8'; }
    else { border = '#365581'; bg = 'rgba(74,143,231,.08)'; color = '#9fb8db'; }
  }
  return {
    border: `1px solid ${border}`, borderLeft: `4px solid ${KIND_ACCENT[kind]}`,
    background: bg, color, borderRadius: 8, padding: '8px 12px', fontSize: 12.5, lineHeight: 1.25, width: NODE_W,
    opacity: lit ? 1 : 0.16, transition: 'opacity .5s ease, background .5s ease, border-color .5s ease, box-shadow .3s ease',
  };
}

function BandNode({ data }: NodeProps) {
  return (
    <div style={{ width: data.w, height: BAND_H, background: data.bg, border: `1px dashed ${data.bc}`, borderRadius: 14, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', top: 10, left: 14, fontSize: 12, fontWeight: 700, letterSpacing: '.1em', color: data.fg }}>{data.label}</div>
    </div>
  );
}
export const nodeTypes = { band: BandNode };

/** Build React Flow nodes/edges, bottom-up + banded. Kept signature-stable for the
 *  timelapse: litIds dims non-lit; highlightIds glows a subset; focusIds spotlights. */
export function toFlow(
  data: GraphData,
  litIds: Set<string> | null,
  highlightIds: Set<string> | null,
  opts?: { focusIds?: Set<string> | null; projectedReadiness?: Record<string, string> | null; mutedIds?: Set<string> | null },
): { nodes: Node[]; edges: Edge[] } {
  const focusIds = opts?.focusIds ?? null;
  const projected = opts?.projectedReadiness ?? null;
  const mutedIds = opts?.mutedIds ?? null;
  const nodes: Node[] = [];
  const idOf = (k: string, id: number) => `${k}-${id}`;
  const maxCount = Math.max(data.nodes.raw.length, data.nodes.product.length, data.nodes.use_case.length, 1);
  const bandW = maxCount * COL_W + 80;

  (['use_case', 'product', 'raw'] as const).forEach((kind) => {
    nodes.push({
      id: `band-${kind}`, type: 'band', draggable: false, selectable: false, connectable: false,
      position: { x: -40, y: LAYER_Y[kind] - 40 }, zIndex: -1, focusable: false,
      data: { w: bandW, label: BAND_LABEL[kind], bg: BAND_TINT[kind], bc: BAND_BORDER[kind], fg: KIND_ACCENT[kind] },
      style: { pointerEvents: 'none' },
    });
  });

  const place = (arr: any[], kind: 'raw' | 'product' | 'use_case') =>
    arr.forEach((n, i) => {
      const nid = idOf(kind === 'use_case' ? 'uc' : kind === 'product' ? 'prod' : 'raw', n.id);
      let lit = litIds ? litIds.has(nid) : true;
      if (focusIds && !focusIds.has(nid)) lit = false;
      // Use cases recolour to their PROJECTED readiness as the user selects feeders.
      const readiness = (kind === 'use_case' && projected && projected[String(n.id)]) || (n.readiness ?? null);
      const style = nodeStyle(kind, !!n.ready, readiness, lit);
      if ((highlightIds && highlightIds.has(nid)) || (focusIds && focusIds.has(nid))) {
        style.boxShadow = `0 0 0 2px ${KIND_ACCENT[kind]}, 0 0 16px ${KIND_ACCENT[kind]}88`;
        style.opacity = 1;
      }
      // Already-possible-today use cases are muted while simulating, so the eye goes
      // to the incremental unlock rather than the status quo.
      if (mutedIds && mutedIds.has(nid) && !(highlightIds && highlightIds.has(nid))) {
        style.opacity = Math.min((style.opacity as number) ?? 1, 0.32);
      }
      // Catalog use cases not in the portfolio read as dashed + "＋" so the full
      // opportunity is visually distinct from the committed shortlist.
      const notInPortfolio = kind === 'use_case' && n.in_portfolio === false;
      if (notInPortfolio) style.borderStyle = 'dashed';
      const label = kind === 'use_case'
        ? `${notInPortfolio ? '＋ ' : ''}${n.title}${n.value_mm ? ` · ${money(n.value_mm)}` : ''}`
        : n.module;
      nodes.push({
        id: nid, position: { x: 24 + i * COL_W, y: LAYER_Y[kind] },
        data: { label, kind },
        style, sourcePosition: Position.Top, targetPosition: Position.Bottom,
      });
    });
  place(data.nodes.raw, 'raw');
  place(data.nodes.product, 'product');
  place(data.nodes.use_case, 'use_case');

  const known = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = [];
  const addEdge = (src: string, tgt: string, kind: 'feeds' | 'requires' | 'enables') => {
    if (!known.has(src) || !known.has(tgt)) return;
    let active = !litIds || (litIds.has(src) && litIds.has(tgt));
    if (focusIds) active = focusIds.has(src) && focusIds.has(tgt);
    const COLORS = { feeds: '#22b8cf', requires: '#5a6b86', enables: '#b07be7' };
    edges.push({
      id: `${kind}-${src}-${tgt}`, source: src, target: tgt, type: 'smoothstep',
      style: {
        stroke: COLORS[kind], strokeWidth: kind === 'feeds' ? 2.4 : 1.2,
        opacity: active ? (kind === 'feeds' ? 1 : 0.85) : 0.08,
        strokeDasharray: kind === 'feeds' ? undefined : kind === 'enables' ? '4 3' : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: COLORS[kind], width: kind === 'feeds' ? 20 : 14 },
      animated: kind === 'feeds' && active,
    });
  };
  data.edges.feeds.forEach((e) => addEdge(idOf('raw', e.raw_id), idOf('prod', e.product_id), 'feeds'));
  data.edges.requires.forEach((e) => addEdge(idOf(e.tier === 'product' ? 'prod' : 'raw', e.asset_id), idOf('uc', e.use_case_id), 'requires'));
  data.edges.enables.forEach((e) => addEdge(idOf('uc', e.from_use_case_id), idOf('uc', e.to_use_case_id), 'enables'));
  return { nodes, edges };
}

export function DependencyFlow({ nodes, edges, height = 640, onNodeClick, onPaneClick }: {
  nodes: Node[]; edges: Edge[]; height?: number;
  onNodeClick?: (id: string) => void; onPaneClick?: () => void;
}) {
  return (
    <div style={{ height }} className="border border-navy-600 rounded-lg bg-navy-900/60">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView proOptions={{ hideAttribution: true }}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={!!onNodeClick} minZoom={0.1}
        onNodeClick={(_, n) => onNodeClick?.(n.id)} onPaneClick={() => onPaneClick?.()}>
        <Background color="#1e2b40" gap={22} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function Legend() {
  const item = (c: string, dash: boolean, w: number, label: string) => (
    <span className="flex items-center gap-1.5 text-[10px] text-navy-400">
      <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={c} strokeWidth={w} strokeDasharray={dash ? '4 3' : undefined} /></svg>{label}
    </span>
  );
  return (
    <div className="flex gap-4 flex-wrap px-1">
      {item('#22b8cf', false, 2.4, 'feeds (raw→product)')}
      {item('#5a6b86', false, 1.5, 'requires (data→use case)')}
      {item('#b07be7', true, 1.5, 'enables (use case→use case)')}
    </div>
  );
}

// Map view — the full graph with sim highlighting + click-to-spotlight a product.
function MapView({ data, s }: { data: GraphData; s: ReturnType<typeof useWhatIfSim> }) {
  const [focusProduct, setFocusProduct] = useState<number | null>(null);
  const focusIds = useMemo(() => {
    if (focusProduct == null) return null;
    const set = new Set<string>([`prod-${focusProduct}`]);
    (s.feedersByProduct[focusProduct] || []).forEach((rid) => set.add(`raw-${rid}`));
    return set;
  }, [focusProduct, s.feedersByProduct]);
  const mutedIds = useMemo(() => {
    if (!s.active) return null;
    const m = new Set<string>();
    data.nodes.use_case.forEach((u) => { if (s.isBaselineReady(u)) m.add(`uc-${u.id}`); });
    return m;
  }, [s.active, s.isBaselineReady, data]);
  const flow = useMemo(() => toFlow(data, null, s.highlightIds, { focusIds, projectedReadiness: s.projected, mutedIds }),
    [data, s.highlightIds, focusIds, s.projected, mutedIds]);
  const onNodeClick = useCallback((id: string) => setFocusProduct(id.startsWith('prod-') ? Number(id.slice(5)) : null), []);
  return (
    <>
      <Legend />
      <DependencyFlow nodes={flow.nodes} edges={flow.edges} onNodeClick={onNodeClick} onPaneClick={() => setFocusProduct(null)} />
    </>
  );
}

type View = 'clusters' | 'map';
const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: 'clusters', label: 'Clusters', hint: 'Whole estate grouped by source system' },
  { id: 'map', label: 'Map', hint: 'Full dependency graph' },
];

export function WhatIfGraph() {
  const { data, loading, err } = useGraphData();
  const s = useWhatIfSim(data);
  const [view, setView] = useState<View>(() => {
    try { const v = localStorage.getItem('gc.whatifView'); return (v === 'clusters' || v === 'map') ? v : 'clusters'; }
    catch { return 'clusters'; }
  });
  const [showAll, setShowAll] = useState(false);
  const pick = (v: View) => { setView(v); try { localStorage.setItem('gc.whatifView', v); } catch { /* ignore */ } };

  // The view renders portfolio + top-value unlocked by default; "show all" reveals the
  // whole catalog. The PANEL + sim keep the FULL data (all feeders/edges/projection).
  const viewData: GraphData | null = useMemo(() => {
    if (!data) return null;
    const ucs = visibleUseCases(data, s.unlocked, showAll);
    return { ...data, nodes: { ...data.nodes, use_case: ucs } };
  }, [data, s.unlocked, showAll]);

  if (loading) return <div className="text-navy-400 text-sm">Loading dependency graph…</div>;
  if (err) return <div className="text-rose-500 text-sm">{err}</div>;
  if (!data || !viewData || data.nodes.use_case.length === 0)
    return <div className="text-navy-400 text-sm border border-navy-600 rounded-lg p-6 text-center">No use cases in the catalog yet.</div>;

  const hint = VIEWS.find((v) => v.id === view)?.hint;
  const total = data.nodes.use_case.length;
  const shownCount = viewData.nodes.use_case.length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-lg bg-navy-800 p-0.5 text-sm">
            {VIEWS.map((v) => (
              <button key={v.id} onClick={() => pick(v.id)}
                className={`px-3 py-1 rounded-md font-medium ${view === v.id ? 'bg-navy-700 text-heading shadow-sm' : 'text-navy-400 hover:text-heading'}`}>{v.label}</button>
            ))}
          </div>
          <button onClick={() => setShowAll((v) => !v)}
            className={`px-3 py-1 rounded-md text-xs font-medium border ${showAll ? 'border-violet-500/60 text-violet-200 bg-violet-500/10' : 'border-navy-600 text-navy-400 hover:text-heading'}`}
            title="Show the entire use-case catalog, not just your portfolio + top unlocked">
            {showAll ? `Showing all ${total} use cases` : `Show all catalog (${total})`}
          </button>
          <span className="text-[10px] text-navy-500">{shownCount} of {total} shown</span>
        </div>
        <p className="text-[11px] text-navy-500">{hint} · <span className="text-info-400">raw</span> → <span className="text-violet-300">product</span> → <span className="text-emerald-400">use case</span></p>
      </div>
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="min-w-0">
          {view === 'clusters' && <WhatIfClusters data={viewData} s={s} />}
          {view === 'map' && <MapView data={viewData} s={s} />}
        </div>
        <WhatIfPanel data={data} s={s} />
      </div>
    </div>
  );
}
