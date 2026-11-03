/**
 * RoadmapBlendView — alternative roadmap layout that activates when the user
 * has composed a blend of 2+ industry packs. The polar "Blast Radius" works
 * great when there are 15-30 UCs in 6 domains, but for a blend that may union
 * 250+ UCs across 18 domains, the bubbles overlap unreadably.
 *
 * Design:
 *   - 3 columns, one per phase (Phase 1 / 2 / 3)
 *   - Inside each column: pack-grouped sections with the pack's color as a
 *     left rail stripe; the pack name + UC count is the section header
 *   - Inside each pack section: UCs grouped by domain, rendered as compact
 *     cards with name + value + status pip
 *   - Click any UC card to lock its dependency chain (same behavior as the
 *     polar view) — prerequisites highlight in amber, dependents in green,
 *     shared-data cousins in purple
 *   - Cross-pack dependencies are surfaced explicitly — a UC in pack A that
 *     depends on a UC in pack B is marked with a small "← pack B" hint
 *
 * Reuses the parent RoadmapView's lockedUcId / handleNodeClick handlers so
 * the user's mental model stays consistent between polar and blend views.
 */
import React, { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { ExternalLink, ArrowDownLeft, ArrowUpRight, Layers, GitBranch, Globe, Sparkles } from 'lucide-react';
import { USE_CASES, getUseCaseById, PHASE_NAMES, PHASE_COLORS } from '../data/useCases';
import type { UseCase } from '../data/useCases';
import type { AssessmentResults } from '../data/scoring';
import { useCaseMatchesUtility, type UtilityType, type AssessmentAnswers } from '../data/questions';
import { getActiveIndustryIds, getIndustries } from '../industries/active';
import type { IndustryMeta } from '../industries/types';
import { computeUseCaseValue, type BusinessAssumptions } from '../data/businessValue';
import { buildCrossIndustryIndex, getCrossIndustryGroups, type CrossIndustryGroup } from '../data/crossIndustry';
import { getValueOverride } from '../data/refinements';

type RelationType = 'selected' | 'prerequisite' | 'depends-on-this' | 'shared-data' | 'cross-industry-twin';

interface RoadmapBlendViewProps {
  results: AssessmentResults | null;
  answers: AssessmentAnswers | null;
  customerView: UtilityType | null;
  selectedUcId: string | null;
  industryIds: string[];
  assumptions: BusinessAssumptions;
  onSelect: (uc: UseCase) => void;
  onOpenDetail: (ucId: string) => void;
}

// Pack color palette — matches the one in RoadmapBlastRadius so the visual
// identity of each pack stays consistent across views.
const PACK_COLORS = [
  '#FF3621', '#1E90FF', '#00C896', '#FFB800',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F59E0B',
];

interface PackSlice {
  industry: IndustryMeta;
  color: string;
}

function getPackSlices(industryIds: string[]): PackSlice[] {
  const all: IndustryMeta[] = getIndustries();
  const packs = industryIds
    .map(id => all.find(p => p.id === id))
    .filter((p): p is IndustryMeta => !!p);
  return packs.map((p, i) => ({
    industry: p,
    color: PACK_COLORS[i % PACK_COLORS.length],
  }));
}

function ucStatus(uc: UseCase, results: AssessmentResults | null): 'completed' | 'recommended' | 'future' {
  if (!results) return 'future';
  if (results.completedUseCases.includes(uc.id)) return 'completed';
  if (results.recommendations.some(r => r.useCase.id === uc.id)) return 'recommended';
  return 'future';
}

export const RoadmapBlendView: React.FC<RoadmapBlendViewProps> = ({
  results, answers, customerView, selectedUcId, industryIds, assumptions, onSelect, onOpenDetail,
}) => {
  const activeIds = industryIds.length > 0 ? industryIds : (getActiveIndustryIds() as string[]);
  const slices = useMemo(() => getPackSlices(activeIds), [activeIds.join(',')]);
  const lockedUc = selectedUcId ? getUseCaseById(selectedUcId) : null;

  // Cross-industry: which UCs are twins across packs. Computed once and
  // reused for the top "Cross-Industry Foundations" panel + per-card badges.
  const crossGroups = useMemo(() => getCrossIndustryGroups(activeIds), [activeIds.join(',')]);
  const crossIndex = useMemo(() => buildCrossIndustryIndex(activeIds), [activeIds.join(',')]);

  // Filter: when on, only show cross-industry UCs (the enterprise-leverage
  // story) — useful for selling "single investment, multi-vertical impact".
  const [onlyCrossIndustry, setOnlyCrossIndustry] = useState(false);

  // Build the relationship map — same semantics as the polar view's
  // relatedMap so click-to-lock behavior matches across both visualizations.
  // Plus a new "cross-industry-twin" relation: if the locked UC has twins in
  // other packs, those twins highlight in a distinct color to make the
  // enterprise-wide impact obvious.
  const relatedMap = useMemo((): Map<string, RelationType> => {
    const map = new Map<string, RelationType>();
    if (!lockedUc) return map;
    const inScope = (uc: UseCase) =>
      !uc.industryId || activeIds.length === 0 || activeIds.includes(uc.industryId);

    map.set(lockedUc.id, 'selected');
    lockedUc.dependencies.forEach(dep => map.set(dep, 'prerequisite'));
    USE_CASES.forEach(uc => {
      if (!inScope(uc)) return;
      if (uc.dependencies.includes(lockedUc.id) && !map.has(uc.id)) {
        map.set(uc.id, 'depends-on-this');
      }
    });
    const lockedDeps = new Set(lockedUc.dependencies);
    USE_CASES.forEach(uc => {
      if (!inScope(uc)) return;
      if (map.has(uc.id) || uc.id === lockedUc.id) return;
      if (uc.dependencies.some(d => lockedDeps.has(d))) {
        map.set(uc.id, 'shared-data');
      }
    });
    // Cross-industry twins: every other UC in the same cluster.
    const lockedGroup = crossIndex.get(lockedUc.id);
    if (lockedGroup) {
      for (const twin of lockedGroup.ucs) {
        if (twin.id === lockedUc.id) continue;
        if (!map.has(twin.id)) map.set(twin.id, 'cross-industry-twin');
      }
    }
    return map;
  }, [lockedUc?.id, activeIds.join(','), crossIndex]);

  // Use cases in scope: belong to any active pack id and pass the customer-
  // view filter. Untagged rows (legacy P&U) pass through unconditionally.
  // When `onlyCrossIndustry` is on, narrow to UCs that are part of a
  // cross-industry cluster.
  const inScopeUcs = useMemo(() =>
    USE_CASES.filter(uc =>
      (!uc.industryId || activeIds.includes(uc.industryId)) &&
      useCaseMatchesUtility(uc.utilityTypes, customerView) &&
      (!onlyCrossIndustry || crossIndex.has(uc.id))
    ),
    [activeIds.join(','), customerView, onlyCrossIndustry, crossIndex]
  );

  // For each phase, group UCs by pack → domain.
  const byPhase = useMemo(() => {
    const out: Record<number, Map<string, Map<string, UseCase[]>>> = { 1: new Map(), 2: new Map(), 3: new Map() };
    for (const uc of inScopeUcs) {
      const ph = uc.phase as 1 | 2 | 3;
      if (!(ph in out)) continue;
      const packId = uc.industryId || 'pu';
      if (!out[ph].has(packId)) out[ph].set(packId, new Map());
      const byDomain = out[ph].get(packId)!;
      if (!byDomain.has(uc.domain)) byDomain.set(uc.domain, []);
      byDomain.get(uc.domain)!.push(uc);
    }
    return out;
  }, [inScopeUcs]);

  // Cross-pack dependency hints — for a UC in pack A, list any prerequisite
  // UCs in pack B. Shown as a small "←" annotation.
  const crossPackDeps = useMemo(() => {
    const idToPack = new Map<string, string>();
    inScopeUcs.forEach(uc => { if (uc.industryId) idToPack.set(uc.id, uc.industryId); });
    const out = new Map<string, string[]>();  // ucId → [other-pack labels]
    for (const uc of inScopeUcs) {
      const myPack = uc.industryId;
      if (!myPack) continue;
      const externalPacks = new Set<string>();
      for (const depId of uc.dependencies || []) {
        const depPack = idToPack.get(depId);
        if (depPack && depPack !== myPack) externalPacks.add(depPack);
      }
      if (externalPacks.size > 0) out.set(uc.id, Array.from(externalPacks));
    }
    return out;
  }, [inScopeUcs]);

  return (
    <div className="max-w-[1800px] mx-auto px-2">
      {/* Pack legend bar */}
      <div className="mb-5 flex flex-wrap items-center gap-4 px-2 py-3 rounded-lg bg-navy-800/60 border border-navy-600">
        <span className="text-[11px] uppercase tracking-wider text-navy-400">Blend</span>
        {slices.map(slice => {
          const packUcs = inScopeUcs.filter(u => (u.industryId || 'pu') === slice.industry.id);
          return (
            <div key={slice.industry.id} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: slice.color }} />
              <span className="text-sm font-medium text-heading">{slice.industry.shortLabel || slice.industry.label}</span>
              <span className="text-[11px] text-navy-400">{packUcs.length} UCs</span>
            </div>
          );
        })}
        <div className="flex-1" />
        {crossGroups.length > 0 && (
          <button
            onClick={() => setOnlyCrossIndustry(v => !v)}
            className={clsx(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] border transition-colors',
              onlyCrossIndustry
                ? 'border-electric/60 bg-electric/15 text-electric'
                : 'border-navy-500 text-navy-300 hover:text-heading hover:border-navy-400'
            )}
            title="Filter to only use cases that span multiple packs in your blend — the enterprise-wide leverage story"
          >
            <Globe className="w-3 h-3" />
            {onlyCrossIndustry
              ? `Showing ${crossGroups.length} cross-industry foundations`
              : `${crossGroups.length} cross-industry foundations available`}
          </button>
        )}
      </div>

      {/* Cross-Industry Foundations panel — only when relevant. Shows the
          enterprise-leverage story: "this single investment delivers across N
          of your verticals." */}
      {crossGroups.length > 0 && (
        <CrossIndustryFoundationsPanel
          groups={crossGroups}
          slices={slices}
          results={results}
          answers={answers}
          lockedUcId={selectedUcId}
          assumptions={assumptions}
          onSelect={onSelect}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map(phase => {
          const phaseColor = PHASE_COLORS[phase];
          const phaseName = PHASE_NAMES[phase];
          const phaseUcs = inScopeUcs.filter(uc => uc.phase === phase);
          return (
            <div key={phase} className="rounded-xl border border-navy-700 bg-navy-900/40 overflow-hidden flex flex-col">
              <div
                className="px-4 py-3 border-b"
                style={{ backgroundColor: `${phaseColor}10`, borderColor: `${phaseColor}40` }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: phaseColor }}>Phase {phase}</div>
                    <div className="text-sm font-semibold text-heading">{phaseName}</div>
                  </div>
                  <div className="text-xs text-navy-400">{phaseUcs.length} UCs</div>
                </div>
              </div>
              <div className="flex-1 p-3 space-y-4">
                {slices.map(slice => {
                  const byDomain = byPhase[phase].get(slice.industry.id);
                  if (!byDomain || byDomain.size === 0) return null;
                  const totalInPack = Array.from(byDomain.values()).reduce((s, arr) => s + arr.length, 0);
                  return (
                    <div
                      key={slice.industry.id}
                      className="rounded-lg border-l-4 bg-navy-800/60 border border-navy-700"
                      style={{ borderLeftColor: slice.color }}
                    >
                      <div className="px-3 py-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: slice.color }}>
                          {slice.industry.shortLabel || slice.industry.label}
                        </span>
                        <span className="text-[10px] text-navy-400">{totalInPack} UCs</span>
                      </div>
                      <div className="px-3 pb-3 space-y-2">
                        {Array.from(byDomain.entries()).map(([domain, ucs]) => (
                          <DomainGroup
                            key={domain}
                            domain={domain}
                            ucs={ucs}
                            results={results}
                            answers={answers}
                            lockedUcId={selectedUcId}
                            relatedMap={relatedMap}
                            crossPackDeps={crossPackDeps}
                            crossIndex={crossIndex}
                            packColor={slice.color}
                            assumptions={assumptions}
                            onSelect={onSelect}
                            onOpenDetail={onOpenDetail}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
                {phaseUcs.length === 0 && (
                  <div className="text-xs text-navy-400 italic text-center py-6">
                    No use cases in this phase for the selected blend.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend for relationship colors when something is locked */}
      {lockedUc && (
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-navy-300 px-2">
          <span className="text-[10px] uppercase tracking-wider text-navy-400">Relations</span>
          <span className="flex items-center gap-1.5"><GitBranch className="w-3 h-3 text-electric" /> Selected</span>
          <span className="flex items-center gap-1.5 text-amber-400"><ArrowDownLeft className="w-3 h-3" /> Prerequisite</span>
          <span className="flex items-center gap-1.5 text-emerald-400"><ArrowUpRight className="w-3 h-3" /> Builds on this</span>
          <span className="flex items-center gap-1.5 text-purple-300"><Layers className="w-3 h-3" /> Shared data</span>
          {crossIndex.has(lockedUc.id) && (
            <span className="flex items-center gap-1.5 text-cyan-300">
              <Globe className="w-3 h-3" /> Cross-industry twin
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// ── Cross-Industry Foundations panel ─────────────────────────────────────────

interface FoundationsPanelProps {
  groups: CrossIndustryGroup[];
  slices: PackSlice[];
  results: AssessmentResults | null;
  answers: AssessmentAnswers | null;
  lockedUcId: string | null;
  assumptions: BusinessAssumptions;
  onSelect: (uc: UseCase) => void;
}

const CrossIndustryFoundationsPanel: React.FC<FoundationsPanelProps> = ({
  groups, slices, results, answers, lockedUcId, assumptions, onSelect,
}) => {
  const [expanded, setExpanded] = useState(true);
  if (groups.length === 0) return null;
  const packLabel = (id: string) => {
    const s = slices.find(x => x.industry.id === id);
    return s ? (s.industry.shortLabel || s.industry.label) : id;
  };
  const packColor = (id: string) => slices.find(x => x.industry.id === id)?.color || '#94A3B8';

  return (
    <div className="mb-5 rounded-xl border border-cyan-500/30 bg-gradient-to-r from-cyan-500/5 via-navy-800/40 to-electric/5 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-navy-700/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-cyan-300" />
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold text-heading">Cross-Industry Foundations</div>
            <div className="text-[11px] text-navy-300 mt-0.5">
              {groups.length} investment{groups.length === 1 ? '' : 's'} that deliver value across {' '}
              {Math.max(...groups.map(g => g.industryIds.length))}+ verticals in your blend.
              One platform play, multi-LOB ROI.
            </div>
          </div>
        </div>
        <span className="text-[11px] text-navy-400">{expanded ? 'Collapse' : 'Expand'}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {groups.map(g => {
            // Use the lowest-phase representative as the canonical row.
            const sorted = [...g.ucs].sort((a, b) => (a.phase || 1) - (b.phase || 1));
            const head = sorted[0];
            const value = computeUseCaseValue(head.id, assumptions, answers ? getValueOverride(answers, head.id) : undefined);
            const phaseColor = PHASE_COLORS[head.phase || 1];
            const isLocked = lockedUcId && g.ucs.some(u => u.id === lockedUcId);
            return (
              <div
                key={g.key}
                className={clsx(
                  'rounded-lg border bg-navy-800/60 p-3',
                  isLocked ? 'border-electric ring-1 ring-electric/30' : 'border-navy-600 hover:border-navy-500'
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="text-sm font-medium text-heading leading-tight">{g.label}</div>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0"
                    style={{ backgroundColor: `${phaseColor}20`, color: phaseColor }}
                  >
                    Phase {head.phase || 1}
                  </span>
                </div>
                <div className="text-[10px] text-navy-300 mb-2">
                  Spans {g.industryIds.length} packs · est. ${value.annualValueLowMM}–{value.annualValueHighMM}M/yr per vertical
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {g.ucs.map(uc => {
                    const pid = uc.industryId || 'pu';
                    const status = ucStatus(uc, results);
                    return (
                      <button
                        key={uc.id}
                        onClick={() => onSelect(uc)}
                        className={clsx(
                          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] transition-colors',
                          uc.id === lockedUcId
                            ? 'border-electric bg-electric/15 text-heading'
                            : 'border-navy-500 hover:border-navy-400 text-slate-300'
                        )}
                        title={`Open ${packLabel(pid)} version`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: packColor(pid) }} />
                        {packLabel(pid)}
                        {status === 'completed' && <span className="text-status-green ml-0.5">✓</span>}
                        {status === 'recommended' && <span className="text-electric ml-0.5">★</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface DomainGroupProps {
  domain: string;
  ucs: UseCase[];
  results: AssessmentResults | null;
  answers: AssessmentAnswers | null;
  lockedUcId: string | null;
  relatedMap: Map<string, RelationType>;
  crossPackDeps: Map<string, string[]>;
  crossIndex: Map<string, CrossIndustryGroup>;
  packColor: string;
  assumptions: BusinessAssumptions;
  onSelect: (uc: UseCase) => void;
  onOpenDetail: (ucId: string) => void;
}

const DomainGroup: React.FC<DomainGroupProps> = ({
  domain, ucs, results, answers, lockedUcId, relatedMap, crossPackDeps, crossIndex,
  packColor, assumptions, onSelect, onOpenDetail,
}) => {
  return (
    <div>
      <div className="text-[10px] text-navy-400 mb-1">{domain}</div>
      <div className="space-y-1">
        {ucs.map(uc => {
          const status = ucStatus(uc, results);
          const relation = relatedMap.get(uc.id);
          const isLocked = uc.id === lockedUcId;
          const inGraph = lockedUcId ? relatedMap.has(uc.id) : true;
          const value = computeUseCaseValue(uc.id, assumptions, answers ? getValueOverride(answers, uc.id) : undefined);
          const externalDepPacks = crossPackDeps.get(uc.id);
          const twinGroup = crossIndex.get(uc.id);
          return (
            <button
              key={uc.id}
              onClick={() => onSelect(uc)}
              className={clsx(
                'w-full text-left p-2 rounded-md border transition-all duration-150 group relative',
                isLocked && 'border-electric bg-electric/15 ring-1 ring-electric/30',
                !isLocked && relation === 'prerequisite' && 'border-amber-500/50 bg-amber-500/5',
                !isLocked && relation === 'depends-on-this' && 'border-emerald-500/50 bg-emerald-500/5',
                !isLocked && relation === 'shared-data' && 'border-purple-500/50 bg-purple-500/5',
                !isLocked && relation === 'cross-industry-twin' && 'border-cyan-400/60 bg-cyan-400/10 ring-1 ring-cyan-400/20',
                !lockedUcId && twinGroup && 'border-cyan-400/30 bg-cyan-400/5',
                !lockedUcId && !twinGroup && status === 'completed' && 'border-status-green/40 bg-status-green/5',
                !lockedUcId && !twinGroup && status === 'recommended' && 'border-electric/40 bg-electric/5',
                !lockedUcId && !twinGroup && status === 'future' && 'border-navy-600 bg-navy-800/40 hover:border-navy-500',
                lockedUcId && !inGraph && 'opacity-25 border-navy-700'
              )}
              title={twinGroup
                ? `Cross-industry: also in ${twinGroup.ucs.filter(u => u.id !== uc.id).length} other pack(s) in your blend`
                : undefined}
            >
              {/* Pack color pip — anchors which pack this UC belongs to even
                  when relationship colors dominate the border. */}
              <div
                className="absolute top-1.5 left-1.5 w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: packColor }}
              />
              {results && !lockedUcId && (
                <div className={clsx(
                  'absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full',
                  status === 'completed' && 'bg-status-green',
                  status === 'recommended' && 'bg-electric animate-pulse',
                  status === 'future' && 'bg-navy-500',
                )} />
              )}
              <div className="text-xs font-medium text-heading leading-tight pl-3 pr-3 group-hover:text-electric transition-colors">
                {uc.name}
              </div>
              <div className="flex items-center gap-2 mt-1 text-[10px] pl-3 flex-wrap">
                <span className="text-slate-500">
                  {uc.complexity <= 2 ? 'Low' : uc.complexity <= 3 ? 'Med' : 'High'}
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-emerald-400 font-medium">
                  ${value.annualValueLowMM}–{value.annualValueHighMM}M/yr
                </span>
                {twinGroup && (
                  <span
                    className="inline-flex items-center gap-1 text-cyan-300 text-[9px]"
                    title="This use case spans multiple packs in your blend — a single investment delivers across multiple verticals."
                  >
                    <Globe className="w-2.5 h-2.5" />
                    × {twinGroup.industryIds.length} packs
                  </span>
                )}
                {externalDepPacks && externalDepPacks.length > 0 && (
                  <span className="text-purple-300 text-[9px]">
                    ← needs {externalDepPacks.join(', ')}
                  </span>
                )}
              </div>
              {isLocked && (
                <div
                  onClick={(e) => { e.stopPropagation(); onOpenDetail(uc.id); }}
                  className="mt-1 ml-3 inline-flex items-center gap-1 text-[10px] text-electric hover:text-heading"
                >
                  <ExternalLink className="w-2.5 h-2.5" /> View details
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
