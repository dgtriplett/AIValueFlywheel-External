/**
 * UseCaseActionMenu — kebab dropdown that exposes every per-UC refinement
 * action in one place. Drops in wherever a UC card lives (tactical Next-5
 * panel, strategic roadmap buckets, executive summary priorities, blend view).
 *
 * Actions exposed:
 *   • Pin / Unpin to top of recommendations  (toggle)
 *   • Discard / Restore                       (toggle)
 *   • Out-of-scope / Restore                  (toggle)
 *   • Add / edit free-text note               (inline editor)
 *   • Override $M value range                 (inline editor)
 *   • Pin / unpin to a specific roadmap bucket (if bucketCount provided)
 *
 * State lives on `AssessmentAnswers.refinements` via the helpers in
 * `data/refinements.ts`, so any change here flows into every scoring + view
 * layer automatically.
 */
import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  MoreVertical, Pin, PinOff, Trash2, Undo2, Ban, StickyNote, DollarSign, Layers, Check,
} from 'lucide-react';
import type { AssessmentAnswers } from '../data/questions';
import {
  activeRefinements, toggleDiscard, toggleOutOfScope, togglePin,
  setBucketPin, setNote, setValueOverride,
} from '../data/refinements';

interface UseCaseActionMenuProps {
  ucId: string;
  answers: AssessmentAnswers;
  onChange: (next: AssessmentAnswers) => void;
  /** Number of strategic-roadmap buckets — when provided, enables the
   *  "Pin to bucket" sub-menu. Omit on surfaces that don't have buckets. */
  bucketCount?: number;
  /** Position the popover left or right relative to the trigger. */
  align?: 'left' | 'right';
  /** Optional className for the trigger button. */
  triggerClassName?: string;
}

type SubPanel = null | 'note' | 'value' | 'bucket';

export const UseCaseActionMenu: React.FC<UseCaseActionMenuProps> = ({
  ucId, answers, onChange, bucketCount, align = 'right', triggerClassName,
}) => {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<SubPanel>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSub(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setSub(null); }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const r = activeRefinements(answers);
  const isDiscarded = (r.discardedUseCaseIds || []).includes(ucId);
  const isOop = (r.outOfScopeUseCaseIds || []).includes(ucId);
  const isPinned = (r.pinnedUseCaseIds || []).includes(ucId);
  const note = (r.notes || {})[ucId] || '';
  const valueOv = (r.valueOverrides || {})[ucId];
  const bucketPin = (r.bucketPins || {})[ucId];

  const setRefinement = (next: typeof r) => onChange({ ...answers, refinements: next });

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); setSub(null); }}
        className={clsx(
          'p-1 rounded text-navy-300 hover:text-heading hover:bg-navy-700 transition-colors',
          triggerClassName,
        )}
        title="Use case actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className={clsx(
            'absolute z-50 mt-1 w-64 rounded-lg border border-navy-500 bg-navy-800 shadow-2xl overflow-hidden',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {sub === null && (
            <div className="py-1 text-sm">
              <MenuItem
                icon={isPinned ? PinOff : Pin}
                label={isPinned ? 'Unpin from top' : 'Pin to top'}
                hint={isPinned ? 'Currently pinned' : 'Force above scoring order'}
                active={isPinned}
                onClick={() => { togglePin(answers, ucId, setRefinement); setOpen(false); }}
              />
              {typeof bucketCount === 'number' && bucketCount > 0 && (
                <MenuItem
                  icon={Layers}
                  label={typeof bucketPin === 'number' ? `Bucket pin: ${bucketPin + 1}` : 'Pin to bucket…'}
                  hint={typeof bucketPin === 'number' ? 'Click to change' : 'Force into a specific phase'}
                  active={typeof bucketPin === 'number'}
                  onClick={() => setSub('bucket')}
                />
              )}
              <MenuItem
                icon={StickyNote}
                label={note ? 'Edit note' : 'Add note'}
                hint={note ? truncate(note, 40) : 'Free-text annotation'}
                active={!!note}
                onClick={() => setSub('note')}
              />
              <MenuItem
                icon={DollarSign}
                label={valueOv ? 'Edit value override' : 'Set value override'}
                hint={valueOv
                  ? `$${valueOv.annualValueLowMM ?? '—'}–${valueOv.annualValueHighMM ?? '—'}M/yr`
                  : 'Manual $M low/high'}
                active={!!valueOv}
                onClick={() => setSub('value')}
              />
              <div className="my-1 border-t border-navy-700" />
              <MenuItem
                icon={isOop ? Undo2 : Ban}
                label={isOop ? 'Restore (was out-of-scope)' : 'Mark out-of-scope'}
                hint={isOop ? 'Will reappear in views' : 'Structurally doesn’t apply'}
                active={isOop}
                onClick={() => { toggleOutOfScope(answers, ucId, setRefinement); setOpen(false); }}
              />
              <MenuItem
                icon={isDiscarded ? Undo2 : Trash2}
                label={isDiscarded ? 'Restore (was discarded)' : 'Discard'}
                hint={isDiscarded ? 'Will reappear in views' : 'Drop from this plan'}
                active={isDiscarded}
                danger={!isDiscarded}
                onClick={() => { toggleDiscard(answers, ucId, setRefinement); setOpen(false); }}
              />
            </div>
          )}

          {sub === 'note' && (
            <NoteEditor
              initial={note}
              onSave={(text) => { setNote(answers, ucId, text || null, setRefinement); setOpen(false); setSub(null); }}
              onCancel={() => setSub(null)}
            />
          )}

          {sub === 'value' && (
            <ValueEditor
              initial={valueOv}
              onSave={(ov) => { setValueOverride(answers, ucId, ov, setRefinement); setOpen(false); setSub(null); }}
              onCancel={() => setSub(null)}
            />
          )}

          {sub === 'bucket' && typeof bucketCount === 'number' && (
            <BucketPicker
              bucketCount={bucketCount}
              current={typeof bucketPin === 'number' ? bucketPin : null}
              onPick={(idx) => { setBucketPin(answers, ucId, idx, setRefinement); setOpen(false); setSub(null); }}
              onClear={() => { setBucketPin(answers, ucId, null, setRefinement); setOpen(false); setSub(null); }}
              onCancel={() => setSub(null)}
            />
          )}
        </div>
      )}
    </div>
  );
};

