/**
 * ScenariosModal — full management UI for what-if scenarios. Lets the SA:
 *   • Save the current base refinements + an optional control snapshot as a
 *     new named scenario.
 *   • Switch between saved scenarios (mirrors the header dropdown).
 *   • Rename, duplicate, or delete saved scenarios.
 *   • Commit a scenario's refinements back onto the base assessment.
 *
 * The refinement payload that lives on a scenario REPLACES the base
 * refinements when the scenario is active — see `activeRefinements` in
 * `data/refinements.ts` for the overlay rule.
 */
import React, { useState } from 'react';
import { clsx } from 'clsx';
import { X, Plus, Trash2, Copy, ArrowUpToLine, Check, Edit3, Layers } from 'lucide-react';
import type { AssessmentAnswers } from '../data/questions';
import {
  saveScenarioFromCurrent, deleteScenario, renameScenario, setActiveScenario,
  duplicateScenario, commitScenarioToBase, countRefinements,
} from '../data/refinements';

interface ScenariosModalProps {
  answers: AssessmentAnswers;
  onChange: (next: AssessmentAnswers) => void;
  onClose: () => void;
  /** Optional roadmap-control snapshot to capture alongside the refinements
   *  when "Save current state" is used. The parent supplies these because the
   *  dial values live on local StrategicRoadmapPanel state, not on `answers`. */
  currentControls?: { horizon?: 3 | 5; investmentMPerYear?: number; siUcIds?: string[]; applyAccelerators?: boolean };
}

