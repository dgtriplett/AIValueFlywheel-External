import React, { useMemo } from 'react';
import { Sankey, Tooltip, ResponsiveContainer, Layer, Rectangle } from 'recharts';
import { GraphData, SimState, money } from './WhatIfShared';

/**
 * Flow — an aggregate Sankey: raw datasets (by source system) → data products (by
 * source system) → use cases. Band width = number of dependency links flowing
 * through. A clean big-picture "where does the value come from" view. Nodes are
 * coloured by how ready they are (green = all ready).
 */
export function WhatIfSankey({ data, s }: { data: GraphData; s: SimState }) {
  const rawReady = (id: number) => (data.nodes.raw.find((r) => r.id === id)?.ready ?? false) || s.selected.has(id);
  const prodReady = (id: number) => (data.nodes.product.find((p) => p.id === id)?.ready ?? false) || s.selected.has(id);

  const sankey = useMemo(() => {
    const rawCatOf: Record<number, string> = {};
    const rawReadyById: Record<number, boolean> = {};
    data.nodes.raw.forEach((r) => { rawCatOf[r.id] = `${r.source_category}`; rawReadyById[r.id] = rawReady(r.id); });
    const prodCatOf: Record<number, string> = {};
    data.nodes.product.forEach((p) => { prodCatOf[p.id] = `${p.source_category}`; });

    // node registry with readiness accumulation
    const nodes: { name: string; kind: string; ready: number; total: number }[] = [];
    const idx = new Map<string, number>();
    const ensure = (key: string, name: string, kind: string) => {
      if (!idx.has(key)) { idx.set(key, nodes.length); nodes.push({ name, kind, ready: 0, total: 0 }); }
      return idx.get(key)!;
    };
    // links keyed by source|target
    const linkMap = new Map<string, number>();
    const addLink = (sKey: string, tKey: string) => {
      const k = `${sKey}|||${tKey}`; linkMap.set(k, (linkMap.get(k) || 0) + 1);
    };

    // raw-cat → product-cat (feeds)
    data.edges.feeds.forEach((e) => {
      const rc = rawCatOf[e.raw_id], pc = prodCatOf[e.product_id];
      if (!rc || !pc) return;
      addLink(`raw:${rc}`, `prod:${pc}`);
    });
    // product-cat → use case, and raw-cat → use case (requires)
    const ucName: Record<number, string> = {};
    data.nodes.use_case.forEach((u) => { ucName[u.id] = u.title; });
    data.edges.requires.forEach((e) => {
      if (!ucName[e.use_case_id]) return;
      if (e.tier === 'product') { const pc = prodCatOf[e.asset_id]; if (pc) addLink(`prod:${pc}`, `uc:${e.use_case_id}`); }
      else { const rc = rawCatOf[e.asset_id]; if (rc) addLink(`raw:${rc}`, `uc:${e.use_case_id}`); }
    });
    if (linkMap.size === 0) return null;

    // materialize nodes referenced by links
    for (const key of new Set([...linkMap.keys()].flatMap((k) => k.split('|||')))) {
      const [kind, rest] = [key.split(':')[0], key.slice(key.indexOf(':') + 1)];
      if (kind === 'raw') ensure(key, rest, 'raw');
      else if (kind === 'prod') ensure(key, rest, 'product');
      else ensure(key, rest, 'use_case');
    }
    // readiness ratio per node
    data.nodes.raw.forEach((r) => { const i = idx.get(`raw:${rawCatOf[r.id]}`); if (i != null) { nodes[i].total++; if (rawReadyById[r.id]) nodes[i].ready++; } });
    data.nodes.product.forEach((p) => { const i = idx.get(`prod:${prodCatOf[p.id]}`); if (i != null) { nodes[i].total++; if (prodReady(p.id)) nodes[i].ready++; } });

    const links = [...linkMap.entries()].map(([k, value]) => {
      const [sKey, tKey] = k.split('|||');
      return { source: idx.get(sKey)!, target: idx.get(tKey)!, value };
    }).filter((l) => l.source != null && l.target != null && l.source !== l.target);
    return { nodes, links };
  }, [data, s.selected]);

  if (!sankey) return <div className="text-navy-400 text-sm border border-navy-600 rounded-lg p-6 text-center">Not enough dependency links to draw a flow yet.</div>;

  const NodeShape = (props: any) => {
    const { x, y, width, height, index, payload } = props;
    const n = sankey.nodes[index];
    const pct = n?.total ? n.ready / n.total : (n?.kind === 'use_case' ? 0.4 : 0);
    const color = n?.kind === 'use_case' ? '#00a972' : pct === 1 ? '#00a972' : pct > 0 ? '#ffab00' : n?.kind === 'product' ? '#b07be7' : '#4a8fe7';
    const isRight = x > 400;
    return (
      <Layer>
        <Rectangle x={x} y={y} width={width} height={height} fill={color} fillOpacity={0.85} radius={2} />
        <text x={isRight ? x - 6 : x + width + 6} y={y + height / 2} textAnchor={isRight ? 'end' : 'start'}
          dominantBaseline="middle" fontSize={11} fill="#c9d5e6">{payload?.name}</text>
      </Layer>
    );
  };

  return (
    <div className="border border-navy-600 rounded-lg bg-navy-900/40 p-2" style={{ height: 600 }}>
      <ResponsiveContainer width="100%" height="100%">
        <Sankey data={sankey} node={<NodeShape />} nodePadding={22} nodeWidth={12}
          margin={{ top: 16, bottom: 16, left: 140, right: 200 }}
          link={{ stroke: '#3a4a63', strokeOpacity: 0.35 }}>
          <Tooltip formatter={(v: any) => [`${v} link${v === 1 ? '' : 's'}`, 'flow']}
            contentStyle={{ background: '#0f1a2b', border: '1px solid #2b3b55', borderRadius: 8, fontSize: 12 }} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}
