import React, { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Download, Upload, Loader2, AlertTriangle, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import type { AssessmentAnswers } from '../data/questions';
import { buildWorksheetSpec, applyWorksheetAnswers } from '../data/preassessmentSpec';
import { useActiveIndustry } from '../industries/active';
import { api } from '../lib/api';

interface PreassessmentWorkbookProps {
  answers: AssessmentAnswers;
  onAnswersChange: (answers: AssessmentAnswers) => void;
  /** 'full' = the Step 1 callout; 'compact' = a slim re-import bar on later steps. */
  variant?: 'full' | 'compact';
}

/**
 * Pre-assessment worksheet — one Excel workbook covering every wizard step
 * (Profile, Infrastructure, Use Cases, Data Sources, Capabilities). Send it to
 * stakeholders before the session; they answer offline; uploading it
 * pre-fills the whole wizard so the session is a review, not data entry.
 */
export const PreassessmentWorkbook: React.FC<PreassessmentWorkbookProps> = ({
  answers, onAnswersChange, variant = 'full',
}) => {
  const industry = useActiveIndustry();
  const [busy, setBusy] = useState<'download' | 'upload' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const companyName = answers.profile.companyName;

  const download = async () => {
    setBusy('download'); setMessage(null);
    try {
      const blob = await api.preassessmentWorksheet({
        utilityType: answers.profile.utilityType,
        customerName: companyName,
        questions: buildWorksheetSpec(answers, industry),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pu-preassessment-${(companyName || 'customer').replace(/\s+/g, '_')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage({ kind: 'ok', text: 'Worksheet downloaded — send it to stakeholders to complete before the session.' });
    } catch (e: any) {
      setMessage({ kind: 'error', text: e?.message || 'Download failed' });
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    setBusy('upload'); setMessage(null);
    try {
      const r = await api.preassessmentParse(file);
      const { next, applied } = applyWorksheetAnswers(answers, r.answers || {}, industry);
      // Merge — don't overwrite — so repeated imports accumulate.
      const cur = next.currentUseCases;
      onAnswersChange({
        ...next,
        currentUseCases: {
          ...cur,
          selectedUseCases: Array.from(new Set([...(cur.selectedUseCases || []), ...r.useCaseIds])),
          selectedDataSources: Array.from(new Set([...(cur.selectedDataSources || []), ...r.dataSourceIds])),
        },
      });
      const warn = r.warnings.length > 0
        ? ` (${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'} — see console)`
        : '';
      if (r.warnings.length) console.warn('Pre-assessment warnings:', r.warnings);
      const questionPart = applied > 0 ? `${applied} answers, ` : '';
      setMessage({
        kind: r.warnings.length ? 'warn' : 'ok',
        text: `Imported ${questionPart}${r.useCaseIds.length} use cases and ${r.dataSourceIds.length} data sources. `
          + `Step through with Next to review each section.${warn}`,
      });
    } catch (e: any) {
      setMessage({ kind: 'error', text: e?.message || 'Parse failed' });
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const buttons = (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={download}
        disabled={busy !== null}
        className="px-3 py-1.5 rounded text-xs font-medium border border-electric/40 text-electric hover:bg-electric/10 inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        {busy === 'download'
          ? <><Loader2 className="w-3 h-3 animate-spin" /> Building…</>
          : <><Download className="w-3 h-3" /> Download worksheet</>}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={busy !== null}
        className="px-3 py-1.5 rounded text-xs font-medium border border-success-300/40 text-success-300 hover:bg-success-300/10 inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        {busy === 'upload'
          ? <><Loader2 className="w-3 h-3 animate-spin" /> Importing…</>
          : <><Upload className="w-3 h-3" /> Upload completed</>}
      </button>
    </div>
  );

  return (
    <div className={clsx('rounded-lg border border-navy-600 bg-navy-900/40', variant === 'full' ? 'p-4 mb-8' : 'p-3 mb-6')}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          {variant === 'full' ? (
            <>
              <div className="text-sm font-semibold text-heading mb-1 flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4 text-electric" />
                Have stakeholders answer everything ahead of time
              </div>
              <p className="text-xs text-slate-400">
                Download one worksheet covering every step — profile, infrastructure, use cases in
                production, available data sources, and capabilities. When it comes back,
                upload it here and the whole assessment is pre-filled, so the session is a review of
                the answers instead of data entry.
              </p>
            </>
          ) : (
            <div className="text-xs text-slate-400">
              Got a completed pre-assessment worksheet back? Upload it to pre-fill every step.
            </div>
          )}
        </div>
        {buttons}
      </div>
      {message && (
        <div className={clsx(
          'mt-3 text-xs px-3 py-2 rounded inline-flex items-center gap-2',
          message.kind === 'ok' && 'bg-success-300/10 text-success-300 border border-success-300/30',
          message.kind === 'warn' && 'bg-warning/10 text-warning-200 border border-warning/30',
          message.kind === 'error' && 'bg-lava/10 text-lava-300 border border-lava/30',
        )}>
          {message.kind === 'ok' && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />}
          {message.kind !== 'ok' && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
          {message.text}
        </div>
      )}
    </div>
  );
};