export const ScenariosModal: React.FC<ScenariosModalProps> = ({
  answers, onChange, onClose, currentControls,
}) => {
  const scenarios = answers.scenarios || [];
  const activeId = answers.activeScenarioId || null;
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onSave = () => {
    if (!newName.trim()) return;
    saveScenarioFromCurrent(answers, newName, onChange, {
      description: newDesc.trim() || undefined,
      controls: currentControls,
    });
    setNewName('');
    setNewDesc('');
  };

  const refsCount = countRefinements(answers);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manage scenarios"
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-navy-500 bg-navy-800 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-navy-600">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-electric/15 border border-electric/30 flex items-center justify-center">
              <Layers className="w-4 h-4 text-electric" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-heading">Scenarios</h2>
              <p className="text-xs text-navy-400 mt-0.5 max-w-md">
                Save a named snapshot of the refinements and roadmap dials.
                Switch between them to compare what-if plans without losing your work.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-heading" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Save new */}
        <div className="px-5 py-4 border-b border-navy-700/60 bg-navy-900/40">
          <div className="text-[11px] uppercase tracking-wider text-navy-400 mb-2">
            Save current state ({refsCount} refinement{refsCount === 1 ? '' : 's'} active)
          </div>
          <div className="space-y-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Scenario name (e.g. “Aggressive 5-yr”, “Wires-only”)"
              className="input-field text-xs w-full"
            />
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Optional description"
              className="input-field text-xs w-full"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onSave}
                disabled={!newName.trim()}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
                  newName.trim()
                    ? 'bg-electric text-heading hover:bg-electric-400'
                    : 'bg-navy-700 text-navy-500 cursor-not-allowed',
                )}
              >
                <Plus className="w-3 h-3" />
                Save scenario
              </button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {scenarios.length === 0 ? (
            <div className="text-center px-6 py-10">
              <div className="text-sm text-navy-300 mb-1">No saved scenarios yet.</div>
              <div className="text-xs text-navy-500 max-w-md mx-auto">
                Use the form above to name your current configuration. You can then tweak the
                refinements + dials and save a second scenario to compare side-by-side.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {scenarios.map(s => {
                const isActive = s.id === activeId;
                const isRenaming = renamingId === s.id;
                return (
                  <div
                    key={s.id}
                    className={clsx(
                      'p-3 rounded-lg border transition-colors',
                      isActive ? 'border-electric/60 bg-electric/5' : 'border-navy-700 bg-navy-900/40 hover:border-navy-600',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        {isRenaming ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={renameValue}
                              autoFocus
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  renameScenario(answers, s.id, renameValue, onChange);
                                  setRenamingId(null);
                                } else if (e.key === 'Escape') {
                                  setRenamingId(null);
                                }
                              }}
                              className="input-field text-xs flex-1"
                            />
                            <button
                              onClick={() => { renameScenario(answers, s.id, renameValue, onChange); setRenamingId(null); }}
                              className="text-[11px] px-2 py-1 rounded bg-electric text-heading hover:bg-electric-400"
                            >Save</button>
                            <button
                              onClick={() => setRenamingId(null)}
                              className="text-[11px] px-2 py-1 rounded border border-navy-500 text-slate-300"
                            >Cancel</button>
                          </div>
                        ) : (
                          <>
                            <div className="text-sm font-medium text-heading flex items-center gap-2">
                              {s.name}
                              {isActive && (
                                <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-electric/20 text-electric border border-electric/40">
                                  active
                                </span>
                              )}
                            </div>
                            {s.description && (
                              <div className="text-[11px] text-navy-300 mt-0.5">{s.description}</div>
                            )}
                            <div className="text-[10px] text-navy-500 mt-1">
                              {new Date(s.createdAt).toLocaleString()}
                            </div>
                          </>
                        )}
                      </div>
                      {!isRenaming && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!isActive && (
                            <button
                              onClick={() => setActiveScenario(answers, s.id, onChange)}
                              className="text-[11px] px-2 py-1 rounded border border-electric/40 text-electric hover:bg-electric/10 inline-flex items-center gap-1"
                              title="Switch to this scenario"
                            >
                              <Check className="w-3 h-3" /> Activate
                            </button>
                          )}
                          <button
                            onClick={() => { setRenameValue(s.name); setRenamingId(s.id); }}
                            className="text-[11px] p-1 rounded border border-navy-500 text-slate-300 hover:text-heading"
                            title="Rename"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => duplicateScenario(answers, s.id, onChange)}
                            className="text-[11px] p-1 rounded border border-navy-500 text-slate-300 hover:text-heading"
                            title="Duplicate"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => commitScenarioToBase(answers, s.id, onChange)}
                            className="text-[11px] p-1 rounded border border-navy-500 text-slate-300 hover:text-heading"
                            title="Promote this scenario's refinements onto the base assessment"
                          >
                            <ArrowUpToLine className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`Delete scenario “${s.name}”? This cannot be undone.`)) {
                                deleteScenario(answers, s.id, onChange);
                              }
                            }}
                            className="text-[11px] p-1 rounded border border-lava/40 text-lava-300 hover:bg-lava/10"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                    {/* Summary line — quick read of what this scenario carries */}
                    {!isRenaming && <ScenarioSummary scenario={s} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-navy-600">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-navy-500 text-slate-300 hover:text-heading hover:border-navy-400"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

const ScenarioSummary: React.FC<{ scenario: AssessmentAnswers['scenarios'] extends (infer T)[] | undefined ? T : never }> = ({ scenario }) => {
  const r = scenario.refinements || {};
  const parts: string[] = [];
  if (r.discardedUseCaseIds?.length)   parts.push(`${r.discardedUseCaseIds.length} discarded`);
  if (r.outOfScopeUseCaseIds?.length)  parts.push(`${r.outOfScopeUseCaseIds.length} out-of-scope`);
  if (r.pinnedUseCaseIds?.length)      parts.push(`${r.pinnedUseCaseIds.length} pinned`);
  if (r.bucketPins && Object.keys(r.bucketPins).length)            parts.push(`${Object.keys(r.bucketPins).length} bucket pins`);
  if (r.notes && Object.keys(r.notes).length)                      parts.push(`${Object.keys(r.notes).length} notes`);
  if (r.valueOverrides && Object.keys(r.valueOverrides).length)    parts.push(`${Object.keys(r.valueOverrides).length} $ overrides`);
  if (r.dependencyOverrides && Object.keys(r.dependencyOverrides).length) parts.push(`${Object.keys(r.dependencyOverrides).length} dep edits`);

  const c = scenario.controls;
  if (c?.horizon) parts.push(`${c.horizon}-yr horizon`);
  if (typeof c?.investmentMPerYear === 'number' && c.investmentMPerYear > 0) parts.push(`$${c.investmentMPerYear}M/yr invest`);
  if (c?.siUcIds?.length) parts.push(`${c.siUcIds.length} SI UCs`);
  if (c?.applyAccelerators) parts.push('accelerators on');

  if (parts.length === 0) {
    return <div className="text-[10px] text-navy-500 italic">Empty scenario — captured at base state.</div>;
  }
  return (
    <div className="text-[10px] text-navy-400 flex flex-wrap gap-x-2 gap-y-0.5">
      {parts.map((p, i) => <span key={i}>{p}</span>)}
    </div>
  );
};
