import React, { useState } from 'react';
import { clsx } from 'clsx';
import { FileText, X as XIcon, Loader2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import type { UseCase } from '../data/useCases';

interface CustomerCtx {
  customerName: string;
  utilityType?: string | null;
  territorySize?: string | null;
  strategicPriorities?: string[];
  overallScore?: number | null;
  currentPhase?: number | null;
  horizonValueLowMM?: number | null;
  horizonValueHighMM?: number | null;
}

interface Props {
  useCase: UseCase;
  customer: CustomerCtx;
}

/** POC duration mapping — must match backend _timeline_weeks().
 *  Linear: cx → weeks. */
const CX_TO_WEEKS: Record<number, number> = { 1: 4, 2: 6, 3: 8, 4: 10, 5: 12 };
const durationFor = (complexity: number) => CX_TO_WEEKS[Math.max(1, Math.min(5, complexity))] ?? 8;

/**
 * "Generate POC doc" button + inline modal scoped to a single use case.
 * Renders as a compact button in the use-case detail panel; on click,
 * opens a centered modal with duration + notes, then downloads the .docx.
 *
 * Endpoint and document are unchanged from the roadmap-level entry point —
 * we just call it with `ucIds: [useCase.id]` and the same customer context.
 */
export const PocDocButton: React.FC<Props> = ({ useCase, customer }) => {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Duration is derived from UC complexity — not user-selectable.
  const duration = durationFor(useCase.complexity);

  if (!customer.customerName?.trim()) return null;

  const generate = async () => {
    setBusy(true); setError(null);
    try {
      const blob = await api.generatePocScope({
        customerName: customer.customerName,
        utilityType: customer.utilityType,
        territorySize: customer.territorySize,
        strategicPriorities: customer.strategicPriorities || [],
        overallScore: customer.overallScore,
        currentPhase: customer.currentPhase,
        ucIds: [useCase.id],
        durationWeeks: duration,
        notes,
        horizonValueLowMM: customer.horizonValueLowMM,
        horizonValueHighMM: customer.horizonValueHighMM,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = customer.customerName.replace(/\s+/g, '_');
      const ucSlug = useCase.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      a.href = url;
      a.download = `poc-scope-${slug}-${ucSlug}-${duration}wk.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (e: any) {
      setError(e?.message || 'Generation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] px-2.5 py-1 rounded border border-lava/40 text-lava-300 hover:bg-lava/10 inline-flex items-center gap-1.5"
        title="Generate a Databricks POC scoping document for this use case"
      >
        <FileText className="w-3 h-3" />
        Generate POC doc
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => !busy && setOpen(false)} />
          <div className="relative w-full max-w-lg rounded-lg bg-navy-800 border border-navy-600 shadow-2xl">
            {/* Header */}
            <div className="px-5 py-4 border-b border-navy-600 flex items-start justify-between">
              <div>
                <h3 className="text-sm font-bold text-heading inline-flex items-center gap-2">
                  <FileText className="w-4 h-4 text-electric" /> Generate POC scoping document
                </h3>
                <p className="text-[11px] text-slate-400 mt-1">
                  Customer-owned POC scoping doc for <span className="text-heading">{useCase.name}</span> at{' '}
                  <span className="text-heading">{customer.customerName}</span>. Output: editable .docx.
                </p>
              </div>
              <button
                onClick={() => !busy && setOpen(false)}
                className="p-1 rounded hover:bg-navy-700 text-slate-300"
                disabled={busy}
              ><XIcon className="w-4 h-4" /></button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              {error && (
                <div className="text-xs px-3 py-2 rounded bg-lava/10 border border-lava/30 text-lava-300 inline-flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5" /> {error}
                </div>
              )}

              <div className="rounded border border-navy-700 bg-navy-900/40 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-navy-400 uppercase tracking-wider">POC duration</div>
                    <div className="text-lg font-bold text-electric font-mono">{duration} weeks</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-navy-400 uppercase tracking-wider">Use case complexity</div>
                    <div className="text-sm text-heading font-mono">{useCase.complexity} / 5</div>
                  </div>
                </div>
                <div className="text-[10px] text-navy-400 italic mt-2">
                  Duration derived from complexity (cx 1 → 4 wks · cx 2 → 6 wks · cx 3 → 8 wks · cx 4 → 10 wks · cx 5 → 12 wks).
                </div>
              </div>

              <div>
                <label className="text-[10px] text-navy-400 uppercase tracking-wider">Engagement notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={busy}
                  placeholder="Anything POC-specific — known constraints, exec sponsors, dates, prior work to leverage"
                  className="input-field text-xs w-full mt-1 min-h-[70px]"
                />
              </div>

              <div className="text-[10px] text-navy-400 italic">
                Document covers: business problem · use case definition · scope (in/out) · success criteria ·
                technical approach · data + system requirements · {duration}-week timeline · roles &
                responsibilities · acceptance criteria · path to production.
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-navy-600 flex items-center justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="px-3 py-1.5 rounded text-xs border border-navy-600 text-slate-300 hover:bg-navy-700"
              >Cancel</button>
              <button
                onClick={generate}
                disabled={busy}
                className={clsx(
                  'px-3 py-1.5 rounded text-xs font-medium border inline-flex items-center gap-1.5',
                  busy ? 'border-navy-500 text-navy-500 cursor-not-allowed'
                       : 'bg-electric text-heading border-electric hover:bg-electric-400'
                )}
              >
                {busy ? <><Loader2 className="w-3 h-3 animate-spin" /> Building…</> :
                        <><FileText className="w-3 h-3" /> Generate POC doc</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
