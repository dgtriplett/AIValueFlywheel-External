import React, { useState } from 'react';
import { clsx } from 'clsx';
import { Clock, Target, Star, X } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import type { AssessmentResults, RecommendedUseCase } from '../data/scoring';
import { PHASE_COLORS, PHASE_NAMES, DOMAIN_COLORS } from '../data/useCases';
import { UseCaseDetailCard } from './UseCaseDetailCard';
import { UseCaseActionMenu } from './UseCaseActionMenu';
import type { BusinessAssumptions } from '../data/businessValue';
import type { AssessmentAnswers } from '../data/questions';
import { activeRefinements } from '../data/refinements';

interface PersonalizedRoadmapProps {
  results: AssessmentResults;
  assumptions?: BusinessAssumptions;
  /** Read+write of the customer-level complexity overrides (uc.id → 1..5). */
  complexityOverrides?: Record<string, number>;
  onComplexityChange?: (ucId: string, next: number | undefined) => void;
  /** Per-UC business-value overrides from refinements. Passed straight through
   *  to UseCaseDetailCard so the panel reflects the user's manual $M edits. */
  valueOverrides?: Record<string, { annualValueLowMM?: number; annualValueHighMM?: number }>;
  /** Customer territory size — passed through so the detail card can scale
   *  the experimental DBU consumption estimate. */
  territorySize?: import('../data/questions').TerritorySize | null;
  /** Customer context — passed through to UseCaseDetailCard so the POC doc
   *  button can render with the right customer info. Optional. */
  customerContext?: {
    customerName: string;
    utilityType?: string | null;
    strategicPriorities?: string[];
    overallScore?: number | null;
    currentPhase?: number | null;
    horizonValueLowMM?: number | null;
    horizonValueHighMM?: number | null;
  };
  /** Discard a UC from the customer's plan. When supplied, an X button
   *  appears on each card; clicking it removes the UC, the recommendation
   *  list reflows (the next best UC slides into the freed slot), and the
   *  discard is reflected everywhere because it lives on `answers`. */
  onDiscardUseCase?: (ucId: string) => void;
  /** Full answers blob — when provided alongside `onAnswersChange`, each card
   *  gets the kebab `UseCaseActionMenu` (pin / discard / oop / note / value /
   *  bucket pin) instead of the bare X. */
  answers?: AssessmentAnswers;
  onAnswersChange?: (next: AssessmentAnswers) => void;
}

