/**
 * ExecutiveSummaryTab — leadership-facing default view.
 *
 * Designed for a CIO / CDO / line-of-business head walking into the room
 * cold. Leads with quantified value, ties recommendations to the strategic
 * priorities the customer *themselves* chose, and surfaces the next-90-day
 * starting moves. The detail (per-UC roadmap, dependency graph, value
 * assumptions, blast-radius polar, AI insights) lives on subsequent tabs.
 *
 * Sections (top → bottom):
 *   1. Headline value range across the recommended roadmap
 *   2. Outcomes by strategic priority — what each declared priority maps to,
 *      with its own $value, UC count, and time-to-value range
 *   3. Where you stand today — phase + dimension headline + foundation gap
 *   4. The first 90 days — top-N recommended UCs to kick off
 *   5. The 3-year picture — total $value, phase trajectory, investment ask
 */
import React, { useMemo } from 'react';
import { clsx } from 'clsx';
import {
  TrendingUp, Target, Zap, Shield, Users, FileCheck, DollarSign, Leaf,
  HardHat, Briefcase, ArrowRight, CheckCircle2, Sparkles, Clock, X, Trash2,
} from 'lucide-react';
import type { AssessmentResults, RecommendedUseCase } from '../data/scoring';
import type { AssessmentAnswers } from '../data/questions';
import { STRATEGIC_PRIORITY_OPTIONS } from '../data/questions';
import { computeUseCaseValue, type BusinessAssumptions } from '../data/businessValue';
import { PHASE_NAMES, PHASE_DESCRIPTIONS, PHASE_COLORS, USE_CASES, getUseCaseById } from '../data/useCases';
import type { UseCase } from '../data/useCases';
import { getValueOverride } from '../data/refinements';
import { buildPriorityIndex } from '../data/strategicPriorityInference';
import { UseCaseActionMenu } from './UseCaseActionMenu';

interface ExecutiveSummaryTabProps {
  results: AssessmentResults;
  answers: AssessmentAnswers;
  assumptions: BusinessAssumptions;
  onJumpToTab?: (tab: 'overview' | 'roadmap' | 'insights') => void;
  /** Discard a UC from the customer's plan — wired through to the X button
   *  on each "first 90 days" card. */
  onDiscardUseCase?: (ucId: string) => void;
  /** Open the Discarded panel modal — surfaced as a small "N discarded" link
   *  in the header so the SA can restore from this tab without leaving. */
  onShowDiscarded?: () => void;
  discardedCount?: number;
  /** When supplied, each "first 90 days" card renders the unified
   *  `UseCaseActionMenu` (pin / discard / oop / note / value / bucket pin)
   *  instead of the bare X. */
  onAnswersChange?: (next: AssessmentAnswers) => void;
}

// Map strategic-priority value → icon + a "what this maps to" headline.
// We don't try to be exhaustive — these read like outcome statements to a
// leader, not capability statements.
const PRIORITY_META: Record<string, { icon: React.ReactNode; outcome: string }> = {
  reliability:     { icon: <Shield className="w-4 h-4" />,       outcome: 'Higher uptime + faster restoration' },
  cost_reduction:  { icon: <TrendingUp className="w-4 h-4 rotate-180" />, outcome: 'Lower O&M + capital spend' },
  customer:        { icon: <Users className="w-4 h-4" />,         outcome: 'Better customer experience + NPS' },
  compliance:      { icon: <FileCheck className="w-4 h-4" />,    outcome: 'Audit-ready ESG + regulatory posture' },
  revenue:         { icon: <DollarSign className="w-4 h-4" />,   outcome: 'New revenue + grid-services capture' },
  sustainability:  { icon: <Leaf className="w-4 h-4" />,         outcome: 'Decarbonization + Scope 1+3 progress' },
  safety:          { icon: <HardHat className="w-4 h-4" />,      outcome: 'Lower TRIR + workers-comp cost' },
  workforce:       { icon: <Briefcase className="w-4 h-4" />,    outcome: 'Higher backoffice + workforce productivity' },
};

