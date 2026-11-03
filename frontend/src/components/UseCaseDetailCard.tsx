import React, { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { X, Clock, Target, ChevronRight, CheckCircle2, Circle, DollarSign, Calculator, Sliders, RotateCcw, Zap, ChevronDown, Cloud } from 'lucide-react';
import type { RecommendedUseCase } from '../data/scoring';
import { PHASE_COLORS, DOMAIN_COLORS, getUseCaseById } from '../data/useCases';
import { BusinessAssumptions, DEFAULT_ASSUMPTIONS, computeUseCaseValue } from '../data/businessValue';
import { Artifacts } from './Artifacts';
import { deriveComplexity, explainComplexity, rubricBreakdown } from '../data/complexityRubric';
import { useFeatureFlag } from '../lib/featureFlags';
import { PocDocButton } from './PocDocButton';

interface UseCaseDetailCardProps {
  recommendation: RecommendedUseCase;
  completedUseCases: string[];
  onClose: () => void;
  assumptions?: BusinessAssumptions;
  /** Per-UC business-value override from refinements. When provided, replaces
   *  the computed low/high $M values on this card. */
  valueOverride?: { annualValueLowMM?: number; annualValueHighMM?: number } | null;
  /** Customer-specific complexity override (1..5). Falls back to catalog default. */
  complexityOverride?: number;
  onComplexityChange?: (next: number | undefined) => void;
  /** Territory size from the assessed customer profile — used to scale the
   *  experimental DBU consumption estimate. Optional; defaults to 'medium'. */
  territorySize?: import('../data/questions').TerritorySize | null;
  /** Customer context — when provided AND the POC doc flag is on, surfaces a
   *  "Generate POC doc" button on this card. Omit on contexts that don't have
   *  customer info (e.g. catalog browser). */
  customerContext?: {
    customerName: string;
    utilityType?: string | null;
    strategicPriorities?: string[];
    overallScore?: number | null;
    currentPhase?: number | null;
    horizonValueLowMM?: number | null;
    horizonValueHighMM?: number | null;
  };
}

export const UseCaseDetailCard: React.FC<UseCaseDetailCardProps> = ({
  recommendation,
  completedUseCases,
  onClose,
  assumptions,
  valueOverride,
  complexityOverride,
  onComplexityChange,
  territorySize,
  customerContext,
}) => {
  const uc = recommendation.useCase;
  const phaseColor = PHASE_COLORS[uc.phase];
  const effective = complexityOverride ?? uc.complexity;
  const isOverridden = typeof complexityOverride === 'number' && complexityOverride !== uc.complexity;
  const [showComplexity, setShowComplexity] = useState(false);
  const [showDbxPrereqs, setShowDbxPrereqs] = useState(false);
  const pocDocEnabled = useFeatureFlag('exp_poc_scope_generator');

  // Compute live business value (honor refinement override if present)
  const value = useMemo(() => {
    return computeUseCaseValue(uc.id, assumptions || DEFAULT_ASSUMPTIONS, valueOverride);
  }, [uc.id, assumptions, valueOverride]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg h-full bg-navy-800 border-l border-navy-600 overflow-y-auto"
        style={{ animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-navy-800 border-b border-navy-600 p-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: `${phaseColor}20`, color: phaseColor }}
                >
                  Phase {uc.phase}
                </span>
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: `${DOMAIN_COLORS[uc.domain] || '#6B7280'}15`, color: DOMAIN_COLORS[uc.domain] || '#6B7280' }}
                >
                  {uc.domain}
                </span>
              </div>
              <h2 className="text-xl font-bold text-heading">{uc.name}</h2>
              {pocDocEnabled && customerContext && (
                <div className="mt-3">
                  <PocDocButton
                    useCase={uc}
                    customer={{
                      customerName: customerContext.customerName,
                      utilityType: customerContext.utilityType,
                      territorySize: territorySize || null,
                      strategicPriorities: customerContext.strategicPriorities,
                      overallScore: customerContext.overallScore,
                      currentPhase: customerContext.currentPhase,
                      horizonValueLowMM: customerContext.horizonValueLowMM,
                      horizonValueHighMM: customerContext.horizonValueHighMM,
                    }}
                  />
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-navy-700 text-slate-400 hover:text-heading transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Description */}
          <div>
            <p className="text-sm text-slate-300 leading-relaxed">{uc.description}</p>
          </div>

          {/* ─── Quantified Business Value (live) ─── */}
          <div className="card p-5 border-emerald-500/20 bg-emerald-500/5">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                Quantified Annual Value
              </h3>
            </div>

            {/* Headline value range */}
            <div className="text-2xl font-bold text-heading mb-3">
              ${value.annualValueLowMM}M – ${value.annualValueHighMM}M
              <span className="text-sm font-normal text-slate-400 ml-1">/ year</span>
            </div>

            {/* Value components */}
            <div className="space-y-2 mb-4">
              {value.components.map((comp, i) => (
                <div key={i} className="p-3 rounded-lg bg-navy-700/50">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-sm text-slate-300 flex-1">{comp.name}</span>
                    <span className="text-sm font-bold text-emerald-400 ml-2">${comp.valueMM}M</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    <Calculator className="w-3 h-3 inline mr-1 -mt-0.5" />
                    {comp.calculation}
                  </div>
                </div>
              ))}
            </div>

            {/* Assumptions */}
            <div className="border-t border-navy-600 pt-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Key Assumptions</div>
              <div className="space-y-1">
                {value.assumptions.map((a, i) => (
                  <div key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
                    <span className="text-slate-600 mt-0.5">•</span>
                    {a}
                  </div>
                ))}
              </div>
            </div>

            {/* ROI */}
            <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/20">
              <Clock className="w-3 h-3 text-emerald-400" />
              <span className="text-xs text-emerald-400 font-medium">
                ~{value.roiMonths} month payback
              </span>
            </div>
          </div>

          {/* Readiness Score Breakdown — only show if we have a real score */}
          {recommendation.readinessScore > 0 && (
            <div className="card p-5">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Readiness Score
              </h3>
              <div className="flex items-center gap-4 mb-4">
                <div className="text-3xl font-bold text-heading">{recommendation.readinessScore}</div>
                <div className="text-xs text-slate-500">out of 100</div>
                <div className="flex-1 h-2 bg-navy-600 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-electric transition-all duration-500"
                    style={{ width: `${recommendation.readinessScore}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <ScoreItem label="Dependencies Met" score={recommendation.dependencyScore} max={40} />
                <ScoreItem label="Priority Alignment" score={recommendation.priorityScore} max={30} />
                <ScoreItem label="Team Capability" score={recommendation.capabilityScore} max={20} />
                <ScoreItem label="Complexity Fit" score={recommendation.complexityScore} max={10} />
              </div>
            </div>
          )}

          {/* Key Metrics */}
          <div className="grid grid-cols-2 gap-3">
            <MetricCard icon={<Clock className="w-4 h-4" />} label="Time to Value" value={uc.timeToValue} />
            <MetricCard
              icon={<Target className="w-4 h-4" />}
              label={isOverridden ? 'Complexity (overridden)' : 'Complexity'}
              value={`${effective}/5${isOverridden ? `  (default ${uc.complexity})` : ''}`}
            />
          </div>

          {/* Complexity breakdown + per-customer override */}
          <div className="card p-4">
            <button
              onClick={() => setShowComplexity(s => !s)}
              className="w-full flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-lava" />
                <span className="text-sm font-semibold text-heading">
                  Why complexity is {effective}/5
                </span>
                {isOverridden && (
                  <span className="text-[10px] uppercase tracking-wider bg-lava/15 text-lava-300 border border-lava/30 px-1.5 py-0.5 rounded">
                    customer-tuned
                  </span>
                )}
              </div>
              <ChevronDown className={clsx('w-4 h-4 text-navy-400 transition-transform', showComplexity && 'rotate-180')} />
            </button>

            {showComplexity && (
              <div className="mt-4 space-y-3">
                {uc.complexityScoring ? (
                  (() => {
                    const rubric = uc.complexityScoring!.rubric;
                    const derived = deriveComplexity(rubric);
                    const isDerived = uc.complexityScoring!.mode === 'derived';
                    return (
                      <>
                        <ScoreExplainer rubric={rubric} effectiveComplexity={effective} />
                        <div className="flex items-center justify-between text-[11px] text-navy-300">
                          <span className={clsx(
                            'px-1.5 py-0.5 rounded border',
                            isDerived
                              ? 'bg-electric/15 border-electric/30 text-electric'
                              : 'bg-navy-700 border-navy-500 text-navy-300'
                          )}>
                            {isDerived ? 'Derived from rubric' : 'Manual override'}
                          </span>
                          {!isDerived && (
                            <span>
                              Rubric alone suggests <span className="text-heading font-semibold">{derived}/5</span>
                            </span>
                          )}
                        </div>
                        <div className="space-y-2.5">
                          {rubricBreakdown(rubric).map(row => (
                            <div key={row.key}>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-heading">{row.label}</span>
                                <span className={clsx('font-mono text-[11px]',
                                  row.subScore >= 4 ? 'text-lava-300' : row.subScore >= 3 ? 'text-warning-400' : 'text-success-300'
                                )}>{row.subScore}/5</span>
                              </div>
                              <div className="h-1.5 bg-navy-700 rounded mt-1 overflow-hidden">
                                <div
                                  className={clsx('h-full rounded',
                                    row.subScore >= 4 ? 'bg-lava' : row.subScore >= 3 ? 'bg-warning-600' : 'bg-success-600'
                                  )}
                                  style={{ width: `${(row.subScore / 5) * 100}%` }}
                                />
                              </div>
                              <p className="text-[11px] text-navy-300 mt-1 leading-relaxed">{row.detail}</p>
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()
                ) : (
                  <p className="text-xs text-navy-400">No rubric scored for this use case yet — open it in the admin catalog editor to add one.</p>
                )}

                {/* Override slider — for the SA to tune complexity for THIS customer
                    (e.g. their Lakebase rollout will take longer). Independent of
                    the catalog rubric; persisted on the assessment. */}
                {onComplexityChange && (
                  <div className="mt-4 pt-3 border-t border-navy-600">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-navy-300">
                        Adjust for this customer
                        <span className="block text-[10px] text-navy-500 mt-0.5">
                          e.g., raise if Lakebase / SDP setup will take longer for them
                        </span>
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-heading">{effective}/5</span>
                        {isOverridden && (
                          <button
                            onClick={() => onComplexityChange(undefined)}
                            className="text-[10px] text-navy-400 hover:text-heading inline-flex items-center gap-1"
                            title="Reset to catalog default"
                          >
                            <RotateCcw className="w-3 h-3" /> reset
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={effective}
                      onChange={(e) => onComplexityChange(Number(e.target.value))}
                      className="w-full accent-lava"
                    />
                    <div className="flex justify-between text-[10px] text-navy-500 mt-0.5">
                      <span>1 trivial</span>
                      <span>3 typical</span>
                      <span>5 hard</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>


          {/* Databricks-specific prerequisites */}
          {uc.databricksPrereqs && uc.databricksPrereqs.length > 0 && (
            <div className="card p-4">
              <button
                onClick={() => setShowDbxPrereqs(s => !s)}
                className="w-full flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-lava" />
                  <span className="text-sm font-semibold text-heading">Databricks prerequisites</span>
                  <span className="text-[10px] text-navy-400">{uc.databricksPrereqs.length}</span>
                </div>
                <ChevronDown className={clsx('w-4 h-4 text-navy-400 transition-transform', showDbxPrereqs && 'rotate-180')} />
              </button>
              {showDbxPrereqs && (
                <ul className="mt-3 space-y-1.5">
                  {uc.databricksPrereqs.map((p, i) => (
                    <li key={i} className="text-xs text-navy-200 flex items-start gap-2">
                      <span className="text-lava mt-0.5">▸</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* KPI Impact */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Expected Impact</h3>
            <div className="space-y-2">
              {uc.kpiImpact.map((kpi, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-navy-700/50">
                  <span className="text-sm text-slate-300">{kpi.kpi}</span>
                  <span className={clsx('text-sm font-bold', kpi.delta < 0 ? 'text-status-green' : 'text-electric')}>
                    {kpi.delta > 0 ? '+' : ''}{kpi.delta}{kpi.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Dependencies */}
          {uc.dependencies.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Prerequisites</h3>
              <div className="space-y-2">
                {uc.dependencies.map(depId => {
                  const dep = getUseCaseById(depId);
                  const isComplete = completedUseCases.includes(depId);
                  return (
                    <div key={depId} className="flex items-center gap-2 p-2 rounded-lg bg-navy-700/30">
                      {isComplete ? <CheckCircle2 className="w-4 h-4 text-status-green flex-shrink-0" /> : <Circle className="w-4 h-4 text-slate-600 flex-shrink-0" />}
                      <span className={clsx('text-sm', isComplete ? 'text-slate-400 line-through' : 'text-slate-300')}>
                        {dep?.name || depId}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Business Value (qualitative from use case data) */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Business Value</h3>
            <div className="space-y-2">
              {uc.businessValue.map((val, i) => (
                <div key={i} className="flex items-start gap-2">
                  <ChevronRight className="w-4 h-4 text-electric flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-slate-300">{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Data Requirements */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Data Requirements</h3>
            <div className="flex flex-wrap gap-2">
              {uc.dataRequirements.map((req, i) => (
                <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-navy-600 text-slate-400 border border-navy-500">
                  {req}
                </span>
              ))}
            </div>
          </div>


          {/* Reasoning */}
          {recommendation.reasoning && (
            <div className="p-4 rounded-lg bg-electric/5 border border-electric/10">
              <h3 className="text-xs font-semibold text-electric-300 mb-2">Why We Recommend This</h3>
              <p className="text-sm text-slate-400">{recommendation.reasoning}</p>
            </div>
          )}

          {/* How to get started — artifacts (admin-curated, enabled-only) */}
          <Artifacts useCaseId={uc.id} />
        </div>
      </div>
    </div>
  );
};

function ScoreItem({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = Math.round((score / max) * 100);
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-slate-500">{label}</span>
        <span className="text-slate-400 font-medium">{score}/{max}</span>
      </div>
      <div className="h-1 bg-navy-600 rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full', pct >= 70 ? 'bg-status-green' : pct >= 40 ? 'bg-status-yellow' : 'bg-grid-orange')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="card p-3 text-center">
      <div className="flex justify-center text-electric mb-1">{icon}</div>
      <div className="text-[10px] text-slate-500 mb-0.5">{label}</div>
      <div className="text-sm font-bold text-heading">{value}</div>
    </div>
  );
}

// Experimental — gated by `exp_score_explainer`. Renders a 1-paragraph
// rubric-driven "why this score" explanation above the breakdown.
const ScoreExplainer: React.FC<{
  rubric: import('../data/complexityRubric').ComplexityRubric;
  effectiveComplexity: number;
}> = ({ rubric, effectiveComplexity }) => {
  const enabled = useFeatureFlag('exp_score_explainer');
  const [expanded, setExpanded] = useState(false);
  if (!enabled) return null;
  const text = explainComplexity(rubric, effectiveComplexity);
  return (
    <div className="rounded-lg border border-electric/30 bg-electric/5 p-3">
      <button
        onClick={() => setExpanded(s => !s)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-electric">Why this score</span>
          <span className="text-[10px] bg-electric/15 text-electric px-1.5 py-0.5 rounded border border-electric/30">
            beta
          </span>
        </div>
        <ChevronDown className={clsx('w-4 h-4 text-electric transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <p className="mt-2 text-xs text-slate-300 leading-relaxed">{text}</p>
      )}
    </div>
  );
};

