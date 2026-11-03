import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import {
  ArrowLeft, Filter, ChevronDown, ChevronRight, DollarSign,
  X, ZoomIn, ZoomOut, Info, ExternalLink, GitBranch, ArrowUpRight, ArrowDownLeft, Layers,
  LayoutGrid, Radar,
} from 'lucide-react';
import { USE_CASES, UseCase, PHASE_NAMES, PHASE_COLORS, DOMAIN_NAMES, DOMAIN_COLORS, getUseCaseById } from '../data/useCases';
import type { AssessmentResults, RecommendedUseCase } from '../data/scoring';
import type { AssessmentAnswers } from '../data/questions';
import {
  BusinessAssumptions, DEFAULT_ASSUMPTIONS, computeUseCaseValue, ASSUMPTION_FIELDS,
  assumptionFieldsFor, assumptionFieldsForIndustry, type AssumptionField,
} from '../data/businessValue';
import type { IndustryMeta } from '../industries/types';
import { useCaseMatchesUtility, UTILITY_TYPE_OPTIONS, type UtilityType } from '../data/questions';
import { CURRENCY_META, DEFAULT_LOCALE, localizeUnit, type CurrencyCode, type LocalePrefs, type UnitSystem } from '../data/locale';
import { UseCaseDetailCard } from './UseCaseDetailCard';
import { ErrorBoundary } from './ErrorBoundary';
import { RoadmapBlastRadius } from './RoadmapBlastRadius';
import { RoadmapBlendView } from './RoadmapBlendView';
import {
  useActiveIndustry, useIndustries, useActiveIndustryIds,
  setActiveIndustryId, setActiveIndustryIds, isBlendActive,
} from '../industries/active';
import { IndustryBlendPicker } from './IndustryBlendPicker';
import { useBlendPresets } from '../industries/presets';
import { getValueOverride } from '../data/refinements';

interface RoadmapViewProps {
  results: AssessmentResults | null;
  answers: AssessmentAnswers | null;
  onBack: () => void;
  assumptions?: BusinessAssumptions;
  onAssumptionsChange?: (a: BusinessAssumptions) => void;
  locale?: LocalePrefs;
  onLocaleChange?: (l: LocalePrefs) => void;
  fxRates?: Record<CurrencyCode, number>;
}

type DomainFilter = string | 'all';
type LayoutMode = 'grid' | 'blast';
// CustomerViewFilter — 'all' or any industry-pack customer-type id (P&U
// utilityType ids, T&L customer-type ids, etc.).
type CustomerViewFilter = string;

// ── Relationship types for labels ───────────────────────────────────────────

type RelationType = 'selected' | 'prerequisite' | 'depends-on-this' | 'shared-data';

function getRelationship(
  targetUcId: string,
  selectedUc: UseCase
): RelationType | null {
  if (targetUcId === selectedUc.id) return 'selected';

  // Is targetUc a prerequisite of selectedUc?
  if (selectedUc.dependencies.includes(targetUcId)) return 'prerequisite';

  // Does targetUc depend on selectedUc?
  const targetUc = getUseCaseById(targetUcId);
  if (targetUc?.dependencies.includes(selectedUc.id)) return 'depends-on-this';

  // Shared data dependency (transitive — they share a common prerequisite)
  if (targetUc) {
    const selectedDeps = new Set(selectedUc.dependencies);
    const hasShared = targetUc.dependencies.some(d => selectedDeps.has(d));
    if (hasShared) return 'shared-data';
  }

  return null;
}

