import React from 'react';
import { clsx } from 'clsx';
import type { AssessmentResults } from '../data/scoring';
import { PHASE_NAMES, PHASE_COLORS, DOMAIN_NAMES, DOMAIN_COLORS } from '../data/useCases';

interface MaturityScoreCardProps {
  results: AssessmentResults;
}

const DIMENSION_LABELS: Record<string, string> = {
  dataInfra: 'Data Infrastructure',
  operationalData: 'Operational Data',
  analytics: 'Analytics Maturity',
  ai: 'AI / ML Readiness',
  governance: 'Governance',
};

const DIMENSION_COLORS: Record<string, string> = {
  dataInfra: '#1E90FF',
  operationalData: '#00C896',
  analytics: '#FFB800',
  ai: '#A855F7',
  governance: '#EC4899',
};

export const MaturityScoreCard: React.FC<MaturityScoreCardProps> = ({ results }) => {
  const phaseColor = PHASE_COLORS[results.currentPhase] || '#6B7280';

  return (
    <div className="space-y-6 animate-scale-in">
      {/* Phase Display */}
      <div className="card p-6 text-center relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            background: `radial-gradient(ellipse at center, ${phaseColor} 0%, transparent 70%)`,
          }}
        />

        <div className="relative">
          <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">Current Maturity</div>
          <div className="text-6xl font-bold mb-1" style={{ color: phaseColor }}>
            {results.currentPhase === 0 ? 'Pre' : `Phase ${results.currentPhase}`}
          </div>
          <div className="text-lg font-semibold text-heading mb-1">
            {results.phaseName}
          </div>
          <div className="text-xs text-slate-500">of 3 phases</div>

          {/* Phase progress arc */}
          <div className="mt-6 flex justify-center">
            <div className="relative w-36 h-36">
              <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                <circle
                  cx="60" cy="60" r="50"
                  fill="none"
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth="8"
                />
                <circle
                  cx="60" cy="60" r="50"
                  fill="none"
                  stroke={phaseColor}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${(results.overallScore / 100) * 314} 314`}
                  className="transition-all duration-1000 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-heading">{results.overallScore}</span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Overall Score</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dimension Scores */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
          Dimension Scores
        </h3>
        <div className="space-y-4">
          {Object.entries(results.dimensionScores).map(([key, value]) => (
            <div key={key}>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-sm text-slate-300">{DIMENSION_LABELS[key]}</span>
                <span className={clsx(
                  'text-sm font-bold',
                  value >= 70 ? 'text-status-green' :
                  value >= 40 ? 'text-status-yellow' :
                  'text-grid-orange'
                )}>
                  {value}
                </span>
              </div>
              <div className="h-2 bg-navy-600 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${value}%`, backgroundColor: DIMENSION_COLORS[key] || '#1E90FF' }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Phase Journey */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
          Maturity Journey
        </h3>
        <div className="space-y-3">
          {[1, 2, 3].map(phase => {
            const isComplete = phase < results.currentPhase;
            const isCurrent = phase === results.currentPhase;
            const color = PHASE_COLORS[phase];
            return (
              <div key={phase} className="flex items-center gap-3">
                <div
                  className={clsx(
                    'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border-2',
                    isComplete ? 'text-heading' :
                    isCurrent ? 'text-heading' :
                    'text-slate-600 border-navy-600 bg-navy-700'
                  )}
                  style={isComplete || isCurrent ? { backgroundColor: color, borderColor: color } : {}}
                >
                  {isComplete ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : phase}
                </div>
                <div className="flex-1 min-w-0">
                  <span className={clsx(
                    'text-sm leading-tight',
                    isComplete || isCurrent ? 'text-heading font-medium' : 'text-slate-500'
                  )}>
                    {PHASE_NAMES[phase]}
                  </span>
                </div>
                {isCurrent && (
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: `${color}20`, color }}
                  >
                    YOU ARE HERE
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Domain Progress */}
      {results.domainProgress && (
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            Domain Progress
          </h3>
          <div className="space-y-3">
            {results.domainProgress.map(dp => {
              const total = dp.phase1Total + dp.phase2Total + dp.phase3Total;
              const done = dp.phase1Count + dp.phase2Count + dp.phase3Count;
              const pct = Math.round((done / total) * 100);
              const domColor = DOMAIN_COLORS[dp.domain] || '#6B7280';
              return (
                <div key={dp.domain}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs text-slate-400">{dp.domain}</span>
                    <span className="text-xs font-medium" style={{ color: domColor }}>
                      {done}/{total}
                    </span>
                  </div>
                  <div className="h-1.5 bg-navy-600 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${pct}%`, backgroundColor: domColor }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
