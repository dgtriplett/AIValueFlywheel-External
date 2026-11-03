import React from 'react';
import { clsx } from 'clsx';
import { Check, X, Minus, HelpCircle } from 'lucide-react';
import type { InfrastructureAnswers, UtilityType, YesNoPartial } from '../data/questions';
import { infrastructureQuestionsFor } from '../data/questions';

interface StepInfrastructureProps {
  data: InfrastructureAnswers;
  onChange: (data: InfrastructureAnswers) => void;
  utilityType?: UtilityType | null;
}

export const StepInfrastructure: React.FC<StepInfrastructureProps> = ({ data, onChange, utilityType }) => {
  const handleChange = (key: keyof InfrastructureAnswers, value: YesNoPartial) => {
    onChange({ ...data, [key]: value });
  };

  const visibleQuestions = infrastructureQuestionsFor(utilityType ?? null);

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-heading mb-2">Current Data Infrastructure</h2>
        <p className="text-slate-400">
          Help us understand your current data platform capabilities.
        </p>
      </div>

      <div className="space-y-4">
        {visibleQuestions.map((q) => {
          const value = data[q.key];
          return (
            <div
              key={q.key}
              className="card p-6 hover:border-navy-500 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="text-base font-medium text-heading mb-1">{q.question}</h3>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    <HelpCircle className="w-3 h-3" />
                    {q.helpText}
                  </p>
                </div>

                <div className="flex gap-2 flex-shrink-0">
                  <TriStateButton
                    label="Yes"
                    icon={<Check className="w-4 h-4" />}
                    selected={value === 'yes'}
                    selectedClass="border-status-green bg-status-green/10 text-status-green"
                    onClick={() => handleChange(q.key, 'yes')}
                  />
                  <TriStateButton
                    label="Partial"
                    icon={<Minus className="w-4 h-4" />}
                    selected={value === 'partial'}
                    selectedClass="border-status-yellow bg-status-yellow/10 text-status-yellow"
                    onClick={() => handleChange(q.key, 'partial')}
                  />
                  <TriStateButton
                    label="No"
                    icon={<X className="w-4 h-4" />}
                    selected={value === 'no'}
                    selectedClass="border-grid-red bg-grid-red/10 text-grid-red"
                    onClick={() => handleChange(q.key, 'no')}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

function TriStateButton({
  label,
  icon,
  selected,
  selectedClass,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  selectedClass: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all duration-200',
        selected
          ? selectedClass
          : 'border-navy-600 bg-navy-700 text-slate-400 hover:border-navy-500'
      )}
    >
      {icon}
      {label}
    </button>
  );
}