// ─── Menu primitives ──────────────────────────────────────────────────────

const MenuItem: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}> = ({ icon: Icon, label, hint, active, danger, onClick }) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className={clsx(
      'w-full flex items-start gap-2 px-3 py-1.5 text-left transition-colors',
      danger
        ? 'text-lava-200 hover:bg-lava/15'
        : active
          ? 'text-electric hover:bg-electric/10'
          : 'text-slate-300 hover:bg-navy-700 hover:text-heading',
    )}
  >
    <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
    <div className="min-w-0 flex-1">
      <div className="text-xs font-medium leading-tight">{label}</div>
      {hint && <div className="text-[10px] text-navy-400 truncate mt-0.5">{hint}</div>}
    </div>
    {active && <Check className="w-3 h-3 mt-0.5 flex-shrink-0" />}
  </button>
);

const NoteEditor: React.FC<{
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}> = ({ initial, onSave, onCancel }) => {
  const [text, setText] = useState(initial);
  return (
    <div className="p-3 space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-navy-400">Note</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        autoFocus
        className="w-full text-xs bg-navy-900 border border-navy-600 rounded px-2 py-1.5 text-slate-200 placeholder:text-navy-500 focus:border-electric focus:outline-none"
        placeholder="e.g. blocked by Snowflake migration, owner = Sarah, etc."
      />
      <div className="flex items-center justify-end gap-1.5">
        <button type="button" onClick={onCancel} className="text-[11px] px-2 py-1 rounded border border-navy-500 text-slate-300 hover:text-heading">
          Cancel
        </button>
        <button type="button" onClick={() => onSave(text.trim())} className="text-[11px] px-2 py-1 rounded bg-electric text-heading hover:bg-electric-400">
          Save
        </button>
      </div>
    </div>
  );
};

const ValueEditor: React.FC<{
  initial?: { annualValueLowMM?: number; annualValueHighMM?: number };
  onSave: (ov: { annualValueLowMM?: number; annualValueHighMM?: number } | null) => void;
  onCancel: () => void;
}> = ({ initial, onSave, onCancel }) => {
  const [low, setLow] = useState<string>(initial?.annualValueLowMM != null ? String(initial.annualValueLowMM) : '');
  const [high, setHigh] = useState<string>(initial?.annualValueHighMM != null ? String(initial.annualValueHighMM) : '');
  const save = () => {
    const lowN = low === '' ? undefined : Number(low);
    const highN = high === '' ? undefined : Number(high);
    if (lowN == null && highN == null) {
      onSave(null);
      return;
    }
    onSave({ annualValueLowMM: lowN, annualValueHighMM: highN });
  };
  return (
    <div className="p-3 space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-navy-400">Annual value override</div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="space-y-1">
          <span className="text-navy-300">Low $M/yr</span>
          <input
            type="number" value={low} onChange={(e) => setLow(e.target.value)}
            step="0.1" autoFocus
            className="w-full bg-navy-900 border border-navy-600 rounded px-2 py-1 text-slate-200 focus:border-electric focus:outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-navy-300">High $M/yr</span>
          <input
            type="number" value={high} onChange={(e) => setHigh(e.target.value)}
            step="0.1"
            className="w-full bg-navy-900 border border-navy-600 rounded px-2 py-1 text-slate-200 focus:border-electric focus:outline-none"
          />
        </label>
      </div>
      <div className="flex items-center justify-between gap-1.5">
        <button type="button" onClick={() => onSave(null)} className="text-[11px] px-2 py-1 rounded border border-navy-500 text-slate-300 hover:text-heading">
          Clear
        </button>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onCancel} className="text-[11px] px-2 py-1 rounded border border-navy-500 text-slate-300 hover:text-heading">
            Cancel
          </button>
          <button type="button" onClick={save} className="text-[11px] px-2 py-1 rounded bg-electric text-heading hover:bg-electric-400">
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

const BucketPicker: React.FC<{
  bucketCount: number;
  current: number | null;
  onPick: (idx: number) => void;
  onClear: () => void;
  onCancel: () => void;
}> = ({ bucketCount, current, onPick, onClear, onCancel }) => (
  <div className="p-3 space-y-2">
    <div className="text-[11px] uppercase tracking-wider text-navy-400">Pin to bucket</div>
    <div className="grid grid-cols-3 gap-1.5">
      {Array.from({ length: bucketCount }).map((_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPick(i)}
          className={clsx(
            'text-xs py-1.5 rounded border transition-colors',
            current === i
              ? 'bg-electric/20 border-electric/60 text-electric'
              : 'bg-navy-900 border-navy-600 text-slate-300 hover:border-electric/40 hover:text-heading',
          )}
        >
          {i + 1}
        </button>
      ))}
    </div>
    <div className="flex items-center justify-between gap-1.5">
      <button type="button" onClick={onClear} className="text-[11px] px-2 py-1 rounded border border-navy-500 text-slate-300 hover:text-heading">
        Clear pin
      </button>
      <button type="button" onClick={onCancel} className="text-[11px] px-2 py-1 rounded border border-navy-500 text-slate-300 hover:text-heading">
        Cancel
      </button>
    </div>
  </div>
);

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
