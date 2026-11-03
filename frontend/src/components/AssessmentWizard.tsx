import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowLeft, ArrowRight, Zap, Loader2 } from 'lucide-react';
import { ProgressBar } from './ProgressBar';
import { StepProfile } from './StepProfile';
import { StepInfrastructure } from './StepInfrastructure';
import { StepCurrentUseCases } from './StepCurrentUseCases';
import { StepCapabilities } from './StepCapabilities';
import { PreassessmentWorkbook } from './PreassessmentWorkbook';
import { countAnswered } from '../data/derivedCapability';
import { infrastructureQuestionsFor } from '../data/questions';
import type { AssessmentAnswers } from '../data/questions';

interface AssessmentWizardProps {
  answers: AssessmentAnswers;
  onAnswersChange: (answers: AssessmentAnswers) => void;
  onComplete: () => void;
  onBack: () => void;
  initialStep?: number;
  onStepChange?: (step: number) => void;
  draftId?: string | null;
}

const STEP_LABELS = ['Profile', 'Infrastructure', 'Use Cases', 'Capabilities'];
const TOTAL_STEPS = STEP_LABELS.length;
const LAST_STEP = TOTAL_STEPS - 1;

export const AssessmentWizard: React.FC<AssessmentWizardProps> = ({
  answers,
  onAnswersChange,
  onComplete,
  onBack,
  initialStep = 0,
  onStepChange,
  draftId,
}) => {
  const [step, setStepInner] = useState(initialStep);
  // Allow the parent to push step changes (e.g. consistency-check modal's
  // "go fix step X" action). useState only seeds on mount, so we need an
  // effect to honor later prop updates.
  useEffect(() => { setStepInner(initialStep); }, [initialStep]);
  // Complete-profile accounts open on Infrastructure — the worksheet callout
  // belongs on whichever step the assessment actually starts from.
  const entryStep = useRef(initialStep).current;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const setStep = (s: number) => {
    setStepInner(s);
    onStepChange?.(s);
  };

  const canProceed = (): boolean => {
    switch (step) {
      case 0:
        return !!(
          answers.profile.companyName?.trim() &&
          answers.profile.utilityType &&
          answers.profile.territorySize &&
          answers.profile.geography &&
          answers.profile.strategicPriorities.length > 0
        );
      case 1: {
        // Only require answers for infra questions actually shown for the
        // selected utility type. The big 5 baseline are present for every
        // type, but per-type filtering may hide e.g. AMI / GIS — so don't
        // gate on those.
        const infra = answers.infrastructure;
        const visible = infrastructureQuestionsFor(answers.profile.utilityType);
        return visible.every(q => !!infra[q.key]);
      }
      case 2:
        return true; // Can proceed with zero selected
      case 3: {
        // Capabilities — self-mode always has defaults; derived mode needs enough answers
        if (answers.capabilityMode.mode === 'self') return true;
        const { answered, total } = countAnswered(answers.capabilityMode.derivedAnswers);
        // require at least ~40% answered to get a meaningful derived score
        return answered >= Math.max(6, Math.floor(total * 0.4));
      }
      default:
        return false;
    }
  };

  const handleNext = async () => {
    if (step < LAST_STEP) {
      setStep(step + 1);
    } else {
      setIsSubmitting(true);
      await new Promise((r) => setTimeout(r, 500));
      onComplete();
    }
  };

  const handlePrev = () => {
    if (step > 0) setStep(step - 1);
    else onBack();
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <StepProfile
            data={answers.profile}
            onChange={(profile) => onAnswersChange({ ...answers, profile })}
          />
        );
      case 1:
        return (
          <StepInfrastructure
            data={answers.infrastructure}
            onChange={(infrastructure) => onAnswersChange({ ...answers, infrastructure })}
            utilityType={answers.profile.utilityType}
          />
        );
      case 2:
        return (
          <StepCurrentUseCases
            data={answers.currentUseCases}
            utilityType={answers.profile.utilityType}
            operationsScope={answers.profile.operationsScope ?? null}
            onChange={(currentUseCases) => onAnswersChange({ ...answers, currentUseCases })}
          />
        );
      case 3:
        return (
          <StepCapabilities
            capabilities={answers.capabilities}
            capabilityMode={answers.capabilityMode}
            onChange={(capabilities, capabilityMode) =>
              onAnswersChange({ ...answers, capabilities, capabilityMode })
            }
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-navy-600 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-lava flex items-center justify-center">
              <Zap className="w-5 h-5 text-heading" />
            </div>
            <span className="text-lg font-semibold text-heading">Maturity Assessment</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="text-sm text-navy-400 hover:text-heading transition-colors"
            >
              Exit
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <ProgressBar
            currentStep={step}
            totalSteps={TOTAL_STEPS}
            stepLabels={STEP_LABELS}
          />

          {(step === 0 || (step === 1 && entryStep === 1)) && (
            <PreassessmentWorkbook answers={answers} onAnswersChange={onAnswersChange} />
          )}
          {step === 2 && (
            <PreassessmentWorkbook answers={answers} onAnswersChange={onAnswersChange} variant="compact" />
          )}

          <div className="min-h-[500px]">{renderStep()}</div>

          <div className="flex justify-between items-center mt-10 pt-6 border-t border-navy-600">
            <button
              onClick={handlePrev}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-navy-400 hover:text-heading
                         border border-navy-600 hover:border-navy-500 transition-all duration-200"
            >
              <ArrowLeft className="w-4 h-4" />
              {step === 0 ? 'Home' : 'Back'}
            </button>

            <button
              onClick={handleNext}
              disabled={!canProceed() || isSubmitting}
              className={clsx(
                'flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all duration-200',
                canProceed() && !isSubmitting
                  ? 'bg-lava hover:bg-lava-700 text-heading shadow-card'
                  : 'bg-navy-600 text-navy-500 cursor-not-allowed'
              )}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : step === LAST_STEP ? (
                <>
                  View Results
                  <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};
