/**
 * DiscardedUseCasesPanel — modal listing every UC the SA has discarded from
 * the assessment. Lets them restore a UC if they removed one by accident.
 *
 * Discards live on `AssessmentAnswers.refinements.discardedUseCaseIds`. Every
 * UC surface (tactical recommendations, strategic roadmap buckets, blend
 * view, roadmap explorer, data-strategy aggregation, PoC doc dropdown)
 * filters against the same set, so this panel is the single re-add point.
 */
import React from 'react';
import { clsx } from 'clsx';
import { X, Undo2, Trash2, Search } from 'lucide-react';
import { getUseCaseById } from '../data/useCases';

interface DiscardedUseCasesPanelProps {
  discardedIds: string[];
  onRestore: (ucId: string) => void;
  onRestoreAll: () => void;
  onClose: () => void;
}

export const DiscardedUseCasesPanel: React.FC<DiscardedUseCasesPanelProps> = ({
  discardedIds, onRestore, onRestoreAll, onClose,
}) => {
  const [search, setSearch] = React.useState('');
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Resolve UC objects from the catalog. If a discarded id is no longer in the
  // catalog (admin deleted it, blend changed, etc.) we still show a row so the
  // user can clear the stale id from their refinements.
  const rows = discardedIds.map(id => ({
    id,
    uc: getUseCaseById(id),
  }));
  const filtered = search.trim()
    ? rows.filter(r => {
        const q = search.toLowerCase();
        return r.id.toLowerCase().includes(q)
          || (r.uc?.name || '').toLowerCase().includes(q)
          || (r.uc?.domain || '').toLowerCase().includes(q);
      })
    : rows;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Discarded use cases"
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-navy-500 bg-navy-800 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-navy-600">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-lava/15 border border-lava/30 flex items-center justify-center">
              <Trash2 className="w-4 h-4 text-lava" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-heading">
                Discarded use cases{discardedIds.length > 0 && ` (${discardedIds.length})`}
              </h2>
              <p className="text-xs text-navy-400 mt-0.5 max-w-md">
                These use cases are excluded from recommendations, the strategic roadmap, and
                every other view. Click <strong className="text-heading">Restore</strong> to put
                one back.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-heading" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {discardedIds.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-6 py-10">
            <div className="text-center">
              <div className="text-sm text-navy-300 mb-1">Nothing discarded yet.</div>
              <div className="text-xs text-navy-500 max-w-sm">
                Discard buttons appear on every use case card in the recommendations and the
                strategic roadmap. Anything you discard ends up here so you can restore it.
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-navy-700/60 flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-navy-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, domain, or id…"
                  className="input-field text-xs pl-8 w-full"
                />
              </div>
              <button
                onClick={onRestoreAll}
                className="text-xs px-2.5 py-1.5 rounded border border-electric/40 text-electric hover:bg-electric/10 inline-flex items-center gap-1.5"
                title="Restore every discarded use case at once"
              >
                <Undo2 className="w-3 h-3" /> Restore all
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
              {filtered.length === 0 && (
                <div className="text-xs text-navy-400 italic text-center py-6">
                  No discarded use cases match &ldquo;{search}&rdquo;.
                </div>
              )}
              {filtered.map(({ id, uc }) => (
                <div
                  key={id}
                  className="flex items-start justify-between gap-3 p-3 rounded-lg border border-navy-700 bg-navy-900/40 hover:border-navy-600 transition-colors"
                >
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
                  <button
                    onClick={() => onRestore(id)}
                    className="text-[11px] px-2.5 py-1.5 rounded border border-electric/50 text-electric hover:bg-electric/10 inline-flex items-center gap-1 flex-shrink-0"
                  >
                    <Undo2 className="w-3 h-3" /> Restore
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-navy-600">
          <button
            onClick={onClose}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-sm font-medium',
              discardedIds.length === 0
                ? 'bg-electric hover:bg-electric-400 text-heading'
                : 'border border-navy-500 text-slate-300 hover:text-heading hover:border-navy-400'
            )}
          >
            {discardedIds.length === 0 ? 'Got it' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
};