// Best-effort priority alignment — same mapping as the scoring engine uses.
// We re-derive it client-side instead of plumbing it through so this view
// stays decoupled from the scoring internals.
const STRATEGIC_UC_MAP: Record<string, string[]> = {
  reliability: [
    'p1_dist_outage_detection', 'p1_dist_flisr', 'p1_dist_predictive_maint', 'p1_dist_feeder_forecast',
    'p1_trans_predictive_maint', 'p1_trans_veg_management', 'p1_gen_predictive_maint', 'p1_gen_outage_prediction',
    'p2_dist_storm_prediction', 'p2_trans_grid_stability', 'p3_dist_self_healing',
  ],
  cost_reduction: [
    'p1_gen_fleet_analytics', 'p1_gen_fuel_hedging', 'p1_corp_spend_analytics', 'p1_corp_capital_analytics',
    'p1_trans_dynamic_line_rating',
    'p2_gen_portfolio_optimization', 'p2_dist_voltage_optimization', 'p2_corp_financial_close',
    'p3_corp_auto_procurement', 'p3_corp_self_optimizing',
  ],
  customer: [
    'p1_cust_segmentation', 'p1_cust_knowledge_agents', 'p1_cust_nba',
    'p2_cust_dynamic_pricing', 'p2_cust_proactive_outage', 'p2_cust_journey_orchestration',
    'p3_cust_ai_self_service', 'p3_cust_autonomous_cx',
  ],
  compliance: [
    'p1_reg_compliance_monitoring', 'p1_reg_rate_case', 'p1_corp_it_ot_security',
    'p2_gen_emission_compliance', 'p2_reg_decarbonization', 'p2_reg_climate_risk',
    'p3_reg_autonomous_compliance', 'p3_reg_enterprise_risk',
  ],
  revenue: [
    'p1_gen_demand_forecast', 'p1_gen_fuel_hedging', 'p1_cust_billing_anomaly',
    'p2_gen_renewable_storage', 'p2_gen_portfolio_optimization', 'p2_reg_siting_capacity',
    'p3_cust_behind_meter', 'p3_cust_grid_marketplace',
  ],
  sustainability: [
    'p2_gen_renewable_storage', 'p2_gen_emission_compliance', 'p2_cust_carbon_coach',
    'p2_reg_decarbonization', 'p2_reg_climate_risk', 'p3_reg_living_irp',
  ],
  safety: [
    'p1_corp_safety_analytics', 'p1_corp_it_ot_security',
    'p2_dist_storm_prediction', 'p3_dist_work_packages',
  ],
  workforce: [
    'p1_corp_workforce_planning', 'p1_corp_spend_analytics', 'p1_corp_capital_analytics',
    'p2_corp_knowledge_copilots', 'p2_corp_financial_close', 'p2_corp_document_processing',
    'p3_corp_talent_copilots', 'p3_corp_auto_procurement',
  ],
};

interface PriorityOutcome {
  value: string;
  label: string;
  outcome: string;
  icon: React.ReactNode;
  ucs: RecommendedUseCase[];
  valueLowMM: number;
  valueHighMM: number;
  earliestPhase: number;
  /** UCs that map to this priority and are already in the customer's
   *  completed-UCs list. Surface in the empty state as "you've already
   *  delivered these" instead of the generic "expand scope" message. */
  completedUcs: UseCase[];
  /** UCs that the priority map points at but are not in the active catalog
   *  (e.g. wrong industry pack). Drives a "no catalog coverage for this
   *  priority in the active industry pack" message. */
  missingFromCatalog: number;
  /** UCs that are in the catalog but were filtered out for reasons other
   *  than completion (industry/utility/scope/refinements). */
  hiddenOrOutOfScope: number;
}

