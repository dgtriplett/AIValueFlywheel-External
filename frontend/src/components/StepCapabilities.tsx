import React from 'react';
import { clsx } from 'clsx';
import { HelpCircle } from 'lucide-react';
import type { CapabilityScores, CapabilityAssessment } from '../data/questions';
import {
  DERIVED_QUESTIONS,
  deriveCapabilityScores,
  countAnswered,
} from '../data/derivedCapability';
import { Tooltip } from './Tooltip';

interface StepCapabilitiesProps {
  capabilities: CapabilityScores;
  capabilityMode: CapabilityAssessment;
  // Atomic update of both slots — avoids the stale-closure race
  // when setting capabilities and capabilityMode in the same tick.
  onChange: (capabilities: CapabilityScores, capabilityMode: CapabilityAssessment) => void;
}

/**
 * Capability assessment — derived only.
 * Self-reported 1-5 sliders were removed because users are bad at scoring
 * themselves on abstract scales; we infer scores from concrete proxy answers
 * (`derivedCapability.ts`) instead. The mode field on CapabilityAssessment is
 * kept for backward compat with old saved assessments but is always 'derived'
 * going forward.
 */
export const StepCapabilities: React.FC<StepCapabilitiesProps> = ({
  capabilities,
  capabilityMode,
  onChange,
}) => {
  // Ensure mode is always 'derived' — silently upgrade legacy 'self' state.
  React.useEffect(() => {
    if (capabilityMode.mode !== 'derived') {
      const derived = deriveCapabilityScores(capabilityMode.derivedAnswers);
      onChange(derived, { ...capabilityMode, mode: 'derived' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDerivedAnswer = (dim: keyof CapabilityScores, qKey: string, value: number) => {
    const nextAnswers = { ...capabilityMode.derivedAnswers, [`${dim}.${qKey}`]: value };
    const derived = deriveCapabilityScores(nextAnswers);
    onChange(derived, { ...capabilityMode, derivedAnswers: nextAnswers, mode: 'derived' });
  };

  const { answered, total } = countAnswered(capabilityMode.derivedAnswers);

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-heading mb-2">Capability Assessment</h2>
        <p className="text-navy-300 max-w-3xl">
          Pick the answer that best describes your organization for each question below. We infer
          your data engineering, data science, cloud, and executive sponsorship maturity from
          concrete proxy signals rather than asking you to rate yourself on a scale.
        </p>
      </div>

      <DerivedView
        answers={capabilityMode.derivedAnswers}
        onAnswer={setDerivedAnswer}
        capabilities={capabilities}
        answered={answered}
        total={total}
      />
    </div>
  );
};

// ─── Derived view — proxy questions per dimension ───────────────────────────

const DerivedView: React.FC<{
  answers: Record<string, number>;
  onAnswer: (dim: keyof CapabilityScores, qKey: string, value: number) => void;
  capabilities: CapabilityScores;
  answered: number;
  total: number;
}> = ({ answers, onAnswer, capabilities, answered, total }) => (
  <div className="space-y-6">
    <div className="flex items-center justify-between card p-4 bg-navy-700">
      <div>
        <div className="text-sm font-medium text-heading">Progress</div>
        <div className="text-xs text-navy-300 mt-0.5">
          We need about 40% answered to derive a reliable score. Skip any you&apos;re unsure about
          — unanswered dimensions default to a neutral 3/5.
        </div>
      </div>
      <div className="text-right">
        <div className="text-lg font-semibold text-heading">
          {answered}/{total}
        </div>
        <div className="text-xs text-navy-300">answered</div>
      </div>
    </div>

    {DERIVED_QUESTIONS.map((dim) => {
      const derivedScore = capabilities[dim.key];
      return (
        <div key={dim.key} className="card p-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h3 className="text-base font-medium text-heading">{dim.label}</h3>
              <p className="text-xs text-navy-400 mt-1 max-w-xl">{dim.description}</p>
            </div>
            <Tooltip
              placement="left"
              content={
                <>
                  Computed from your answers below. Each option contributes 1-5; the dimension
                  score is the rounded average. Unanswered = 3.
                </>
              }
            >
              <span className={clsx(
                'text-sm font-semibold px-3 py-1 rounded-full flex-shrink-0 cursor-help inline-flex items-center gap-1',
                derivedScore >= 4 ? 'bg-success-600/20 text-success-300' :
                derivedScore >= 3 ? 'bg-warning-600/20 text-warning-400' :
                derivedScore >= 2 ? 'bg-warning-800/30 text-warning-400' :
                'bg-lava/20 text-lava-300'
              )}>
                Derived: {derivedScore}/5
                <HelpCircle className="w-3.5 h-3.5 opacity-60" />
              </span>
            </Tooltip>
          </div>

          <div className="space-y-5">
            {dim.questions.map((q) => {
              const selected = answers[`${dim.key}.${q.key}`];
              return (
                <div key={q.key}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm text-heading font-medium">{q.question}</span>
                    {q.helpText && (
                      <Tooltip content={q.helpText}>
                        <HelpCircle className="w-3.5 h-3.5 text-navy-400" />
                      </Tooltip>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    {q.options.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => onAnswer(dim.key, q.key, opt.value)}
                        className={clsx(
                          'text-left px-3 py-2 rounded-md border text-xs transition-colors',
                          selected === opt.value
                            ? 'border-lava bg-lava/10 text-heading'
                            : 'border-navy-600 bg-navy-800 text-navy-300 hover:border-navy-500 hover:text-heading'
                        )}
                      >
                        <span className="font-semibold mr-1">{opt.value}.</span>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    })}
  </div>
);
