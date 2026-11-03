/**
 * IndustryBlendPicker — modal that lets the user check 2+ industry packs to
 * compose a "Custom blend" assessment. Used in StepProfile (assessment start)
 * and RoadmapView (during exploration).
 *
 * UX:
 *   - Trigger button shows "Custom blend (N selected)" or "Build custom blend"
 *   - Click opens a modal with one checkbox per industry
 *   - At least 2 packs must be checked to confirm; below 2, pick a single
 *     industry instead via the regular picker
 *   - Optional: a row of preset chips (e.g. "Quanta", "Bloom") if presets exist
 */
import React, { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { X, Boxes, Check, Bookmark } from 'lucide-react';
import type { IndustryMeta } from '../industries/types';

export interface BlendPreset {
  id: string;
  label: string;
  industryIds: string[];
  description?: string;
}

interface IndustryBlendPickerProps {
  industries: IndustryMeta[];
  /** Currently active ids — used to pre-check the modal. */
  activeIds: string[];
  /** Optional named presets surfaced as quick-pick chips. */
  presets?: BlendPreset[];
  onApply: (industryIds: string[]) => void;
  onClose: () => void;
}

export const IndustryBlendPicker: React.FC<IndustryBlendPickerProps> = ({
  industries, activeIds, presets, onApply, onClose,
}) => {
  const [selected, setSelected] = useState<Set<string>>(new Set(activeIds));

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const applyPreset = (preset: BlendPreset) => {
    setSelected(new Set(preset.industryIds));
  };

  const apply = () => {
    if (selected.size < 1) return;
    onApply(Array.from(selected));
    onClose();
  };

  const canApply = selected.size >= 1;
  const sortedIndustries = useMemo(
    () => [...industries].sort((a, b) => a.label.localeCompare(b.label)),
    [industries]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Build a custom industry blend"
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-navy-500 bg-navy-800 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-navy-600">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-electric/15 border border-electric/30 flex items-center justify-center">
              <Boxes className="w-4 h-4 text-electric" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-heading">Build a custom industry blend</h2>
              <p className="text-xs text-navy-400 mt-0.5 max-w-md">
                Compose use cases, domains, customer types, and assumptions from any combination of
                industry packs. Useful when a customer spans multiple verticals.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-heading" title="Cancel">
            <X className="w-4 h-4" />
          </button>
        </div>

        {presets && presets.length > 0 && (
          <div className="px-5 py-3 border-b border-navy-700/60 bg-navy-900/30">
            <div className="text-[10px] uppercase tracking-wider text-navy-400 mb-1.5 flex items-center gap-1">
              <Bookmark className="w-3 h-3" /> Saved blends
            </div>
            <div className="flex flex-wrap gap-2">
              {presets.map(p => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p)}
                  className="px-2.5 py-1 rounded-full text-[11px] border border-electric/40 text-electric hover:bg-electric/10"
                  title={p.description || `Apply: ${p.industryIds.join(', ')}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {sortedIndustries.map(ind => {
            const isChecked = selected.has(ind.id);
            return (
              <button
                key={ind.id}
                onClick={() => toggle(ind.id)}
                className={clsx(
                  'w-full flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-colors',
                  isChecked
                    ? 'border-electric bg-electric/10'
                    : 'border-navy-600 bg-navy-700/40 hover:border-navy-500'
                )}
              >
                <div className={clsx(
                  'w-5 h-5 rounded border-2 mt-0.5 flex-shrink-0 flex items-center justify-center transition-colors',
                  isChecked ? 'border-electric bg-electric' : 'border-navy-500'
                )}>
                  {isChecked && <Check className="w-3 h-3 text-heading" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={clsx('text-sm font-medium', isChecked ? 'text-heading' : 'text-slate-200')}>
                    {ind.label}
                  </div>
                  {ind.description && (
                    <div className="text-[11px] text-navy-400 mt-0.5 line-clamp-2">{ind.description}</div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[10px] text-navy-500">
                    {ind.domains?.length > 0 && <span>{ind.domains.length} domains</span>}
                    {ind.customerTypes?.length > 0 && <span>· {ind.customerTypes.length} customer types</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-navy-600">
          <div className="text-xs text-navy-400">
            {selected.size} pack{selected.size === 1 ? '' : 's'} selected
            {selected.size > 1 && (
              <span className="ml-2 text-electric-300">— will produce a blended assessment</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-sm border border-navy-500 text-slate-300 hover:text-heading hover:border-navy-400"
            >
              Cancel
            </button>
            <button
              onClick={apply}
              disabled={!canApply}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-sm font-medium',
                canApply
                  ? 'bg-electric hover:bg-electric-400 text-heading'
                  : 'bg-navy-700 text-navy-500 cursor-not-allowed'
              )}
            >
              Apply {selected.size > 1 ? 'blend' : 'industry'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