export const ExecutiveSummaryTab: React.FC<ExecutiveSummaryTabProps> = ({
  results, answers, assumptions, onJumpToTab,
  onDiscardUseCase, onShowDiscarded, discardedCount = 0,
  onAnswersChange,
}) => {
  const customerName = answers.profile.companyName || 'your organization';
  const priorities = answers.profile.strategicPriorities || [];
  const recs = results.recommendations;

  // Aggregate $value across the recommendation set for the headline.
  // Per-UC value overrides from `answers.refinements.valueOverrides` win
  // over the catalog formulas — so a customer-specific number the SA dialed
  // in will roll up correctly here.
  const totalValue = useMemo(() => {
    let low = 0, high = 0;
    for (const r of recs) {
      const v = computeUseCaseValue(r.useCase.id, assumptions, getValueOverride(answers, r.useCase.id));
      low += v.annualValueLowMM;
      high += v.annualValueHighMM;
    }
    return { low: Math.round(low), high: Math.round(high) };
  }, [recs, assumptions, answers]);

  // Per-priority breakdown: which recommended UCs map to each declared priority,
  // and what aggregate value those UCs represent. The map is the union of (a)
  // explicit `strategicPriorities` on catalog UCs, (b) the curated P&U map
  // below, and (c) keyword inference. (c) is what makes this work across
  // every industry pack without touching seed JSONs.
  const priorityOutcomes = useMemo<PriorityOutcome[]>(() => {
    const opts = STRATEGIC_PRIORITY_OPTIONS;
    const completedSet = new Set(results.completedUseCases || []);
    const recIds = new Set(recs.map(r => r.useCase.id));

    const priorityIndex = buildPriorityIndex(USE_CASES, STRATEGIC_UC_MAP);

    return priorities.map(p => {
      const opt = opts.find(o => o.value === p);
      const meta = PRIORITY_META[p];

      const mappedIds = priorityIndex[p] || new Set<string>();

      const matchedUcs = recs.filter(r => mappedIds.has(r.useCase.id));
      const completedUcs: UseCase[] = [];
      let missingFromCatalog = 0;
      let hiddenOrOutOfScope = 0;
      for (const id of mappedIds) {
        if (recIds.has(id)) continue; // already in matchedUcs
        if (completedSet.has(id)) {
          const uc = getUseCaseById(id);
          if (uc) completedUcs.push(uc);
          continue;
        }
        const uc = getUseCaseById(id);
        if (!uc) missingFromCatalog++;
        else hiddenOrOutOfScope++;
      }

      let low = 0, high = 0;
      let earliestPhase = 4;
      for (const r of matchedUcs) {
        const v = computeUseCaseValue(r.useCase.id, assumptions, getValueOverride(answers, r.useCase.id));
        low += v.annualValueLowMM;
        high += v.annualValueHighMM;
        if (r.useCase.phase < earliestPhase) earliestPhase = r.useCase.phase;
      }
      return {
        value: p,
        label: opt?.label || p,
        outcome: meta?.outcome || (opt?.description || ''),
        icon: meta?.icon || <Target className="w-4 h-4" />,
        ucs: matchedUcs,
        valueLowMM: Math.round(low),
        valueHighMM: Math.round(high),
        earliestPhase: earliestPhase < 4 ? earliestPhase : 1,
        completedUcs,
        missingFromCatalog,
        hiddenOrOutOfScope,
      };
    });
  }, [priorities, recs, assumptions, answers, results.completedUseCases]);

  const phase = results.currentPhase;
  const phaseColor = PHASE_COLORS[phase] || '#94A3B8';
  const next90 = recs.slice(0, 3);

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      {/* Headline value */}
      <section className="rounded-2xl border border-electric/30 bg-gradient-to-br from-electric/10 via-navy-800/60 to-lava/5 p-6 md:p-8">
        <div className="flex items-center gap-2 text-xs text-electric uppercase tracking-wider mb-2">
          <Sparkles className="w-3.5 h-3.5" />
          Executive Summary · {customerName}
        </div>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <div className="text-[11px] text-navy-300 uppercase tracking-wider mb-1">Annual value at stake</div>
            <div className="text-4xl md:text-5xl font-bold text-heading font-mono">
              ${totalValue.low}M<span className="text-3xl md:text-4xl text-navy-400 mx-2">–</span>${totalValue.high}M
              <span className="text-base text-navy-400 ml-2 font-normal">/ yr</span>
            </div>
            <div className="text-xs text-navy-300 mt-1.5">
              Across the {recs.length} highest-readiness use cases for {customerName}
            </div>
          </div>
          <div className="h-12 w-px bg-navy-600 hidden md:block" />
          <div>
            <div className="text-[11px] text-navy-300 uppercase tracking-wider mb-1">Today</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold" style={{ color: phaseColor }}>
                Phase {phase}
              </span>
              <span className="text-sm text-navy-300">/ 3</span>
            </div>
            <div className="text-xs text-navy-300 mt-1">{PHASE_NAMES[phase]}</div>
          </div>
          <div className="h-12 w-px bg-navy-600 hidden md:block" />
          <div>
            <div className="text-[11px] text-navy-300 uppercase tracking-wider mb-1">Maturity score</div>
            <div className="text-2xl font-bold text-heading font-mono">{results.overallScore}<span className="text-base text-navy-400">/100</span></div>
            <div className="text-xs text-navy-300 mt-1">Across 5 dimensions</div>
          </div>
        </div>
      </section>

      {/* Outcomes by strategic priority */}
      {priorityOutcomes.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-3 px-1">
            <h2 className="text-lg font-semibold text-heading">What this delivers against your strategic priorities</h2>
            <span className="text-xs text-navy-400">{priorityOutcomes.length} priorit{priorityOutcomes.length === 1 ? 'y' : 'ies'} you chose</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {priorityOutcomes.map(p => (
              <PriorityOutcomeCard key={p.value} p={p} />
            ))}
          </div>
        </section>
      )}

      {priorityOutcomes.length === 0 && (
        <section className="rounded-xl border border-navy-600 bg-navy-800/40 p-5 text-sm text-navy-300">
          <div className="flex items-center gap-2 text-warning-400 mb-1">
            <Target className="w-4 h-4" />
            <span className="font-medium">No strategic priorities declared</span>
          </div>
          Go back to the Profile step and select 1-3 priorities to see how this roadmap delivers
          against them.
        </section>
      )}

      {/* Where you stand */}
      <section className="rounded-xl border border-navy-600 bg-navy-800/60 p-5 md:p-6">
        <div className="flex items-start gap-4">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${phaseColor}20`, color: phaseColor }}
          >
            <Zap className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-heading mb-1">Where you stand today</h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              {PHASE_DESCRIPTIONS[phase]}
            </p>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3">
              <DimTile label="Data Infrastructure" value={results.dimensionScores.dataInfra} />
              <DimTile label="Operational Data" value={results.dimensionScores.operationalData} />
              <DimTile label="Analytics" value={results.dimensionScores.analytics} />
              <DimTile label="AI / ML" value={results.dimensionScores.ai} />
              <DimTile label="Governance" value={results.dimensionScores.governance} />
            </div>
          </div>
        </div>
      </section>

      {/* Next 90 days */}
      <section className="rounded-xl border border-navy-600 bg-navy-800/60 p-5 md:p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-electric" />
            <h2 className="text-base font-semibold text-heading">The first 90 days</h2>
          </div>
          {onJumpToTab && (
            <button
              onClick={() => onJumpToTab('overview')}
              className="text-xs text-electric hover:text-heading inline-flex items-center gap-1"
            >
              See the full top-10 <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
        <p className="text-xs text-navy-300 mb-3">
          Three highest-readiness use cases to kick off immediately. These are the moves with the
          shortest path to value given your current data + capabilities.
        </p>
        <div className="space-y-2">
          {next90.map((r, i) => {
            const v = computeUseCaseValue(r.useCase.id, assumptions, getValueOverride(answers, r.useCase.id));
            return (
              <div key={r.useCase.id} className="group flex items-start gap-3 p-3 rounded-lg border border-navy-700 bg-navy-900/40 relative">
                <div className="w-7 h-7 rounded-full bg-electric/15 border border-electric/40 flex items-center justify-center text-electric font-bold text-sm flex-shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-heading">{r.useCase.name}</div>
                  <div className="text-xs text-navy-300 mt-0.5 line-clamp-2">{r.useCase.description}</div>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px]">
                    <span className="text-emerald-400 font-medium">${v.annualValueLowMM}–{v.annualValueHighMM}M/yr</span>
                    <span className="text-navy-400">·</span>
                    <span className="text-navy-300">{r.useCase.timeToValue}</span>
                    <span className="text-navy-400">·</span>
                    <span className="text-navy-300">Complexity {r.useCase.complexity}/5</span>
                  </div>
                </div>
                {onAnswersChange ? (
                  <UseCaseActionMenu
                    ucId={r.useCase.id}
                    answers={answers}
                    onChange={onAnswersChange}
                    align="right"
                    triggerClassName="opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                ) : onDiscardUseCase ? (
                  <button
                    onClick={() => onDiscardUseCase(r.useCase.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-navy-400 hover:text-lava hover:bg-lava/10"
                    title="Discard — the next-best use case slides into this slot"
                    aria-label="Discard"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        {onShowDiscarded && discardedCount > 0 && (
          <div className="mt-3 text-[11px] text-navy-400">
            <button
              onClick={onShowDiscarded}
              className="inline-flex items-center gap-1 text-lava-300 hover:text-heading"
            >
              <Trash2 className="w-3 h-3" />
              {discardedCount} use case{discardedCount === 1 ? '' : 's'} discarded — view + restore
            </button>
          </div>
        )}
      </section>

      {/* What's on subsequent tabs */}
      {onJumpToTab && (
        <section className="rounded-xl border border-navy-700 bg-navy-900/30 p-5">
          <div className="text-[11px] uppercase tracking-wider text-navy-400 mb-3">More detail in the next tabs</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <NavCard
              icon={<Target className="w-4 h-4" />}
              title="Overview"
              body="Maturity score breakdown, top-10 recommended use cases, peer comparison, domain progress."
              onClick={() => onJumpToTab('overview')}
            />
            <NavCard
              icon={<TrendingUp className="w-4 h-4" />}
              title="Strategic Roadmap"
              body="3 or 5-year phased plan with capacity model, investment dial, accelerator toggle, comparison vs baseline."
              onClick={() => onJumpToTab('roadmap')}
            />
            <NavCard
              icon={<Sparkles className="w-4 h-4" />}
              title="AI Insights"
              body="AI-generated executive summary, proposed use cases tailored to you, and unified data ingestion strategy."
              onClick={() => onJumpToTab('insights')}
            />
          </div>
        </section>
      )}
    </div>
  );
};

const PriorityOutcomeCard: React.FC<{ p: PriorityOutcome }> = ({ p }) => {
  const phaseColor = PHASE_COLORS[p.earliestPhase] || '#94A3B8';
  const hasMatches = p.ucs.length > 0;
  return (
    <div
      className={clsx(
        'rounded-xl border p-4 flex flex-col gap-2',
        hasMatches
          ? 'border-success-300/30 bg-gradient-to-br from-success-600/5 to-navy-800/60'
          : 'border-navy-700 bg-navy-800/40'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: hasMatches ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.1)',
              color: hasMatches ? '#86EFAC' : '#94A3B8',
            }}
          >
            {p.icon}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-heading truncate">{p.label}</div>
            <div className="text-[11px] text-navy-300 truncate">{p.outcome}</div>
          </div>
        </div>
        {hasMatches && (
          <span
            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0"
            style={{ backgroundColor: `${phaseColor}20`, color: phaseColor }}
          >
            Phase {p.earliestPhase}+
          </span>
        )}
      </div>
      {hasMatches ? (
        <>
          <div className="text-xl font-bold text-heading font-mono">
            ${p.valueLowMM}–{p.valueHighMM}M<span className="text-xs text-navy-400 ml-1 font-normal">/ yr</span>
          </div>
          <div className="text-[11px] text-navy-300">
            Delivered through {p.ucs.length} use case{p.ucs.length === 1 ? '' : 's'} on the roadmap.
          </div>
          <ul className="text-[11px] text-navy-300 space-y-0.5 mt-1">
            {p.ucs.slice(0, 3).map(uc => (
              <li key={uc.useCase.id} className="flex items-start gap-1">
                <CheckCircle2 className="w-3 h-3 text-success-300 flex-shrink-0 mt-0.5" />
                <span className="truncate">{uc.useCase.name}</span>
              </li>
            ))}
            {p.ucs.length > 3 && (
              <li className="text-[10px] text-navy-500 pl-4">+{p.ucs.length - 3} more</li>
            )}
          </ul>
        </>
      ) : p.completedUcs.length > 0 ? (
        // The customer has already delivered against this priority — celebrate
        // rather than nudge them to "expand scope". This is the most common
        // empty-state hit for mature customers.
        <>
          <div className="text-[12px] font-medium text-success-300 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Already delivered
          </div>
          <div className="text-[11px] text-navy-300">
            You've completed {p.completedUcs.length} use case{p.completedUcs.length === 1 ? '' : 's'} that
            advance this priority — that's why nothing recommended remains.
          </div>
          <ul className="text-[11px] text-navy-300 space-y-0.5 mt-1">
            {p.completedUcs.slice(0, 3).map(uc => (
              <li key={uc.id} className="flex items-start gap-1">
                <CheckCircle2 className="w-3 h-3 text-success-300 flex-shrink-0 mt-0.5" />
                <span className="truncate">{uc.name}</span>
              </li>
            ))}
            {p.completedUcs.length > 3 && (
              <li className="text-[10px] text-navy-500 pl-4">+{p.completedUcs.length - 3} more</li>
            )}
          </ul>
        </>
      ) : p.missingFromCatalog > 0 && p.hiddenOrOutOfScope === 0 ? (
        // Catalog gap: the priority is real but the active industry pack
        // doesn't carry UCs tagged to it. Tell the user this so they don't
        // think the recommendation engine is broken.
        <div className="text-[11px] text-navy-400">
          The active industry pack doesn't carry use cases tagged to this priority. Either pick a
          complementary industry blend that does, or treat this as a custom outcome to track on
          the side.
        </div>
      ) : p.hiddenOrOutOfScope > 0 ? (
        // Mapped UCs exist in the catalog but were filtered out by
        // utility/industry scope or by refinements.
        <div className="text-[11px] text-navy-400">
          {p.hiddenOrOutOfScope} use case{p.hiddenOrOutOfScope === 1 ? '' : 's'} aligned to this
          priority {p.hiddenOrOutOfScope === 1 ? 'is' : 'are'} excluded by your current scope or
          refinements (discarded / out-of-scope). Review them in the Refinements panel to bring
          any back into play.
        </div>
      ) : (
        // True empty: priority isn't covered anywhere — likely a brand-new
        // priority not yet wired into the catalog.
        <div className="text-[11px] text-navy-400 italic">
          No use cases in the catalog are tagged to this priority yet. Worth flagging to the
          product team to expand the catalog.
        </div>
      )}
    </div>
  );
};

const DimTile: React.FC<{ label: string; value: number }> = ({ label, value }) => {
  const color = value >= 70 ? '#10B981' : value >= 50 ? '#F59E0B' : value >= 30 ? '#FB923C' : '#EF4444';
  return (
    <div className="rounded-lg border border-navy-700 bg-navy-900/40 px-3 py-2">
      <div className="text-lg font-bold font-mono" style={{ color }}>{value}</div>
      <div className="text-[10px] text-navy-300 uppercase tracking-wider mt-0.5 leading-tight">{label}</div>
    </div>
  );
};

const NavCard: React.FC<{ icon: React.ReactNode; title: string; body: string; onClick: () => void }> = ({
  icon, title, body, onClick,
}) => (
  <button
    onClick={onClick}
    className="text-left p-3 rounded-lg border border-navy-600 bg-navy-800/40 hover:border-electric/40 hover:bg-navy-700/40 transition-colors"
  >
    <div className="flex items-center gap-2 text-sm font-semibold text-heading mb-1.5">
      <span className="text-electric">{icon}</span>
      {title}
      <ArrowRight className="w-3 h-3 text-navy-400 ml-auto" />
    </div>
    <div className="text-[11px] text-navy-300 leading-relaxed">{body}</div>
  </button>
);
