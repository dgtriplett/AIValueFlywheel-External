import React, { useMemo, useState } from 'react';
import { GraphData, SimState, money, ucColors } from './WhatIfShared';

/**
 * Clusters — the whole estate, readable. Use cases as cards on top; raw datasets and
 * data products grouped by source system into big expandable cluster cards
 * (e.g. "Meter/AMI/MDM · 3/6 ready") instead of 50 tiny nodes. Click a cluster to
 * reveal its datasets. No zooming.
 */
export function WhatIfClusters({ data, s }: { data: GraphData; s: SimState }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const rawReady = (id: number) => (data.nodes.raw.find((r) => r.id === id)?.ready ?? false) || s.selected.has(id);
  const prodReady = (id: number) => (data.nodes.product.find((p) => p.id === id)?.ready ?? false) || s.selected.has(id);

  const groups = useMemo(() => {
    const g = (arr: any[]) => {
      const m: Record<string, any[]> = {};
      arr.forEach((n) => { (m[n.source_category || 'Other'] ||= []).push(n); });
      return Object.entries(m).sort((a, b) => b[1].length - a[1].length);
    };
    return { raw: g(data.nodes.raw), product: g(data.nodes.product) };
  }, [data]);

  const Cluster = ({ cat, items, kind }: { cat: string; items: any[]; kind: 'raw' | 'product' }) => {
    const ready = items.filter((n) => (kind === 'raw' ? rawReady(n.id) : prodReady(n.id))).length;
    const accent = kind === 'raw' ? '#4a8fe7' : '#b07be7';
    const key = `${kind}:${cat}`;
    const pct = items.length ? ready / items.length : 0;
    return (
      <div className="rounded-lg border border-navy-600 bg-navy-900/50 overflow-hidden" style={{ borderLeft: `4px solid ${accent}` }}>
        <button onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))} className="w-full text-left px-3 py-2.5 hover:bg-navy-800/50">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-heading truncate">{cat}</span>
            <span className="text-[11px] shrink-0" style={{ color: pct === 1 ? '#7ee0b8' : pct > 0 ? '#ffd98a' : '#8aa0bd' }}>{ready}/{items.length} ready</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-navy-700 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: accent }} />
          </div>
        </button>
        {open[key] && (
          <div className="divide-y divide-navy-600/40 border-t border-navy-600">
            {items.map((n) => {
              const isReady = kind === 'raw' ? rawReady(n.id) : prodReady(n.id);
              const feeders = kind === 'product' ? (s.feedersByProduct[n.id] || []) : [];
              const pending = feeders.filter((rid) => !rawReady(rid)).length;
              return (
                <div key={n.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: isReady ? '#00a972' : '#3a4a63' }} />
                  <span className="text-navy-300 truncate flex-1">{n.module}</span>
                  {kind === 'product' && !isReady && pending > 0 && <span className="text-[9px] text-warning-500 shrink-0">🔒 {pending}</span>}
                  {n.curate_effort && <span className="text-[9px] text-navy-500 shrink-0">{n.curate_effort}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Section accent="#00a972" title="Use cases">
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {data.nodes.use_case.map((u) => {
            const proj = s.readinessFor(u.id, u.readiness);
            const c = ucColors(proj);
            const newlyUnlocked = s.active && s.newlyUnlockedIds.has(u.id);
            const baselineReady = s.active && s.isBaselineReady(u) && !newlyUnlocked;  // already possible → mute
            return (
              <div key={u.id} className="rounded-lg border px-3 py-2 transition-opacity"
                style={{ borderColor: c.border, background: c.bg, opacity: baselineReady ? 0.4 : 1,
                         borderStyle: u.in_portfolio ? 'solid' : 'dashed',
                         boxShadow: newlyUnlocked ? `0 0 0 1.5px ${c.border}, 0 0 12px ${c.border}66` : undefined }}>
                <div className="flex items-start justify-between gap-1.5">
                  <div className="text-xs font-medium text-heading leading-snug">{u.title}</div>
                  {!u.in_portfolio && (
                    <button onClick={() => s.addToPortfolio(u.id)} title="Not in your portfolio yet — add it"
                      className="text-[9px] shrink-0 px-1.5 py-0.5 rounded border border-violet-500/50 text-violet-300 hover:bg-violet-500/10">＋ add</button>
                  )}
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: c.color }}>
                  {newlyUnlocked && <span className="text-emerald-300">✦ newly unlocked · </span>}{c.label} · {money(u.value_mm)}
                  {!u.in_portfolio && <span className="text-violet-300/80"> · not in portfolio</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Section>
      <Section accent="#b07be7" title="Data products — by source system">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {groups.product.map(([cat, items]) => <Cluster key={cat} cat={cat} items={items} kind="product" />)}
          {groups.product.length === 0 && <div className="text-xs text-navy-500 italic">No data products yet.</div>}
        </div>
      </Section>
      <Section accent="#4a8fe7" title="Raw datasets — by source system">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {groups.raw.map(([cat, items]) => <Cluster key={cat} cat={cat} items={items} kind="raw" />)}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide mb-2 font-semibold" style={{ color: accent }}>{title}</div>
      {children}
    </div>
  );
}
