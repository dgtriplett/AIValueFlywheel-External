import React from 'react';
import { clsx } from 'clsx';
import {
  X as XIcon, AlertTriangle, AlertCircle, Info, CheckCircle2,
  ArrowRight, Loader2,
} from 'lucide-react';

export interface ConsistencyIssue {
  id: string;
  severity: 'warn' | 'info' | 'error';
  title: string;
  description: string;
  suggestedFix: string;
  stepIndex: number;
}

const STEP_NAMES = ['Profile', 'Infrastructure', 'Current Implementation', 'Capabilities'];

const SEVERITY_META: Record<ConsistencyIssue['severity'], { color: string; bg: string; border: string; icon: React.ReactNode }> = {
  error: { color: 'text-lava-300', bg: 'bg-lava/10', border: 'border-lava/40', icon: <AlertCircle className="w-4 h-4" /> },
  warn:  { color: 'text-warning-200', bg: 'bg-warning/10', border: 'border-warning/40', icon: <AlertTriangle className="w-4 h-4" /> },
  info:  { color: 'text-electric', bg: 'bg-electric/10', border: 'border-electric/40', icon: <Info className="w-4 h-4" /> },
};

interface Props {
  loading: boolean;
  issues: ConsistencyIssue[] | null;
  onSubmitAnyway: () => void;
  onGoToStep: (stepIndex: number) => void;
  onClose: () => void;
}

/**
 * Modal that surfaces LLM-flagged inconsistencies in the assessment before
 * submit. The modal is non-blocking — the SA can review and either submit
 * anyway or jump back to a specific wizard step to revise.
 */
export const ConsistencyCheckModal: React.FC<Props> = ({
  loading, issues, onSubmitAnyway, onGoToStep, onClose,
}) => {
  const errorCount = (issues || []).filter(i => i.severity === 'error').length;
  const warnCount  = (issues || []).filter(i => i.severity === 'warn').length;
  const infoCount  = (issues || []).filter(i => i.severity === 'info').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-lg bg-navy-800 border border-navy-600 shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-navy-600 flex items-start justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-heading inline-flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning-200" />
              Pre-submit consistency check
            </h2>
            <p className="text-[11px] text-slate-400 mt-1">
              An LLM auditor reviewed the answers for inconsistencies before they're saved.
              Nothing is permanent yet — revise or submit as you see fit.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-navy-700 text-slate-300">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="text-xs text-navy-400 inline-flex items-center gap-2 py-6 justify-center w-full">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Auditing answers…
            </div>
          )}

          {!loading && issues && issues.length === 0 && (
            <div className="text-center py-8">
              <CheckCircle2 className="w-8 h-8 text-success-300 mx-auto mb-2" />
              <div className="text-sm font-semibold text-heading mb-1">Looks consistent</div>
              <div className="text-[12px] text-slate-400">
                No internal contradictions flagged. Click submit when you're ready.
              </div>
            </div>
          )}

          {!loading && issues && issues.length > 0 && (
            <>
              {/* Summary chips */}
              <div className="flex gap-1.5 mb-3 flex-wrap text-[11px]">
                {errorCount > 0 && (
                  <span className="px-2 py-0.5 rounded bg-lava/15 text-lava-300 border border-lava/30">
                    {errorCount} likely wrong
                  </span>
                )}
                {warnCount > 0 && (
                  <span className="px-2 py-0.5 rounded bg-warning/15 text-warning-200 border border-warning/30">
                    {warnCount} should reconsider
                  </span>
                )}
                {infoCount > 0 && (
                  <span className="px-2 py-0.5 rounded bg-electric/15 text-electric border border-electric/30">
                    {infoCount} worth verifying
                  </span>
                )}
              </div>
              <ul className="space-y-2">
                {issues.map(issue => {
                  const m = SEVERITY_META[issue.severity];
                  const stepName = STEP_NAMES[issue.stepIndex] || `Step ${issue.stepIndex}`;
                  return (
                    <li key={issue.id} className={clsx('rounded border p-3', m.bg, m.border)}>
                      <div className="flex items-start gap-2">
                        <div className={clsx('flex-shrink-0 mt-0.5', m.color)}>{m.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-heading">{issue.title}</div>
                          <div className="text-[12px] text-slate-300 mt-1">{issue.description}</div>
                          <div className="text-[11px] text-navy-300 mt-1.5 italic">
                            <span className="text-navy-400">Suggested fix: </span>{issue.suggestedFix}
                          </div>
                          <button
                            onClick={() => onGoToStep(issue.stepIndex)}
                            className={clsx(
                              'mt-2 text-[11px] inline-flex items-center gap-1 hover:text-heading',
                              m.color
                            )}
                          >
                            Go to {stepName} <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-navy-600 flex items-center justify-between gap-2 flex-shrink-0">
          <div className="text-[11px] text-navy-400">
            {issues && issues.length > 0
              ? 'Submit anyway if these flags don\'t apply to this customer.'
              : 'Ready to submit.'}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs border border-navy-600 text-slate-300 hover:bg-navy-700"
            >Cancel</button>
            <button
              onClick={onSubmitAnyway}
              disabled={loading}
              className={clsx(
                'px-3 py-1.5 rounded text-xs font-medium border inline-flex items-center gap-1',
                loading ? 'border-navy-500 text-navy-500 cursor-not-allowed'
                        : 'bg-electric text-heading border-electric hover:bg-electric-400'
              )}
            >
              {issues && issues.length > 0 ? 'Submit anyway' : 'Submit assessment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
