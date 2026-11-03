/**
 * RefinementsPanel — single modal that shows + edits every per-UC refinement
 * the user has applied to the assessment. One tab per refinement type:
 *
 *   • Discarded         — UCs the SA explicitly removed from this plan
 *   • Out-of-Scope      — UCs that structurally don't apply to this customer
 *   • Pinned            — UCs forced to the top of the recommendation list
 *   • Bucket Pins       — UCs locked to a specific strategic-roadmap bucket
 *   • Notes             — free-text annotations stored per UC
 *   • Value Overrides   — manual $M low/high overrides per UC
 *   • Dependency Edits  — add/remove prerequisite edges per UC
 *
 * Replaces the old `DiscardedUseCasesPanel` (which only covered discards).
 * All edits persist on `AssessmentAnswers.refinements` and flow through the
 * scoring + roadmap pipeline immediately.
 */
import React, { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { X, Undo2, Trash2, Search, Pin, Ban, StickyNote, DollarSign, GitBranch, Layers } from 'lucide-react';
import { getUseCaseById, USE_CASES } from '../data/useCases';
import type { AssessmentAnswers } from '../data/questions';
import {
  countRefinements, activeRefinements,
  setDiscarded, toggleDiscard, toggleOutOfScope, togglePin,
  setBucketPin, setNote, setValueOverride, setDependencyOverride,
  getEffectiveDependencies,
} from '../data/refinements';

type TabKey = 'discarded' | 'oop' | 'pinned' | 'buckets' | 'notes' | 'values' | 'deps';

interface TabDef {
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count: (a: AssessmentAnswers) => number;
}

const TABS: TabDef[] = [
  { key: 'discarded', label: 'Discarded',         icon: Trash2,     count: a => (activeRefinements(a).discardedUseCaseIds?.length || 0) },
  { key: 'oop',       label: 'Out-of-Scope',      icon: Ban,        count: a => (activeRefinements(a).outOfScopeUseCaseIds?.length || 0) },
  { key: 'pinned',    label: 'Pinned',            icon: Pin,        count: a => (activeRefinements(a).pinnedUseCaseIds?.length || 0) },
  { key: 'buckets',   label: 'Bucket Pins',       icon: Layers,     count: a => Object.keys(activeRefinements(a).bucketPins || {}).length },
  { key: 'notes',     label: 'Notes',             icon: StickyNote, count: a => Object.keys(activeRefinements(a).notes || {}).length },
  { key: 'values',    label: 'Value Overrides',   icon: DollarSign, count: a => Object.keys(activeRefinements(a).valueOverrides || {}).length },
  { key: 'deps',      label: 'Dependency Edits',  icon: GitBranch,  count: a => Object.keys(activeRefinements(a).dependencyOverrides || {}).length },
];

interface RefinementsPanelProps {
  answers: AssessmentAnswers;
  onChange: (next: AssessmentAnswers) => void;
  onClose: () => void;
  /** Optional starting tab. Defaults to the first tab that has any entries,
   *  otherwise "discarded". */
  initialTab?: TabKey;
}

export const RefinementsPanel: React.FC<RefinementsPanelProps> = ({
  answers, onChange, onClose, initialTab,
}) => {
  const setRefinement = (next: ReturnType<typeof activeRefinements>) => {
    onChange({ ...answers, refinements: next });
  };

  const defaultTab: TabKey = useMemo(() => {
    if (initialTab) return initialTab;
    const firstNonEmpty = TABS.find(t => t.count(answers) > 0);
    return firstNonEmpty?.key || 'discarded';
  }, [answers, initialTab]);
  const [tab, setTab] = useState<TabKey>(defaultTab);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const totalRefinements = countRefinements(answers);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Refinements"
        className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-xl border border-navy-500 bg-navy-800 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-navy-600">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-electric/15 border border-electric/30 flex items-center justify-center">
              <Pin className="w-4 h-4 text-electric" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-heading">
                Refinements{totalRefinements > 0 && ` (${totalRefinements})`}
              </h2>
              <p className="text-xs text-navy-400 mt-0.5 max-w-xl">
                Per-use-case fine-tuning applied to this assessment. Edits flow into
                every view — recommendations, roadmap, value totals — automatically.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-heading" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab nav */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-navy-600 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon;
            const n = t.count(answers);
            const isActive = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-electric/15 text-electric border border-electric/30'
                    : 'text-navy-300 hover:text-heading hover:bg-navy-700 border border-transparent'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
                {n > 0 && (
                  <span className={clsx(
                    'ml-1 text-[10px] px-1.5 py-0.5 rounded',
                    isActive ? 'bg-electric/30 text-heading' : 'bg-navy-700 text-navy-300'
                  )}>{n}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'discarded' && (
            <IdListTab
              ids={activeRefinements(answers).discardedUseCaseIds || []}
              emptyMessage="Nothing discarded yet. Use the kebab menu on any UC card to discard it."
              actionLabel="Restore"
              onAction={(id) => toggleDiscard(answers, id, setRefinement)}
              onClearAll={() => setDiscarded(answers, [], setRefinement)}
            />
          )}
          {tab === 'oop' && (
            <IdListTab
              ids={activeRefinements(answers).outOfScopeUseCaseIds || []}
              emptyMessage="No use cases marked out-of-scope. Use this for UCs that structurally don't apply to this customer (e.g. generation UCs for a wires-only utility)."
              actionLabel="Restore"
              onAction={(id) => toggleOutOfScope(answers, id, setRefinement)}
            />
          )}
          {tab === 'pinned' && (
            <IdListTab
              ids={activeRefinements(answers).pinnedUseCaseIds || []}
              emptyMessage="No pinned use cases. Pinning forces a UC to the top of the recommendations list — useful when you know a specific UC matters more than readiness scoring suggests."
              actionLabel="Unpin"
              onAction={(id) => togglePin(answers, id, setRefinement)}
            />
          )}
          {tab === 'buckets' && (
            <BucketPinsTab
              pins={activeRefinements(answers).bucketPins || {}}
              onClear={(id) => setBucketPin(answers, id, null, setRefinement)}
            />
          )}
          {tab === 'notes' && (
            <NotesTab
              notes={activeRefinements(answers).notes || {}}
              onEdit={(id, text) => setNote(answers, id, text, setRefinement)}
            />
          )}
          {tab === 'values' && (
            <ValueOverridesTab
              overrides={activeRefinements(answers).valueOverrides || {}}
              onEdit={(id, ov) => setValueOverride(answers, id, ov, setRefinement)}
            />
          )}
          {tab === 'deps' && (
            <DependencyOverridesTab
              answers={answers}
              overrides={activeRefinements(answers).dependencyOverrides || {}}
              onClear={(id) => setDependencyOverride(answers, id, null, setRefinement)}
            />
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

// ─── Simple id-list tab (Discarded / Out-of-Scope / Pinned) ─────────────────

interface IdListTabProps {
  ids: string[];
  emptyMessage: string;
  actionLabel: string;
  onAction: (ucId: string) => void;
  onClearAll?: () => void;
}

const IdListTab: React.FC<IdListTabProps> = ({ ids, emptyMessage, actionLabel, onAction, onClearAll }) => {
  const [search, setSearch] = useState('');
  if (ids.length === 0) return <EmptyState text={emptyMessage} />;

  const rows = ids.map(id => ({ id, uc: getUseCaseById(id) }));
  const filtered = search.trim()
    ? rows.filter(r => {
        const q = search.toLowerCase();
        return r.id.toLowerCase().includes(q)
          || (r.uc?.name || '').toLowerCase().includes(q)
          || (r.uc?.domain || '').toLowerCase().includes(q);
      })
    : rows;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-navy-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="input-field text-xs pl-8 w-full"
          />
        </div>
        {onClearAll && ids.length > 0 && (
          <button
            onClick={onClearAll}
            className="text-xs px-2.5 py-1.5 rounded border border-electric/40 text-electric hover:bg-electric/10 inline-flex items-center gap-1.5"
          >
            <Undo2 className="w-3 h-3" /> Restore all
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {filtered.length === 0 && (
          <div className="text-xs text-navy-400 italic text-center py-6">
            No matches for &ldquo;{search}&rdquo;.
          </div>
        )}
        {filtered.map(({ id, uc }) => (
          <Row key={id} id={id} uc={uc}>
            <button
              onClick={() => onAction(id)}
              className="text-[11px] px-2.5 py-1.5 rounded border border-electric/50 text-electric hover:bg-electric/10 inline-flex items-center gap-1 flex-shrink-0"
            >
              <Undo2 className="w-3 h-3" /> {actionLabel}
            </button>
          </Row>
        ))}
      </div>
    </div>
  );
};

// ─── Bucket pins tab ──────────────────────────────────────────────────────

const BucketPinsTab: React.FC<{ pins: Record<string, number>; onClear: (ucId: string) => void }> = ({ pins, onClear }) => {
  const entries = Object.entries(pins);
  if (entries.length === 0) {
    return <EmptyState text="No bucket pins set. Pin a UC to a specific roadmap bucket from the UC kebab menu when you want to override automatic phasing." />;
  }
  return (
    <div className="space-y-1.5">
      {entries.map(([id, bucketIdx]) => {
        const uc = getUseCaseById(id);
        return (
          <Row key={id} id={id} uc={uc}>
            <span className="text-[11px] px-2 py-1 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
              Bucket {bucketIdx + 1}
            </span>
            <button
              onClick={() => onClear(id)}
              className="text-[11px] px-2.5 py-1.5 rounded border border-navy-500 text-slate-300 hover:text-heading hover:border-navy-400 inline-flex items-center gap-1 flex-shrink-0"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          </Row>
        );
      })}
    </div>
  );
};

// ─── Notes tab ────────────────────────────────────────────────────────────

const NotesTab: React.FC<{ notes: Record<string, string>; onEdit: (ucId: string, text: string | null) => void }> = ({ notes, onEdit }) => {
  const entries = Object.entries(notes);
  if (entries.length === 0) {
    return <EmptyState text="No notes yet. Use the kebab menu on a UC card to add a free-text note — handy for capturing customer-specific context, blockers, or stakeholders." />;
  }
  return (
    <div className="space-y-2">
      {entries.map(([id, text]) => {
        const uc = getUseCaseById(id);
        return (
          <div key={id} className="p-3 rounded-lg border border-navy-700 bg-navy-900/40">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-heading truncate">
                  {uc?.name || <span className="text-navy-400 italic">Not in catalog</span>}
                </div>
                <code className="text-[10px] text-electric">{id}</code>
              </div>
              <button
                onClick={() => onEdit(id, null)}
                className="text-[11px] px-2 py-1 rounded border border-navy-500 text-slate-300 hover:text-heading hover:border-navy-400 inline-flex items-center gap-1 flex-shrink-0"
              >
                <X className="w-3 h-3" /> Remove
              </button>
            </div>
            <textarea
              value={text}
              onChange={(e) => onEdit(id, e.target.value)}
              rows={2}
              className="w-full text-xs bg-navy-900 border border-navy-600 rounded px-2 py-1.5 text-slate-200 placeholder:text-navy-500 focus:border-electric focus:outline-none"
              placeholder="Note…"
            />
          </div>
        );
      })}
    </div>
  );
};

// ─── Value overrides tab ──────────────────────────────────────────────────

const ValueOverridesTab: React.FC<{
  overrides: Record<string, { annualValueLowMM?: number; annualValueHighMM?: number }>;
  onEdit: (ucId: string, override: { annualValueLowMM?: number; annualValueHighMM?: number } | null) => void;
}> = ({ overrides, onEdit }) => {
  const entries = Object.entries(overrides);
  if (entries.length === 0) {
    return <EmptyState text="No value overrides. When the default $M model doesn't match what the customer would actually capture, set a manual low/high from the UC kebab menu." />;
  }
  return (
    <div className="space-y-2">
      {entries.map(([id, ov]) => {
        const uc = getUseCaseById(id);
        return (
          <div key={id} className="p-3 rounded-lg border border-navy-700 bg-navy-900/40">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-heading truncate">
                  {uc?.name || <span className="text-navy-400 italic">Not in catalog</span>}
                </div>
                <code className="text-[10px] text-electric">{id}</code>
              </div>
              <button
                onClick={() => onEdit(id, null)}
                className="text-[11px] px-2 py-1 rounded border border-navy-500 text-slate-300 hover:text-heading hover:border-navy-400 inline-flex items-center gap-1 flex-shrink-0"
              >
                <X className="w-3 h-3" /> Remove
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label className="text-navy-300">Low $M/yr</label>
              <input
                type="number"
                value={ov.annualValueLowMM ?? ''}
                onChange={(e) => onEdit(id, { ...ov, annualValueLowMM: e.target.value === '' ? undefined : Number(e.target.value) })}
                className="w-20 bg-navy-900 border border-navy-600 rounded px-2 py-1 text-slate-200 focus:border-electric focus:outline-none"
                step="0.1"
              />
              <label className="text-navy-300 ml-2">High $M/yr</label>
              <input
                type="number"
                value={ov.annualValueHighMM ?? ''}
                onChange={(e) => onEdit(id, { ...ov, annualValueHighMM: e.target.value === '' ? undefined : Number(e.target.value) })}
                className="w-20 bg-navy-900 border border-navy-600 rounded px-2 py-1 text-slate-200 focus:border-electric focus:outline-none"
                step="0.1"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Dependency overrides tab ─────────────────────────────────────────────

const DependencyOverridesTab: React.FC<{
  answers: AssessmentAnswers;
  overrides: Record<string, { add?: string[]; remove?: string[] }>;
  onClear: (ucId: string) => void;
}> = ({ answers, overrides, onClear }) => {
  const entries = Object.entries(overrides);
  if (entries.length === 0) {
    return <EmptyState text="No dependency edits. If a catalog prerequisite doesn't apply (or a missing one should), edit dependencies from the UC kebab menu — the roadmap sequencer will pick up the change immediately." />;
  }
  return (
    <div className="space-y-2">
      {entries.map(([id, ov]) => {
        const uc = getUseCaseById(id);
        const catalogDeps = uc?.dependencies || [];
        const effective = getEffectiveDependencies(answers, id, catalogDeps);
        const added = (ov.add || []).filter(d => !catalogDeps.includes(d));
        const removed = (ov.remove || []).filter(d => catalogDeps.includes(d));
        return (
          <div key={id} className="p-3 rounded-lg border border-navy-700 bg-navy-900/40">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-heading truncate">
                  {uc?.name || <span className="text-navy-400 italic">Not in catalog</span>}
                </div>
                <code className="text-[10px] text-electric">{id}</code>
              </div>
              <button
                onClick={() => onClear(id)}
                className="text-[11px] px-2 py-1 rounded border border-navy-500 text-slate-300 hover:text-heading hover:border-navy-400 inline-flex items-center gap-1 flex-shrink-0"
              >
                <Undo2 className="w-3 h-3" /> Reset
              </button>
            </div>
            <div className="text-[11px] space-y-1">
              {added.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-navy-400">Added:</span>
                  {added.map(d => (
                    <code key={d} className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      + {d}
                    </code>
                  ))}
                </div>
              )}
              {removed.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-navy-400">Removed:</span>
                  {removed.map(d => (
                    <code key={d} className="px-1.5 py-0.5 rounded bg-lava/15 text-lava-300 border border-lava/30 line-through">
                      − {d}
                    </code>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-navy-700">
                <span className="text-navy-400">Effective:</span>
                {effective.length === 0
                  ? <span className="italic text-navy-500">none</span>
                  : effective.map(d => (
                      <code key={d} className="px-1.5 py-0.5 rounded bg-navy-800 text-slate-300 border border-navy-600">
                        {d}
                      </code>
                    ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Shared row + empty state ─────────────────────────────────────────────

const Row: React.FC<{ id: string; uc: ReturnType<typeof getUseCaseById>; children?: React.ReactNode }> = ({ id, uc, children }) => (
  <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-navy-700 bg-navy-900/40 hover:border-navy-600 transition-colors">
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium text-heading truncate">
        {uc?.name || <span className="text-navy-400 italic">Use case not in catalog</span>}
      </div>
      <div className="text-[11px] text-navy-400 mt-0.5 flex items-center gap-2 flex-wrap">
        <code className="text-[10px] text-electric">{id}</code>
        {uc?.domain && <span>· {uc.domain}</span>}
        {uc?.phase && <span>· Phase {uc.phase}</span>}
        {uc?.industryId && <span>· {uc.industryId}</span>}
      </div>
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">{children}</div>
  </div>
);

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-center justify-center px-6 py-10">
    <div className="text-center max-w-md">
      <div className="text-sm text-navy-300 mb-1">Nothing here yet.</div>
      <div className="text-xs text-navy-500">{text}</div>
    </div>
  </div>
);

// Silences "no-unused-vars" if USE_CASES winds up unused after a refactor.
void USE_CASES;