const RELATION_CONFIG: Record<RelationType, { label: string; icon: React.ReactNode; color: string }> = {
  'selected': { label: 'Selected', icon: <GitBranch className="w-3 h-3" />, color: '#1E90FF' },
  'prerequisite': { label: 'Prerequisite', icon: <ArrowDownLeft className="w-3 h-3" />, color: '#F59E0B' },
  'depends-on-this': { label: 'Builds on this', icon: <ArrowUpRight className="w-3 h-3" />, color: '#10B981' },
  'shared-data': { label: 'Shared data', icon: <Layers className="w-3 h-3" />, color: '#8B5CF6' },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function getNodeStatus(
  uc: UseCase,
  results: AssessmentResults | null
): 'completed' | 'recommended' | 'future' {
  if (!results) return 'future';
  if (results.completedUseCases.includes(uc.id)) return 'completed';
  if (results.recommendations.some(r => r.useCase.id === uc.id)) return 'recommended';
  return 'future';
}

// ── Component ───────────────────────────────────────────────────────────────

export const RoadmapView: React.FC<RoadmapViewProps> = ({
  results, answers, onBack, assumptions: assumptionsProp, onAssumptionsChange,
  locale, onLocaleChange, fxRates,
}) => {
  const industry = useActiveIndustry();
  const industries = useIndustries();
  const [domainFilter, setDomainFilter] = useState<DomainFilter>('all');
  // Customer-view filter: pre-select to the assessed customer's type if we
  // have one (so the user's roadmap pre-narrows to relevant work), otherwise
  // 'all' for free exploration.
  const [customerView, setCustomerView] = useState<CustomerViewFilter>(
    answers?.profile?.utilityType ?? 'all'
  );
  const [lockedUcId, setLockedUcId] = useState<string | null>(null);        // click-to-lock highlighting
  const [detailUcId, setDetailUcId] = useState<string | null>(null);        // detail panel open
  // If parent supplies assumptions + onChange, use them; otherwise own local state.
  const [localAssumptions, setLocalAssumptions] = useState<BusinessAssumptions>({ ...DEFAULT_ASSUMPTIONS });
  const assumptions = assumptionsProp ?? localAssumptions;
  const setAssumptions = (a: BusinessAssumptions) => {
    if (onAssumptionsChange) onAssumptionsChange(a);
    else setLocalAssumptions(a);
  };
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showBlendPicker, setShowBlendPicker] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [layout, setLayout] = useState<LayoutMode>('blast');
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeIndustryIds = useActiveIndustryIds();
  const blendPresets = useBlendPresets();

  const lockedUc = lockedUcId ? getUseCaseById(lockedUcId) : null;

  // Active industry id is used to scope use-case iterations everywhere in
  // this view so multi-industry deploys don't bleed catalogs together.
  const activeIndustryId = industry.id;

  // Build the set of related use case IDs and their relationship type.
  // Filtered to the active industry id(s) so multi-industry / blended views
  // don't surface dependency edges from packs that aren't in scope.
  const relatedMap = useMemo((): Map<string, RelationType> => {
    const map = new Map<string, RelationType>();
    if (!lockedUc) return map;

    const inIndustry = (uc: UseCase) => !uc.industryId || activeIndustryIds.includes(uc.industryId);

    map.set(lockedUc.id, 'selected');

    // Direct prerequisites
    lockedUc.dependencies.forEach(depId => map.set(depId, 'prerequisite'));

    // Things that depend on locked use case
    USE_CASES.forEach(uc => {
      if (!inIndustry(uc)) return;
      if (uc.dependencies.includes(lockedUc.id) && !map.has(uc.id)) {
        map.set(uc.id, 'depends-on-this');
      }
    });

    // Shared data dependencies (share a common prerequisite)
    const lockedDeps = new Set(lockedUc.dependencies);
    USE_CASES.forEach(uc => {
      if (!inIndustry(uc)) return;
      if (map.has(uc.id) || uc.id === lockedUc.id) return;
      if (uc.dependencies.some(d => lockedDeps.has(d))) {
        map.set(uc.id, 'shared-data');
      }
    });

    return map;
  }, [lockedUcId, activeIndustryIds]);

  const visibleDomains = domainFilter === 'all' ? [...DOMAIN_NAMES] : [domainFilter];

  // Use cases visible in the roadmap respect the customer-view filter so the
  // SA can preview the catalog from a specific customer type's perspective.
  // We also filter by the active industry id(s) — a single pack OR a blend.
  const customerFilter: string | null =
    customerView === 'all' ? null : customerView;
  // Honor the customer's operations-scope filter (e.g. a T&D + gas-
  // distribution but not generation). Empty array means no scope filter.
  const operationsScope = answers?.profile?.operationsScope || [];
  const visibleUseCases = useMemo(
    () => USE_CASES.filter(uc =>
      (!uc.industryId || activeIndustryIds.includes(uc.industryId)) &&
      useCaseMatchesUtility(uc.utilityTypes, customerFilter as UtilityType | null) &&
      (operationsScope.length === 0 || operationsScope.includes(uc.domain))
    ),
    [customerFilter, activeIndustryIds, operationsScope.join(',')]
  );

  const gridData = useMemo(() => {
    return visibleDomains.map(domain => ({
      domain,
      phases: [1, 2, 3].map(phase => ({
        phase,
        useCases: visibleUseCases.filter(uc => uc.domain === domain && uc.phase === phase),
      })),
    }));
  }, [domainFilter, visibleUseCases]);

  const handleNodeClick = useCallback((uc: UseCase) => {
    // Toggle lock: clicking the same node unlocks it
    setLockedUcId(prev => prev === uc.id ? null : uc.id);
  }, []);

  const handleDismiss = useCallback(() => {
    setLockedUcId(null);
  }, []);

  const handleOpenDetail = useCallback((ucId: string) => {
    setDetailUcId(ucId);
  }, []);

  // Build recommendation-like object for the detail panel
  const detailRec = useMemo((): RecommendedUseCase | null => {
    if (!detailUcId) return null;
    const uc = getUseCaseById(detailUcId);
    if (!uc) return null;
    const rec = results?.recommendations.find(r => r.useCase.id === detailUcId);
    if (rec) return rec;
    return {
      useCase: uc,
      readinessScore: 0,
      dependencyScore: 0,
      priorityScore: 0,
      capabilityScore: 0,
      complexityScore: 0,
      reasoning: results ? 'This use case was not in your top recommendations based on current priorities.' : '',
    };
  }, [detailUcId, results]);

  const updateAssumption = (key: keyof BusinessAssumptions, value: number) => {
    setAssumptions({ ...assumptions, [key]: value });
  };

  return (
    <div className="min-h-screen flex flex-col bg-navy">
      {/* Header */}
      <header className="border-b border-navy-600 px-6 py-3 sticky top-0 z-40 bg-navy/95 backdrop-blur">
        <div className="max-w-[1800px] mx-auto flex items-center gap-4">
          <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-400 hover:text-heading transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="h-5 w-px bg-navy-600" />
          <h1 className="text-lg font-semibold text-heading flex-1">
            Roadmap to an AI-Powered {industry.shortLabel || industry.label || 'Organization'}
            {results && <span className="text-sm font-normal text-slate-400 ml-2">— Your Position Highlighted</span>}
          </h1>

          {industries.length > 1 && (
            <div className="flex items-center gap-2">
              <select
                value={isBlendActive() ? '__blend__' : activeIndustryId}
                onChange={(e) => {
                  if (e.target.value === '__blend__') {
                    setShowBlendPicker(true);
                    return;
                  }
                  setActiveIndustryId(e.target.value);
                  setDomainFilter('all');
                  setCustomerView('all');
                  setLockedUcId(null);
                }}
                className="bg-navy-700 border border-navy-500 text-sm text-slate-300 rounded-lg px-3 py-1.5 focus:border-electric outline-none"
                title="Switch the roadmap to a different industry"
              >
                {industries.map(ind => (
                  <option key={ind.id} value={ind.id}>Industry: {ind.label}</option>
                ))}
                <option value="__blend__">
                  {isBlendActive() ? `Custom blend (${activeIndustryIds.length} packs)…` : 'Custom blend…'}
                </option>
              </select>
            </div>
          )}

          <div className="flex items-center bg-navy-700 border border-navy-500 rounded-lg overflow-hidden">
            <button
              onClick={() => setLayout('grid')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                layout === 'grid' ? 'bg-electric/15 text-electric' : 'text-slate-400 hover:text-heading'
              )}
              title="Grid (phase × domain)"
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Grid
            </button>
            <button
              onClick={() => setLayout('blast')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                layout === 'blast' ? 'bg-electric/15 text-electric' : 'text-slate-400 hover:text-heading'
              )}
              title="Blast radius (polar)"
            >
              <Radar className="w-3.5 h-3.5" /> Blast Radius
            </button>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={customerView}
              onChange={(e) => setCustomerView(e.target.value)}
              className="bg-navy-700 border border-navy-500 text-sm text-slate-300 rounded-lg px-3 py-1.5 focus:border-electric outline-none"
              title="Filter the roadmap to use cases relevant to a specific customer type"
            >
              <option value="all">Customer view: All</option>
              {(industry.customerTypes && industry.customerTypes.length > 0
                ? industry.customerTypes.map(o => ({ value: o.id, label: o.label }))
                : UTILITY_TYPE_OPTIONS.map(o => ({ value: o.value, label: o.label }))
              ).map(o => (
                <option key={o.value} value={o.value}>Customer view: {o.label}</option>
              ))}
            </select>
          </div>

          {layout === 'grid' && (
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500" />
              <select
                value={domainFilter}
                onChange={e => setDomainFilter(e.target.value)}
                className="bg-navy-700 border border-navy-500 text-sm text-slate-300 rounded-lg px-3 py-1.5 focus:border-electric outline-none"
              >
                <option value="all">All Domains</option>
                {DOMAIN_NAMES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}

          <button
            onClick={() => setShowAssumptions(!showAssumptions)}
            className={clsx(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all',
              showAssumptions ? 'bg-electric/10 border-electric/30 text-electric' : 'bg-navy-700 border-navy-500 text-slate-400 hover:text-heading hover:border-navy-400'
            )}
          >
            <DollarSign className="w-4 h-4" /> Value Assumptions
          </button>

          {layout === 'grid' && (
            <div className="flex items-center gap-1">
              <button onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} className="p-1.5 rounded hover:bg-navy-700 text-slate-500 hover:text-heading"><ZoomOut className="w-4 h-4" /></button>
              <span className="text-xs text-slate-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(1.5, z + 0.1))} className="p-1.5 rounded hover:bg-navy-700 text-slate-500 hover:text-heading"><ZoomIn className="w-4 h-4" /></button>
            </div>
          )}
        </div>
      </header>

      {/* Locked use case context bar */}
      {lockedUc && (
        <div className="border-b border-navy-600 px-6 py-2.5 bg-electric/5 flex items-center gap-4">
          <div className="max-w-[1800px] mx-auto flex items-center gap-4 w-full">
            <GitBranch className="w-4 h-4 text-electric flex-shrink-0" />
            <span className="text-sm text-heading font-medium">{lockedUc.name}</span>
            <span className="text-xs text-slate-400">— showing dependency relationships</span>
            <div className="flex-1" />
            {/* Relationship legend */}
            <div className="flex items-center gap-3">
              {(['prerequisite', 'depends-on-this', 'shared-data'] as RelationType[]).map(rel => {
                const cfg = RELATION_CONFIG[rel];
                const count = Array.from(relatedMap.values()).filter(r => r === rel).length;
                if (count === 0) return null;
                return (
                  <span key={rel} className="flex items-center gap-1 text-[10px]" style={{ color: cfg.color }}>
                    {cfg.icon} {cfg.label} ({count})
                  </span>
                );
              })}
            </div>
            <button
              onClick={() => handleOpenDetail(lockedUc.id)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-electric text-heading hover:bg-electric-400 transition-colors"
            >
              <ExternalLink className="w-3 h-3" /> View Details
            </button>
            <button onClick={handleDismiss} className="p-1 rounded hover:bg-navy-700 text-slate-400 hover:text-heading">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Assumptions Sidebar */}
        {showAssumptions && (
          <AssumptionsSidebar
            assumptions={assumptions}
            onUpdate={updateAssumption}
            onClose={() => setShowAssumptions(false)}
            utilityType={(customerFilter as UtilityType | null) ?? answers?.profile?.utilityType ?? null}
            industry={industry}
            locale={locale}
            onLocaleChange={onLocaleChange}
            fxRates={fxRates}
          />
        )}

        {/* Main content area */}
        <div ref={scrollRef} className="flex-1 overflow-auto p-6">
          {layout === 'blast' && activeIndustryIds.length >= 2 ? (
            // Blend mode: 300+ UCs in 18 domains is unreadable in polar.
            // A phase-column layout grouped by pack works much better.
            <RoadmapBlendView
              results={results}
              answers={answers}
              customerView={customerFilter as UtilityType | null}
              selectedUcId={lockedUcId}
              industryIds={[...activeIndustryIds]}
              assumptions={assumptions}
              onSelect={(uc) => handleNodeClick(uc)}
              onOpenDetail={(id) => handleOpenDetail(id)}
            />
          ) : layout === 'blast' ? (
            <div className="max-w-[1500px] mx-auto">
              <div className="flex">
                <RoadmapBlastRadius
                  results={results}
                  selectedUcId={lockedUcId}
                  onSelect={(uc) => handleNodeClick(uc)}
                  onOpenDetail={(id) => handleOpenDetail(id)}
                  customerView={customerFilter as UtilityType | null}
                  industryIds={[...activeIndustryIds]}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <Info className="w-3 h-3" />
                  Click a numbered bubble to highlight its dependency chain &bull; Rings = time horizon &bull; Wedges = domain
                </div>
                <span className="flex items-center gap-1.5 text-amber-400/80">
                  <span className="inline-block w-4 border-t-[1.5px] border-dashed border-amber-400/70" />
                  Phase 1 / 2 / 3 cluster boundaries
                </span>
                {lockedUcId && (
                  <>
                    <div className="h-3 w-px bg-navy-600" />
                    <span className="flex items-center gap-1.5" style={{ color: RELATION_CONFIG.prerequisite.color }}>
                      <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: RELATION_CONFIG.prerequisite.color }} />
                      Prerequisite
                    </span>
                    <span className="flex items-center gap-1.5" style={{ color: RELATION_CONFIG['depends-on-this'].color }}>
                      <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: RELATION_CONFIG['depends-on-this'].color }} />
                      Builds on this
                    </span>
                    <span className="flex items-center gap-1.5" style={{ color: RELATION_CONFIG['shared-data'].color }}>
                      <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: RELATION_CONFIG['shared-data'].color }} />
                      Shared data
                    </span>
                  </>
                )}
              </div>
            </div>
          ) : (
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', minWidth: zoom < 1 ? `${100/zoom}%` : undefined }}>
            {/* Phase Column Headers */}
            <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '160px repeat(3, 1fr)' }}>
              <div />
              {[1, 2, 3].map(phase => (
                <div key={phase} className="text-center">
                  <div
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold"
                    style={{ backgroundColor: `${PHASE_COLORS[phase]}15`, color: PHASE_COLORS[phase] }}
                  >
                    Phase {phase}: {PHASE_NAMES[phase]}
                  </div>
                </div>
              ))}
            </div>

            {/* Domain Rows */}
            {gridData.map(({ domain, phases }) => (
              <div key={domain} className="grid gap-4 mb-3" style={{ gridTemplateColumns: '160px repeat(3, 1fr)' }}>
                {/* Domain Label */}
                <div className="flex items-start pt-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: DOMAIN_COLORS[domain] }} />
                    <span className="text-sm font-semibold text-heading">{domain}</span>
                  </div>
                </div>

                {/* Phase Cells */}
                {phases.map(({ phase, useCases }) => (
                  <div key={phase} className="space-y-2">
                    {useCases.map(uc => {
                      const status = getNodeStatus(uc, results);
                      const relation = lockedUcId ? relatedMap.get(uc.id) ?? null : null;
                      const isInRelationGraph = lockedUcId ? relatedMap.has(uc.id) : true;
                      const isLocked = uc.id === lockedUcId;
                      const value = computeUseCaseValue(uc.id, assumptions, answers ? getValueOverride(answers, uc.id) : undefined);
                      const relConfig = relation ? RELATION_CONFIG[relation] : null;

                      return (
                        <div key={uc.id} className="relative">
                          <button
                            onClick={() => handleNodeClick(uc)}
                            className={clsx(
                              'w-full text-left p-3 rounded-lg border-2 transition-all duration-200 group relative',
                              // Locked / relationship highlighting
                              isLocked && 'border-electric bg-electric/15 ring-2 ring-electric/30',
                              !isLocked && relation === 'prerequisite' && 'border-amber-500/50 bg-amber-500/10',
                              !isLocked && relation === 'depends-on-this' && 'border-emerald-500/50 bg-emerald-500/10',
                              !isLocked && relation === 'shared-data' && 'border-purple-500/50 bg-purple-500/10',
                              // Default styling when no lock or not in graph
                              !lockedUcId && status === 'completed' && 'border-status-green/50 bg-status-green/10',
                              !lockedUcId && status === 'recommended' && 'border-electric/50 bg-electric/10',
                              !lockedUcId && status === 'future' && !results && 'border-navy-500 bg-navy-700/50 hover:border-navy-400',
                              !lockedUcId && status === 'future' && results && 'border-navy-600/50 bg-navy-800/30',
                              // Dim non-related when locked
                              lockedUcId && !isInRelationGraph && 'opacity-15 border-navy-700 bg-navy-800/20',
                            )}
                          >
                            {/* Status indicator (when not locked) */}
                            {results && !lockedUcId && (
                              <div className={clsx(
                                'absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full',
                                status === 'completed' && 'bg-status-green',
                                status === 'recommended' && 'bg-electric animate-pulse',
                                status === 'future' && 'bg-navy-500',
                              )} />
                            )}

                            {/* Relationship badge */}
                            {relConfig && !isLocked && (
                              <div
                                className="absolute -top-2 -right-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold border shadow-lg"
                                style={{
                                  backgroundColor: `${relConfig.color}20`,
                                  color: relConfig.color,
                                  borderColor: `${relConfig.color}40`,
                                }}
                              >
                                {relConfig.icon}
                                {relConfig.label}
                              </div>
                            )}

                            <div className="text-xs font-semibold text-heading leading-tight mb-1 pr-4 group-hover:text-electric transition-colors">
                              {uc.name}
                            </div>

                            <div className="flex items-center gap-2 text-[10px]">
                              <span className="text-slate-500">
                                {uc.complexity <= 2 ? 'Low' : uc.complexity <= 3 ? 'Med' : 'High'}
                              </span>
                              <span className="text-slate-600">|</span>
                              <span className="text-emerald-400 font-medium">
                                ${value.annualValueLowMM}–{value.annualValueHighMM}M/yr
                              </span>
                            </div>

                            {/* Dependency dots */}
                            {uc.dependencies.length > 0 && (
                              <div className="flex gap-1 mt-1.5">
                                {uc.dependencies.map(depId => {
                                  const depComplete = results?.completedUseCases.includes(depId);
                                  const depUc = getUseCaseById(depId);
                                  return (
                                    <div
                                      key={depId}
                                      className={clsx(
                                        'w-1.5 h-1.5 rounded-full',
                                        depComplete ? 'bg-status-green' : results ? 'bg-grid-orange' : 'bg-navy-400'
                                      )}
                                      title={`Requires: ${depUc?.name || depId}`}
                                    />
                                  );
                                })}
                              </div>
                            )}
                          </button>

                          {/* "View Details" link — visible when this node is locked */}
                          {isLocked && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleOpenDetail(uc.id); }}
                              className="mt-1 w-full flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-electric hover:text-heading bg-electric/10 hover:bg-electric/20 border border-electric/20 transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" /> View Full Details
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}

            {/* Legend */}
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
              {results && !lockedUcId && (
                <>
                  <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-status-green" /> Completed</div>
                  <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-electric animate-pulse" /> Recommended Next</div>
                  <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-navy-500" /> Future</div>
                  <div className="h-3 w-px bg-navy-600" />
                </>
              )}
              <div className="flex items-center gap-2">
                <Info className="w-3 h-3" />
                Click a use case to lock its dependency chain &bull; Click again to dismiss
              </div>
              {lockedUcId && (
                <>
                  <div className="h-3 w-px bg-navy-600" />
                  <span className="flex items-center gap-1" style={{ color: RELATION_CONFIG.prerequisite.color }}>
                    {RELATION_CONFIG.prerequisite.icon} Prerequisite — must be done first
                  </span>
                  <span className="flex items-center gap-1" style={{ color: RELATION_CONFIG['depends-on-this'].color }}>
                    {RELATION_CONFIG['depends-on-this'].icon} Builds on this — enabled by the selected use case
                  </span>
                  <span className="flex items-center gap-1" style={{ color: RELATION_CONFIG['shared-data'].color }}>
                    {RELATION_CONFIG['shared-data'].icon} Shared data — shares a common data dependency
                  </span>
                </>
              )}
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Detail Panel */}
      {detailRec && (
        <ErrorBoundary label="use case details" onClose={() => setDetailUcId(null)}>
        <UseCaseDetailCard
          recommendation={detailRec}
          completedUseCases={results?.completedUseCases || []}
          onClose={() => setDetailUcId(null)}
          assumptions={assumptions}
          valueOverride={answers ? getValueOverride(answers, detailRec.useCase.id) : undefined}
          complexityOverride={answers?.complexityOverrides?.[detailRec.useCase.id]}
          territorySize={answers?.profile?.territorySize ?? null}
          customerContext={answers?.profile?.companyName ? {
            customerName: answers.profile.companyName,
            utilityType: answers.profile.utilityType,
            strategicPriorities: answers.profile.strategicPriorities || [],
            overallScore: results?.overallScore,
            currentPhase: results?.currentPhase,
          } : undefined}
        />
        </ErrorBoundary>
      )}
      {showBlendPicker && (
        <IndustryBlendPicker
          industries={industries}
          activeIds={[...activeIndustryIds]}
          presets={blendPresets}
          onApply={(ids) => {
            if (ids.length === 1) setActiveIndustryId(ids[0]);
            else setActiveIndustryIds(ids);
            setDomainFilter('all');
            setCustomerView('all');
            setLockedUcId(null);
          }}
          onClose={() => setShowBlendPicker(false)}
        />
      )}
    </div>
  );
};

// ── Assumptions Sidebar ─────────────────────────────────────────────────────

interface AssumptionsSidebarProps {
  assumptions: BusinessAssumptions;
  onUpdate: (key: keyof BusinessAssumptions, value: number) => void;
  onClose: () => void;
  utilityType?: UtilityType | null;
  industry?: IndustryMeta | null;
  locale?: LocalePrefs;
  onLocaleChange?: (l: LocalePrefs) => void;
  fxRates?: Record<CurrencyCode, number>;
}

const AssumptionsSidebar: React.FC<AssumptionsSidebarProps> = ({
  assumptions, onUpdate, onClose, utilityType, industry, locale, onLocaleChange, fxRates,
}) => {
  // Pull the base list from the active industry pack — falls back to the
  // legacy P&U built-ins when the pack doesn't declare its own.
  const baseFields = useMemo<AssumptionField[]>(
    () => assumptionFieldsForIndustry(industry ?? null),
    [industry]
  );

  // The customer-type "relevantFor" filter only applies to P&U fields (it
  // hides T&D Line Miles for a nuclear operator, etc.). Other industries
  // pre-target their own customer types or leave `relevantFor` empty.
  const visibleFields = useMemo(
    () => assumptionFieldsFor(utilityType ?? null, baseFields),
    [utilityType, baseFields]
  );

  // Initial expanded categories — open the first one in the pack rather
  // than hard-coding "Utility Profile". Falls back to the first category
  // we see if the pack happens to be empty (defensive).
  const initialOpen = useMemo(() => {
    const first = visibleFields[0]?.category;
    return new Set<string>(first ? [first] : []);
  }, [visibleFields]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(initialOpen);
  // When the industry switches and the categories change, reset to the new
  // pack's first category so the user sees something rather than a wall of
  // collapsed sections from a previous industry.
  useEffect(() => {
    setExpandedCategories(initialOpen);
  }, [initialOpen]);

  const categories = useMemo(() => {
    const cats: Record<string, AssumptionField[]> = {};
    visibleFields.forEach(f => {
      if (!cats[f.category]) cats[f.category] = [];
      cats[f.category].push(f);
    });
    return Object.entries(cats);
  }, [visibleFields]);

  const loc = locale || DEFAULT_LOCALE;

  const toggleCat = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  return (
    <div className="w-80 border-r border-navy-600 bg-navy-800/80 overflow-y-auto flex-shrink-0">
      <div className="sticky top-0 bg-navy-800 border-b border-navy-600 p-4 flex items-center justify-between z-10">
        <h3 className="text-sm font-semibold text-heading">Value Assumptions</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-navy-700 text-slate-400 hover:text-heading"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-3 space-y-1">
        <p className="text-[10px] text-slate-500 mb-3 leading-relaxed">
          Adjust these assumptions to match your organization. All business value calculations update instantly.
        </p>
        {onLocaleChange && (
          <div className="mb-3 pb-3 border-b border-navy-600">
            <div className="flex items-center gap-2 px-2">
              <select
                value={loc.currency}
                onChange={(e) => {
                  const code = e.target.value as CurrencyCode;
                  const rate = fxRates?.[code] ?? loc.fxRate;
                  onLocaleChange({ ...loc, currency: code, fxRate: rate });
                }}
                className="flex-1 bg-navy-600 border border-navy-500 rounded px-2 py-1 text-xs text-heading focus:border-electric outline-none"
              >
                {(Object.keys(CURRENCY_META) as CurrencyCode[]).map((c) => (
                  <option key={c} value={c}>{CURRENCY_META[c].symbol} {c}</option>
                ))}
              </select>
              <button
                onClick={() => onLocaleChange({ ...loc, units: loc.units === 'metric' ? 'imperial' : 'metric' })}
                className="text-[10px] px-2 py-1 rounded border border-navy-500 text-navy-300 hover:text-heading"
                title="Toggle metric / imperial units"
              >
                {loc.units === 'metric' ? 'Metric' : 'Imperial'}
              </button>
            </div>
          </div>
        )}
        {categories.map(([cat, fields]) => (
          <div key={cat} className="mb-1">
            <button
              onClick={() => toggleCat(cat)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-semibold text-slate-400 hover:text-heading hover:bg-navy-700/50 transition-colors"
            >
              {expandedCategories.has(cat) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {cat}
            </button>
            {expandedCategories.has(cat) && (
              <div className="pl-2 space-y-2 mt-1 mb-2">
                {fields.map(field => {
                  const val = assumptions[field.key] as number;
                  return (
                    <div key={field.key} className="px-2">
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[10px] text-slate-500">{field.label}</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={val}
                            onChange={e => onUpdate(field.key, Number(e.target.value))}
                            step={field.step}
                            min={field.min}
                            max={field.max}
                            className="w-24 bg-navy-600 border border-navy-500 rounded px-2 py-0.5 text-xs text-right text-heading focus:border-electric outline-none"
                          />
                          {field.unit && <span className="text-[9px] text-slate-600 w-8">{localizeUnit(field.unit, loc)}</span>}
                        </div>
                      </div>
                      <input
                        type="range"
                        value={val}
                        onChange={e => onUpdate(field.key, Number(e.target.value))}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        className="w-full h-1 bg-navy-600 rounded-full appearance-none cursor-pointer accent-electric"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