export const PersonalizedRoadmap: React.FC<PersonalizedRoadmapProps> = ({
  results, assumptions, complexityOverrides, onComplexityChange, valueOverrides, territorySize, customerContext,
  onDiscardUseCase, answers, onAnswersChange,
}) => {
  const [selectedUseCase, setSelectedUseCase] = useState<RecommendedUseCase | null>(null);
  // Top 10 — we render them in a 2-column grid below. The first 5 are the
  // "start this quarter" set; the next 5 are "on deck" — same readiness math
  // but lower confidence, so they get a slightly muted look.
  const top10 = results.recommendations.slice(0, 10);
  const firstHalf = top10.slice(0, 5);
  const secondHalf = top10.slice(5, 10);

  // Data for the radar chart
  const radarData = [
    { dimension: 'Data Infra', value: results.dimensionScores.dataInfra, fullMark: 100 },
    { dimension: 'Ops Data', value: results.dimensionScores.operationalData, fullMark: 100 },
    { dimension: 'Analytics', value: results.dimensionScores.analytics, fullMark: 100 },
    { dimension: 'AI/ML', value: results.dimensionScores.ai, fullMark: 100 },
    { dimension: 'Governance', value: results.dimensionScores.governance, fullMark: 100 },
  ];

  // Data for the readiness bar chart — full top 10, so the SA can see the
  // shape of the funnel (not just the top of the top).
  const barData = top10.map((rec, i) => ({
    name: rec.useCase.name.length > 25 ? rec.useCase.name.substring(0, 25) + '...' : rec.useCase.name,
    fullName: rec.useCase.name,
    score: rec.readinessScore,
    phase: rec.useCase.phase,
    index: i,
  }));

  // Render one UC card. Pulled into a closure so the 2-column grid for top-10
  // can render identical cards on each side without duplicating ~50 lines of
  // JSX. `rank` is the 1-based rank across the full top-10 list (1..10).
  const renderRecCard = (rec: RecommendedUseCase, rank: number) => {
    const uc = rec.useCase;
    const phaseColor = PHASE_COLORS[uc.phase];
    const refs = answers ? activeRefinements(answers) : null;
    const isPinned = refs ? (refs.pinnedUseCaseIds || []).includes(uc.id) : false;
    const hasNote = refs ? !!(refs.notes || {})[uc.id] : false;
    const hasValueOv = refs ? !!(refs.valueOverrides || {})[uc.id] : false;
    return (
      <div key={uc.id} className="relative group">
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
          {/* Status badges so the SA sees at-a-glance which refinements are
              applied without opening the menu. */}
          {isPinned && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-electric/15 text-electric border border-electric/30">Pinned</span>
          )}
          {hasNote && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">Note</span>
          )}
          {hasValueOv && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">$ override</span>
          )}
          {answers && onAnswersChange ? (
            <UseCaseActionMenu
              ucId={uc.id}
              answers={answers}
              onChange={onAnswersChange}
              align="right"
              triggerClassName="opacity-0 group-hover:opacity-100 transition-opacity"
            />
          ) : onDiscardUseCase ? (
            <button
              onClick={(e) => { e.stopPropagation(); onDiscardUseCase(uc.id); }}
              className="p-1.5 rounded text-navy-400 hover:text-lava hover:bg-lava/10 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Discard this use case"
              aria-label="Discard use case"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>
        <button
          onClick={() => setSelectedUseCase(rec)}
          className="w-full card p-4 hover:border-electric/30 transition-all duration-200 text-left"
        >
          <div className="flex items-start gap-3">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{ backgroundColor: `${phaseColor}20`, color: phaseColor }}
            >
              {rank}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: `${phaseColor}20`, color: phaseColor }}
                >
                  P{uc.phase}
                </span>
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: `${DOMAIN_COLORS[uc.domain] || '#6B7280'}15`, color: DOMAIN_COLORS[uc.domain] || '#6B7280' }}
                >
                  {uc.domain}
                </span>
              </div>
              <div className="text-sm font-semibold text-heading group-hover:text-electric transition-colors leading-tight">
                {uc.name}
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500">
                <span className="flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  <span className="text-slate-300 font-medium">{rec.readinessScore}</span>
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {uc.timeToValue}
                </span>
              </div>
              {uc.kpiImpact[0] && (
                <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-status-green/10 border border-status-green/20">
                  <Star className="w-3 h-3 text-status-green flex-shrink-0" />
                  <span className="text-[10px] text-status-green font-medium truncate">
                    {uc.kpiImpact[0].kpi}: {uc.kpiImpact[0].delta > 0 ? '+' : ''}{uc.kpiImpact[0].delta}{uc.kpiImpact[0].unit}
                  </span>
                </div>
              )}
            </div>
          </div>
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Radar Chart */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
          Capability Radar
        </h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart
              cx="50%"
              cy="50%"
              outerRadius="65%"
              data={radarData}
              margin={{ top: 16, right: 48, bottom: 16, left: 48 }}
            >
              <PolarGrid stroke="#2A4A56" />
              <PolarAngleAxis
                dataKey="dimension"
                tick={{ fill: '#C4CCD6', fontSize: 11 }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                tick={{ fill: '#618794', fontSize: 9 }}
                axisLine={false}
                tickLine={false}
              />
              <Radar
                name="Your Score"
                dataKey="value"
                stroke="#2272B4"
                fill="#2272B4"
                fillOpacity={0.2}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Recommendations Header */}
      <div>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-1">
          Recommended Next Steps
        </h3>
        <p className="text-xs text-slate-500">
          Ranked by readiness score based on your responses
        </p>
      </div>

      {/* Readiness Bar Chart — 10 entries instead of 5, so a bit taller. */}
      <div className="card p-6">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
              <XAxis type="number" domain={[0, 100]} tick={{ fill: '#475569', fontSize: 10 }} />
              <YAxis
                type="category"
                dataKey="name"
                width={160}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-navy-800 border border-navy-500 rounded-lg p-3 shadow-xl">
                      <div className="text-sm font-medium text-heading">{d.fullName}</div>
                      <div className="text-xs text-slate-400 mt-1">Readiness: {d.score}/100</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={24}>
                {barData.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={PHASE_COLORS[entry.phase]}
                    fillOpacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recommendation Cards — top 10 in a 2-column grid, split into
          "First 5: start this quarter" and "Next 5: on deck". The split is
          informational (same scoring math) but visually nudges the SA to
          discuss tactical vs. on-deck UCs separately. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {firstHalf.length > 0 && (
          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-electric font-semibold flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-electric" />
              First 5 — start this quarter
            </div>
            {firstHalf.map((rec, i) => renderRecCard(rec, i))}
          </div>
        )}
        {secondHalf.length > 0 && (
          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-navy-400 font-semibold flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-navy-400" />
              Next 5 — on deck
            </div>
            {secondHalf.map((rec, i) => renderRecCard(rec, i + 5))}
          </div>
        )}
      </div>

      {/* Detail Panel */}
      {selectedUseCase && (
        <UseCaseDetailCard
          recommendation={selectedUseCase}
          completedUseCases={results.completedUseCases}
          onClose={() => setSelectedUseCase(null)}
          assumptions={assumptions}
          valueOverride={valueOverrides?.[selectedUseCase.useCase.id]}
          complexityOverride={complexityOverrides?.[selectedUseCase.useCase.id]}
          onComplexityChange={onComplexityChange ? (next) => onComplexityChange(selectedUseCase.useCase.id, next) : undefined}
          territorySize={territorySize ?? null}
          customerContext={customerContext}
        />
      )}
    </div>
  );
};
