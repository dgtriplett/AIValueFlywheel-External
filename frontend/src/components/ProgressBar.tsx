import React from 'react';
import { clsx } from 'clsx';

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
  stepLabels: string[];
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ currentStep, totalSteps, stepLabels }) => {
  const progress = ((currentStep) / totalSteps) * 100;

  return (
    <div className="w-full mb-8">
      {/* Time estimate */}
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-slate-400">
          Step {currentStep + 1} of {totalSteps}
        </div>
        <div className="text-sm text-slate-400">
          ~{Math.max(1, totalSteps - currentStep)} min remaining
        </div>
      </div>

      {/* Progress track */}
      <div className="relative">
        <div className="h-1.5 bg-navy-600 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-electric to-electric-300 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Step dots */}
        <div className="flex justify-between mt-3">
          {stepLabels.map((label, i) => (
            <div key={i} className="flex flex-col items-center" style={{ width: `${100 / totalSteps}%` }}>
              <div
                className={clsx(
                  'w-3 h-3 rounded-full border-2 transition-all duration-300 -mt-[13px]',
                  i < currentStep
                    ? 'bg-electric border-electric'
                    : i === currentStep
                    ? 'bg-electric/30 border-electric animate-pulse-slow'
                    : 'bg-navy-700 border-navy-500'
                )}
              />
              <span
                className={clsx(
                  'text-xs mt-2 text-center leading-tight',
                  i <= currentStep ? 'text-electric-300' : 'text-slate-500'
                )}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
