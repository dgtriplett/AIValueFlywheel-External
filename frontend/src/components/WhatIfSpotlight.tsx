import React, { useMemo, useState } from 'react';
import { GraphData, SimState, money, ucColors } from './WhatIfShared';

/**
 * Spotlight — pick one use case and see ONLY its dependency chain as a few large,
 * readable cards: the use case on top, the curated data products it requires in the
 * middle, the raw datasets feeding those (plus any directly-required raw) at the
 * bottom, and a strip of the use cases it unlocks. No zooming, no clutter.
 */
export function WhatIfSpotlight({ data, s }: { data: GraphData; s: SimState }) {
  const ucs = data.nodes.use_case;
  const [focal, setFocal] = useState<number | null>(ucs[0]?.id ?? null);
  const [q, setQ] = useState('');

  const rawById = useMemo(() => Object.fromEntries(data.nodes.raw.map((r) => [r.id, r])), [data]);
  const prodById = useMemo(() => Object.fromEntries(data.nodes.product.map((p) => [p.id, p])), [data]);
  const ucById = useMemo(() => Object.fromEntries(ucs.map((u) => [u.id, u])), [ucs]);
  const feedersByProduct = s.feedersByProduct;

  const chain = useMemo(() => {
    if (focal == null) return null;
    const reqs = data.edges.requires.filter((e) => e.use_case_id === focal);
    const productIds = reqs.filter((r) => r.tier === 'product').map((r) => r.asset_id);
    const directRawIds = reqs.filter((r) => r.tier !== 'product').map((r) => r.asset_id);
    const feederRawIds = new Set<number>(directRawIds);
    productIds.forEach((pid) => (feedersByProduct[pid] || []).forEach((rid) => feederRawIds.add(rid)));
    const unlocks = data.edges.enables.filter((e) => e.from_use_case_id === focal).map((e) => e.to_use_case_id);
    return { productIds, rawIds: [...feederRawIds], directRawIds: new Set(directRawIds), unlocks };
  }, [focal, data, feedersByProduct]);

  const filtered = ucs.filter((u) => u.title.toLowerCase().includes(q.toLowerCase()));
  const focalUc = focal != null ? ucById[focal] : null;

  const assetReady = (id: number, isProduct: boolean) => {
    const node = isProduct ? prodById[id] : rawById[id];
    return (node?.ready ?? false) || s.selected.has(id);
  };

  return (
    <div className="grid lg:grid-cols-[240px_1fr] gap-4 min-h-[560px]">
      {/* use-case picker */}
      <div className="border border-navy-600 rounded-lg bg-navy-900/50 flex flex-col">
        <div className="p-2 border-b border-navy-600">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search use cases…"
            className="w-full rounded-md border border-navy-600 bg-navy-800 px-2 py-1.5 text-xs text-heading" />
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-navy-600/40">
          {filtered.map((u) => {
            const c = ucColors(u.readiness);
            const active = u.id === focal;
            return (
              <button key={u.id} onClick={() => setFocal(u.id)}
                className={`w-full text-left px-3 py-2 text-xs ${active ? 'bg-navy-700' : 'hover:bg-navy-800/60'}`}>
                <div className="text-heading font-medium leading-snug">{u.title}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.border }} />
                  <span className="text-[10px] text-navy-400">{c.label} · {money(u.value_mm)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* the chain */}
      <div className="border border-navy-600 rounded-lg bg-navy-900/40 p-5 overflow-y-auto">
        {!focalUc || !chain ? (
          <div className="text-navy-400 text-sm">Pick a use case to see what it takes to build.</div>
        ) : (
          <div className="space-y-5">
            {/* USE CASE */}
            <div>
              <SectionLabel>Use case</SectionLabel>
              <div className="rounded-xl border p-4 max-w-xl" style={{ borderColor: ucColors(focalUc.readiness).border, background: ucColors(focalUc.readiness).bg }}>
                <div className="text-base font-semibold text-heading">{focalUc.title}</div>
                <div className="text-xs mt-1" style={{ color: ucColors(focalUc.readiness).color }}>
                  {ucColors(focalUc.readiness).label} · {money(focalUc.value_mm)}/yr · Phase {focalUc.phase ?? '—'}
                </div>
                <div className="text-[11px] text-navy-400 mt-2">
                  Needs {chain.productIds.length} data product{chain.productIds.length === 1 ? '' : 's'} + {chain.rawIds.length} raw dataset{chain.rawIds.length === 1 ? '' : 's'}
                  {chain.productIds.length === 0 && ' — raw data only, less curation work'}
                </div>
              </div>
            </div>

            <Arrow label="requires ↑ (curated products)" />

            {/* DATA PRODUCTS */}
            <div>
              <SectionLabel accent="#b07be7">Curated data products required</SectionLabel>
              {chain.productIds.length === 0 ? (
                <div className="text-xs text-navy-500 italic">None — this use case runs on raw data directly.</div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {chain.productIds.map((pid) => {
                    const p = prodById[pid]; if (!p) return null;
                    const ready = assetReady(pid, true);
                    const feeders = feedersByProduct[pid] || [];
                    const pending = feeders.filter((rid) => !assetReady(rid, false)).length;
                    return (
                      <div key={pid} className="rounded-lg border p-3 w-56"
                        style={{ borderColor: ready ? '#00a972' : '#7d5aa8', background: ready ? 'rgba(0,169,114,.14)' : 'rgba(176,123,231,.10)' }}>
                        <div className="text-sm font-medium text-heading leading-snug">{p.module}</div>
                        <div className="text-[10px] text-navy-400 mt-1">{p.source_category}{p.curate_effort ? ` · curate ${p.curate_effort}` : ''}</div>
                        <div className="text-[10px] mt-1" style={{ color: ready ? '#7ee0b8' : pending ? '#ffab00' : '#c9b3e7' }}>
                          {ready ? '✓ curated' : pending ? `🔒 ${pending} feeding dataset${pending === 1 ? '' : 's'} pending` : 'ready to curate'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <Arrow label="built from ↑ (raw datasets)" />

            {/* RAW DATASETS */}
            <div>
              <SectionLabel accent="#4a8fe7">Raw datasets</SectionLabel>
              <div className="flex flex-wrap gap-2.5">
                {chain.rawIds.map((rid) => {
                  const r = rawById[rid]; if (!r) return null;
                  const landed = assetReady(rid, false);
                  const direct = chain.directRawIds.has(rid);
                  return (
                    <div key={rid} className="rounded-lg border px-3 py-2 w-52"
                      style={{ borderColor: landed ? '#00a972' : '#365581', background: landed ? 'rgba(0,169,114,.12)' : 'rgba(74,143,231,.07)' }}>
                      <div className="text-xs font-medium text-heading leading-snug">{r.module}</div>
                      <div className="text-[10px] text-navy-400 mt-0.5">{r.source_category}{direct ? ' · direct' : ''}</div>
                      <div className="text-[10px] mt-0.5" style={{ color: landed ? '#7ee0b8' : '#9fb8db' }}>{landed ? '✓ landed' : 'not landed'}</div>
                    </div>
                  );
                })}
                {chain.rawIds.length === 0 && <div className="text-xs text-navy-500 italic">No raw datasets mapped.</div>}
              </div>
            </div>

            {/* UNLOCKS */}
            {chain.unlocks.length > 0 && (
              <div className="pt-2 border-t border-navy-600/50">
                <SectionLabel accent="#00a972">Delivering this unlocks →</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  {chain.unlocks.map((uid) => {
                    const u = ucById[uid]; if (!u) return null;
                    return (
                      <button key={uid} onClick={() => setFocal(uid)}
                        className="text-xs rounded-full border border-navy-600 px-3 py-1 text-navy-300 hover:bg-navy-700">
                        {u.title} · {money(u.value_mm)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children, accent = '#00a972' }: { children: React.ReactNode; accent?: string }) {
  return <div className="text-[10px] uppercase tracking-wide mb-2 font-semibold" style={{ color: accent }}>{children}</div>;
}
function Arrow({ label }: { label: string }) {
  return <div className="text-[10px] text-navy-500 pl-1">{label}</div>;
}
