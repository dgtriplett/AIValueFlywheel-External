import React, { useEffect, useState } from 'react';
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { api, type AssessmentRow } from '../lib/api';

/** Compare an account's SUBMITTED assessments over time — maturity score + phase
 *  trend, so a customer sees progression across re-assessments. Reads server-side
 *  history (GET /api/assessments?status=submitted). */
export function CompareView({ accountName, onBack }: { accountName?: string; onBack: () => void }) {
  const [rows, setRows] = useState<AssessmentRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.listAssessments('submitted')
      .then((r) => setRows(r.assessments || []))
      .catch((e) => setErr(e?.message || String(e)));
  }, []);

  // Oldest → newest so deltas read as progression.
  const series = (rows || []).slice().sort((a, b) =>
    String(a.submitted_at || a.updated_at || '').localeCompare(String(b.submitted_at || b.updated_at || '')));

  const fmt = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : '—');
  const maxScore = Math.max(1, ...series.map((r) => r.overall_score || 0));

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 w-full">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-navy-400 hover:text-heading mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="text-2xl font-bold text-heading">Assessment history — {accountName || 'account'}</h1>
      <p className="text-sm text-navy-400 mb-6">Maturity score and phase across this account's submitted assessments.</p>

      {err && <div className="text-rose-500 text-sm">{err}</div>}
      {rows && series.length === 0 && (
        <div className="text-navy-400 text-sm border border-navy-600 rounded-lg p-6 text-center">
          No submitted assessments yet for this account. Run one in <b>Assess</b> — each submission is kept here for comparison.
        </div>
      )}

      {series.length > 0 && (
        <>
          {/* simple bar trend of maturity score */}
          <div className="border border-navy-600 rounded-lg p-4 mb-5 bg-navy-800/40">
            <div className="text-xs text-navy-400 mb-3">Maturity score over time</div>
            <div className="flex items-end gap-3 h-32">
              {series.map((r) => (
                <div key={r.id} className="flex flex-col items-center justify-end flex-1 min-w-0">
                  <div className="text-xs text-heading mb-1">{r.overall_score ?? '—'}</div>
                  <div className="w-full bg-lava rounded-t" style={{ height: `${((r.overall_score || 0) / maxScore) * 100}%`, minHeight: 4 }} />
                  <div className="text-[10px] text-navy-500 mt-1 truncate w-full text-center">{fmt(r.submitted_at)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto border border-navy-600 rounded-lg">
            <table className="w-full text-sm">
              <thead><tr className="text-navy-400 text-xs">
                <th className="text-left p-2">Submitted</th><th className="text-left p-2">Label</th>
                <th className="text-center p-2">Maturity score</th><th className="text-center p-2">Δ</th>
                <th className="text-center p-2">Phase</th>
              </tr></thead>
              <tbody>
                {series.map((r, i) => {
                  const prev = i > 0 ? (series[i - 1].overall_score || 0) : null;
                  const delta = prev == null ? null : (r.overall_score || 0) - prev;
                  return (
                    <tr key={r.id} className="border-t border-navy-600/50">
                      <td className="p-2 text-heading">{fmt(r.submitted_at)}</td>
                      <td className="p-2 text-navy-400">{r.label || '—'}</td>
                      <td className="p-2 text-center text-heading">{r.overall_score ?? '—'}</td>
                      <td className="p-2 text-center">
                        {delta == null ? <span className="text-navy-500">—</span>
                          : delta > 0 ? <span className="inline-flex items-center gap-0.5 text-emerald-500"><TrendingUp className="w-3 h-3" />+{delta}</span>
                          : delta < 0 ? <span className="inline-flex items-center gap-0.5 text-rose-500"><TrendingDown className="w-3 h-3" />{delta}</span>
                          : <span className="inline-flex items-center gap-0.5 text-navy-500"><Minus className="w-3 h-3" />0</span>}
                      </td>
                      <td className="p-2 text-center text-navy-400">{r.current_phase ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
