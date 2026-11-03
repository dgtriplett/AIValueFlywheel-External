/**
 * ScenarioSwitcher — compact header dropdown that lets the SA switch between
 * the base assessment and any saved what-if scenarios. Opens the full
 * `ScenariosModal` for create/rename/delete management.
 *
 * Scenarios are stored on `AssessmentAnswers.scenarios`. The active one is
 * `activeScenarioId`; when set, that scenario's `refinements` REPLACE the
 * base refinements for every view + scoring path (see `activeRefinements` in
 * `data/refinements.ts`).
 */
import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Layers, ChevronDown, Settings, Check } from 'lucide-react';
import type { AssessmentAnswers } from '../data/questions';
import { setActiveScenario } from '../data/refinements';

interface ScenarioSwitcherProps {
  answers: AssessmentAnswers;
  onChange: (next: AssessmentAnswers) => void;
  onManage: () => void;
}

export const ScenarioSwitcher: React.FC<ScenarioSwitcherProps> = ({ answers, onChange, onManage }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const scenarios = answers.scenarios || [];
  const activeId = answers.activeScenarioId || null;
  const active = scenarios.find(s => s.id === activeId) || null;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // If there are no scenarios saved, render a single "Save scenario" affordance
  // that just opens the manage modal — keeps the header tidy.
  if (scenarios.length === 0) {
    return (
      <button
        onClick={onManage}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                   bg-navy-700 text-slate-300 border border-navy-500 hover:border-electric/30 hover:text-heading transition-all"
        title="Save the current refinements + roadmap dials as a named scenario"
      >
        <Layers className="w-4 h-4" />
        Scenarios
      </button>
    );
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(v => !v)}
        className={clsx(
          'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
          active
            ? 'bg-electric/10 text-electric border border-electric/30 hover:bg-electric/20'
            : 'bg-navy-700 text-slate-300 border border-navy-500 hover:border-electric/30 hover:text-heading',
        )}
        title="Switch between saved scenarios"
      >
        <Layers className="w-4 h-4" />
        <span className="max-w-[180px] truncate">{active ? active.name : 'Base'}</span>
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-72 z-50 rounded-lg border border-navy-500 bg-navy-800 shadow-2xl overflow-hidden"
        >
          <button
            type="button"
            onClick={() => { setActiveScenario(answers, null, onChange); setOpen(false); }}
            className={clsx(
              'w-full flex items-start gap-2 px-3 py-2 text-left text-xs hover:bg-navy-700 transition-colors',
              !active ? 'text-electric' : 'text-slate-300',
            )}
          >
            <Layers className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">Base assessment</div>
              <div className="text-[10px] text-navy-400">No scenario overlay applied</div>
            </div>
            {!active && <Check className="w-3.5 h-3.5 mt-0.5" />}
          </button>
          <div className="border-t border-navy-700" />
          <div className="max-h-64 overflow-y-auto">
            {scenarios.map(s => {
              const isActive = s.id === activeId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setActiveScenario(answers, s.id, onChange); setOpen(false); }}
                  className={clsx(
                    'w-full flex items-start gap-2 px-3 py-2 text-left text-xs hover:bg-navy-700 transition-colors',
                    isActive ? 'text-electric' : 'text-slate-300',
                  )}
                >
                  <Layers className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{s.name}</div>
                    {s.description && (
                      <div className="text-[10px] text-navy-400 truncate">{s.description}</div>
                    )}
                  </div>
                  {isActive && <Check className="w-3.5 h-3.5 mt-0.5" />}
                </button>
              );
            })}
          </div>
          <div className="border-t border-navy-700" />
          <button
            type="button"
            onClick={() => { onManage(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-navy-700 hover:text-heading transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            Manage scenarios…
          </button>
        </div>
      )}
    </div>
  );
};
