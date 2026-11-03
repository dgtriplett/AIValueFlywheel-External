import React, { useEffect, useMemo, useState } from 'react';
import {
  X as XIcon, ArrowRight, TrendingUp, TrendingDown, Minus, ExternalLink,
  Edit3, Loader2, AlertTriangle,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, type AssessmentDetail, type AssessmentListRow } from '../lib/api';
import { getUseCaseById } from '../data/useCases';
import type { AssessmentResults, DimensionScores } from '../data/scoring';
import type { AssessmentAnswers } from '../data/questions';

interface Props {
  customerName: string;
  onClose: () => void;
  onViewAssessment?: (id: string) => void;
  onEditAndRerun?: (id: string) => void;
}

/**
 * Progression panel — shows every assessment for one customer in chronological
 * order, lets the user pick a "from" and "to" assessment, and renders deltas
 * across maturity score, phase, dimension scores, and use case completions.
 *
 * Comparing two snapshots that share a customer name turns implicit
 * progression (look for what changed in the diff) into explicit progression
 * (here's what moved up, here's what was added).
 */
export const ProgressionPanel: React.FC<Props> = ({
  customerName, onClose, onViewAssessment, onEditAndRerun,
}) => {
  const [list, setList] = useState<AssessmentListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [comparing, setComparing] = useState<{ from: AssessmentDetail; to: AssessmentDetail } | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  // Load the customer's assessments (oldest → newest from backend).
  useEffect(() => {
    api.myAssessmentsByCustomer(customerName)
      .then(rows => {
        setList(rows);
        if (rows.length >= 2) {
          // Default: oldest as "from", newest as "to" — the most useful comparison.
          setFromId(rows[0].id);
          setToId(rows[rows.length - 1].id);
        }
      })
      .catch(e => setError(e?.message || 'Failed to load progression'));
  }, [customerName]);

  // Load both snapshots whenever the user picks fromId + toId.
  useEffect(() => {
    if (!fromId || !toId || fromId === toId) {
      setComparing(null);
      return;
    }
    setLoadingCompare(true);
    api.compareAssessments(fromId, toId)
      .then(data => setComparing(data))
      .catch(e => setError(e?.message || 'Failed to load comparison'))
      .finally(() => setLoadingCompare(false));
  }, [fromId, toId]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative w-full max-w-4xl h-full bg-navy-800 border-l border-navy-600 overflow-y-auto"
        style={{ animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-navy-800 border-b border-navy-600 p-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-heading">Maturity progression</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {customerName} · {list?.length ?? '…'} assessments
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded hover:bg-navy-700 text-slate-300">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="m-5 text-xs px-3 py-2 rounded bg-lava/10 border border-lava/30 text-lava-300 inline-flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" /> {error}
          </div>
        )}

        {/* Timeline of assessments */}
        {list && list.length > 0 && (
          <div className="px-5 py-4 border-b border-navy-700">
            <div className="text-[11px] text-navy-400 uppercase tracking-wider mb-2">Timeline</div>
            <ol className="relative border-l border-navy-600 ml-3">
              {list.map((a, i) => (
                <li key={a.id} className="ml-4 mb-3">
                  <span className="absolute -left-1.5 mt-1 w-3 h-3 rounded-full bg-electric border-2 border-navy-800" />
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm text-heading">
                        Assessment #{i + 1} · score <span className="font-mono">{a.overall_score}</span> · phase {a.current_phase}
                      </div>
                      <div className="text-[11px] text-navy-400">{fmtDate(a.created_at)}</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => setFromId(a.id)}
                        className={clsx(
                          'text-[10px] px-2 py-0.5 rounded border',
                          fromId === a.id ? 'bg-electric/20 border-electric text-electric' : 'border-navy-600 text-slate-300 hover:bg-navy-700'
                        )}
                      >Use as "from"</button>
                      <button
                        onClick={() => setToId(a.id)}
                        className={clsx(
                          'text-[10px] px-2 py-0.5 rounded border',
                          toId === a.id ? 'bg-success-300/20 border-success-300 text-success-300' : 'border-navy-600 text-slate-300 hover:bg-navy-700'
                        )}
                      >Use as "to"</button>
                      {onViewAssessment && (
                        <button
                          onClick={() => onViewAssessment(a.id)}
                          className="text-[10px] px-2 py-0.5 rounded border border-navy-600 text-slate-300 hover:bg-navy-700 inline-flex items-center gap-1"
                        ><ExternalLink className="w-3 h-3" /> View</button>
                      )}
                      {onEditAndRerun && (
                        <button
                          onClick={() => onEditAndRerun(a.id)}
                          className="text-[10px] px-2 py-0.5 rounded border border-navy-600 text-slate-300 hover:bg-navy-700 inline-flex items-center gap-1"
                        ><Edit3 className="w-3 h-3" /> Re-run from here</button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Comparison */}
        {loadingCompare && (
          <div className="px-5 py-8 text-center text-xs text-navy-400 inline-flex items-center gap-2 justify-center w-full">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading comparison…
          </div>
        )}
        {comparing && fromId && toId && fromId !== toId && (
          <ComparisonView from={comparing.from} to={comparing.to} />
        )}
        {fromId && toId && fromId === toId && (
          <div className="px-5 py-6 text-xs text-navy-400">
            Pick a different "from" and "to" assessment to see deltas.
          </div>
        )}
      </div>
    </div>
  );
};

// ── Comparison body ─────────────────────────────────────────────────────────
const ComparisonView: React.FC<{ from: AssessmentDetail; to: AssessmentDetail }> = ({ from, to }) => {
  const a = (from.results as unknown as AssessmentResults) || ({} as AssessmentResults);
  const b = (to.results as unknown as AssessmentResults) || ({} as AssessmentResults);
  const aAns = (from.answers as unknown as AssessmentAnswers) || ({} as AssessmentAnswers);
  const bAns = (to.answers as unknown as AssessmentAnswers) || ({} as AssessmentAnswers);

  const aCompleted = new Set(aAns.currentUseCases?.selectedUseCases || []);
  const bCompleted = new Set(bAns.currentUseCases?.selectedUseCases || []);
  const newlyCompleted = useMemo(
    () => Array.from(bCompleted).filter(id => !aCompleted.has(id)),
    [aCompleted, bCompleted]
  );
  const newlyRemoved = useMemo(
    () => Array.from(aCompleted).filter(id => !bCompleted.has(id)),
    [aCompleted, bCompleted]
  );

  const aDS = new Set(aAns.currentUseCases?.selectedDataSources || []);
  const bDS = new Set(bAns.currentUseCases?.selectedDataSources || []);
  const newlyOnboardedDS = Array.from(bDS).filter(id => !aDS.has(id));
  const newlyDroppedDS = Array.from(aDS).filter(id => !bDS.has(id));

  const aRecIds = new Set((a.recommendations || []).map(r => r.useCase.id));
  const bRecIds = new Set((b.recommendations || []).map(r => r.useCase.id));
  const newlyRecommended = (b.recommendations || []).filter(r => !aRecIds.has(r.useCase.id)).slice(0, 6);
  const droppedRecommendations = (a.recommendations || []).filter(r => !bRecIds.has(r.useCase.id)).slice(0, 6);

  return (
    <div className="px-5 py-4 space-y-5">
      {/* Score deltas — top-line KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <DeltaTile
          label="Overall maturity"
          fromVal={a.overallScore || 0}
          toVal={b.overallScore || 0}
          unit=""
        />
        <DeltaTile
          label="Phase"
          fromVal={a.currentPhase || 0}
          toVal={b.currentPhase || 0}
          unit=""
          fromLabel={a.phaseName || ''}
          toLabel={b.phaseName || ''}
        />
        <DeltaTile
          label="Use cases in production"
          fromVal={aCompleted.size}
          toVal={bCompleted.size}
          unit=""
        />
        <DeltaTile
          label="Data sources ingested"
          fromVal={aDS.size}
          toVal={bDS.size}
          unit=""
        />
      </div>

      {/* Dimension scores */}
      {a.dimensionScores && b.dimensionScores && (
        <div>
          <div className="text-xs font-semibold text-heading mb-2">Dimension scores</div>
          <div className="space-y-2">
            {(Object.keys(b.dimensionScores) as (keyof DimensionScores)[]).map(k => (
              <DimensionDeltaBar
                key={k}
                label={dimLabel(k)}
                fromVal={a.dimensionScores[k] || 0}
                toVal={b.dimensionScores[k] || 0}
              />
            ))}
          </div>
        </div>
      )}

      {/* Newly completed use cases */}
      {newlyCompleted.length > 0 && (
        <DeltaList
          title={`✓ Use cases newly in production (${newlyCompleted.length})`}
          color="success"
          ids={newlyCompleted}
        />
      )}
      {newlyRemoved.length > 0 && (
        <DeltaList
          title={`✗ Use cases removed from production (${newlyRemoved.length})`}
          color="warning"
          ids={newlyRemoved}
        />
      )}

      {/* Data source changes */}
      {(newlyOnboardedDS.length > 0 || newlyDroppedDS.length > 0) && (
        <div className="rounded border border-navy-700 bg-navy-900/40 p-3 text-xs">
          <div className="font-semibold text-heading mb-1">Data source changes</div>
          {newlyOnboardedDS.length > 0 && (
            <div className="text-success-300">+ Newly onboarded: {newlyOnboardedDS.length}</div>
          )}
          {newlyDroppedDS.length > 0 && (
            <div className="text-warning-200">− Dropped: {newlyDroppedDS.length}</div>
          )}
        </div>
      )}

      {/* Recommendation deltas */}
      {newlyRecommended.length > 0 && (
        <div className="rounded border border-electric/30 bg-electric/5 p-3">
          <div className="text-xs font-semibold text-electric mb-2">
            New recommendations unlocked since last assessment
          </div>
          <ul className="space-y-1">
            {newlyRecommended.map(r => (
              <li key={r.useCase.id} className="text-[12px] text-heading">
                <span className="font-medium">{r.useCase.name}</span>
                <span className="text-navy-400 ml-2">readiness {r.readinessScore}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {droppedRecommendations.length > 0 && (
        <div className="rounded border border-navy-700 bg-navy-900/30 p-3">
          <div className="text-xs font-semibold text-navy-300 mb-2">
            No longer in top recommendations (likely now in production)
          </div>
          <ul className="space-y-1">
            {droppedRecommendations.map(r => (
              <li key={r.useCase.id} className="text-[12px] text-slate-400">
                {r.useCase.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Time between */}
      <div className="text-[11px] text-navy-400 italic">
        From {fmtDate(from.createdAt)} → {fmtDate(to.createdAt)}
        {(() => {
          const days = daysBetween(from.createdAt, to.createdAt);
          return days != null ? ` (${days} day${days === 1 ? '' : 's'})` : '';
        })()}
      </div>
    </div>
  );
};

// ── Tiles + bars ────────────────────────────────────────────────────────────
const DeltaTile: React.FC<{
  label: string;
  fromVal: number;
  toVal: number;
  unit: string;
  fromLabel?: string;
  toLabel?: string;
}> = ({ label, fromVal, toVal, unit, fromLabel, toLabel }) => {
  const delta = toVal - fromVal;
  const positive = delta > 0;
  const negative = delta < 0;
  return (
    <div className="rounded border border-navy-700 bg-navy-900/40 px-3 py-2">
      <div className="text-[10px] text-navy-400 uppercase tracking-wider">{label}</div>
      <div className="flex items-center gap-2 mt-1">
        <div className="text-base text-navy-300 font-mono">{fromVal}{unit}</div>
        <ArrowRight className="w-3 h-3 text-navy-500" />
        <div className="text-lg text-heading font-mono font-semibold">{toVal}{unit}</div>
      </div>
      {fromLabel && toLabel && (
        <div className="text-[9px] text-navy-400 mt-0.5 truncate">{fromLabel} → {toLabel}</div>
      )}
      <div className={clsx(
        'text-[11px] font-mono mt-1 inline-flex items-center gap-1',
        positive && 'text-success-300',
        negative && 'text-warning-200',
        !positive && !negative && 'text-navy-400',
      )}>
        {positive && <TrendingUp className="w-3 h-3" />}
        {negative && <TrendingDown className="w-3 h-3" />}
        {!positive && !negative && <Minus className="w-3 h-3" />}
        {positive && '+'}{delta}{unit}
      </div>
    </div>
  );
};

const DimensionDeltaBar: React.FC<{
  label: string;
  fromVal: number;
  toVal: number;
}> = ({ label, fromVal, toVal }) => {
  const delta = toVal - fromVal;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono">
          <span className="text-navy-400">{fromVal}</span>
          <span className="text-navy-500 mx-1">→</span>
          <span className="text-heading font-semibold">{toVal}</span>
          <span className={clsx(
            'ml-2',
            delta > 0 && 'text-success-300',
            delta < 0 && 'text-warning-200',
            delta === 0 && 'text-navy-500',
          )}>{delta > 0 ? '+' : ''}{delta}</span>
        </span>
      </div>
      <div className="h-1.5 rounded bg-navy-800 overflow-hidden relative">
        {/* Baseline (from) — grey */}
        <div className="absolute h-full bg-navy-500/60" style={{ width: `${fromVal}%` }} />
        {/* Current (to) — electric, only the gain portion drawn over baseline */}
        {delta > 0 && (
          <div className="absolute h-full bg-success-300" style={{ left: `${fromVal}%`, width: `${delta}%` }} />
        )}
        {delta < 0 && (
          <div className="absolute h-full bg-warning/60" style={{ left: `${toVal}%`, width: `${-delta}%` }} />
        )}
      </div>
    </div>
  );
};

const DeltaList: React.FC<{ title: string; color: 'success' | 'warning'; ids: string[] }> = ({ title, color, ids }) => (
  <div className={clsx(
    'rounded border p-3',
    color === 'success' && 'border-success-300/30 bg-success-300/5',
    color === 'warning' && 'border-warning/30 bg-warning/5',
  )}>
    <div className={clsx(
      'text-xs font-semibold mb-2',
      color === 'success' && 'text-success-300',
      color === 'warning' && 'text-warning-200',
    )}>{title}</div>
    <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-1">
      {ids.map(id => {
        const uc = getUseCaseById(id);
        return (
          <li key={id} className="text-[12px] text-heading truncate">
            {uc ? uc.name : id}
            {uc && <span className="text-navy-400 ml-1">· {uc.domain}</span>}
          </li>
        );
      })}
    </ul>
  </div>
);

// ── helpers ────────────────────────────────────────────────────────────────
function dimLabel(k: keyof DimensionScores): string {
  const map: Record<keyof DimensionScores, string> = {
    dataInfra: 'Data Infrastructure',
    operationalData: 'Operational Data',
    analytics: 'Analytics',
    ai: 'AI / ML',
    governance: 'Governance',
  };
  return map[k] || k;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    const d = new Date(s);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return s;
  }
}

function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  try {
    const ms = new Date(b).getTime() - new Date(a).getTime();
    return Math.round(ms / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}
