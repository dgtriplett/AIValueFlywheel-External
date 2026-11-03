import React, { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  X as XIcon, CheckCircle2, AlertTriangle, Clock, MinusCircle, Activity,
  Plus, Trash2, Loader2, TrendingUp, TrendingDown, Target,
} from 'lucide-react';
import { api } from '../lib/api';
import { getUseCaseById, PHASE_COLORS, DOMAIN_COLORS } from '../data/useCases';
import type { StrategicRoadmap, RoadmapBucket } from '../data/strategicRoadmap';

export type CheckinStatus = 'committed' | 'in_progress' | 'delivered' | 'slipped' | 'cancelled';

const STATUS_META: Record<CheckinStatus, { label: string; color: string; icon: React.ReactNode }> = {
  committed:    { label: 'Committed',    color: 'text-navy-300',     icon: <Target className="w-3 h-3" /> },
  in_progress:  { label: 'In flight',    color: 'text-electric',     icon: <Activity className="w-3 h-3" /> },
  delivered:    { label: 'Delivered',    color: 'text-success-300',  icon: <CheckCircle2 className="w-3 h-3" /> },
  slipped:      { label: 'Slipped',      color: 'text-warning-200',  icon: <AlertTriangle className="w-3 h-3" /> },
  cancelled:    { label: 'Cancelled',    color: 'text-navy-500',     icon: <MinusCircle className="w-3 h-3" /> },
};

interface Props {
  customerName: string;
  assessmentId: string | null;
  activeRoadmap: StrategicRoadmap;
  onClose: () => void;
}

/**
 * Outcome tracker — manages frozen roadmap commitments + quarterly check-ins.
 *
 * Two modes:
 *   1. No commitment yet → "Commit roadmap" button to freeze the active schedule
 *   2. Commitment exists → list of check-ins with a "Log check-in" form, plus a
 *      variance view comparing planned vs delivered
 */
export const OutcomeTracker: React.FC<Props> = ({ customerName, assessmentId, activeRoadmap, onClose }) => {
  const [commitments, setCommitments] = useState<Awaited<ReturnType<typeof api.listCommitments>> | null>(null);
  const [activeCommitId, setActiveCommitId] = useState<string | null>(null);
  const [active, setActive] = useState<Awaited<ReturnType<typeof api.getCommitment>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCommitForm, setShowCommitForm] = useState(false);
  const [showCheckinForm, setShowCheckinForm] = useState(false);

  // Load commitments for this customer.
  const reload = async () => {
    if (!customerName) return;
    try {
      const list = await api.listCommitments(customerName);
      setCommitments(list);
      if (list.length > 0 && !activeCommitId) {
        setActiveCommitId(list[0].id);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load commitments');
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [customerName]);

  // Load the active commitment's full detail.
  useEffect(() => {
    if (!activeCommitId) { setActive(null); return; }
    setBusy(true);
    api.getCommitment(activeCommitId)
      .then(setActive)
      .catch(e => setError(e?.message || 'Failed to load commitment'))
      .finally(() => setBusy(false));
  }, [activeCommitId]);

  const commitRoadmap = async (notes: string) => {
    setBusy(true); setError(null);
    try {
      // Strip the parts we need to persist — we don't need the full result blob,
      // just enough to reconstruct the planned schedule for variance comparison.
      const schedule = {
        horizonYears: activeRoadmap.horizonYears,
        startDate: activeRoadmap.startDate,
        totalAnnualValueLowMM: activeRoadmap.totalAnnualValueLowMM,
        totalAnnualValueHighMM: activeRoadmap.totalAnnualValueHighMM,
        buckets: activeRoadmap.buckets.map(b => ({
          index: b.index,
          label: b.label,
          useCases: b.useCases.map(u => ({
            id: u.id, name: u.name, domain: u.domain, phase: u.phase,
            complexity: u.complexity, timeToValue: u.timeToValue,
            annualValueLowMM: u.annualValueLowMM, annualValueHighMM: u.annualValueHighMM,
            isSiDelivered: u.isSiDelivered, siCostMM: u.siCostMM,
          })),
          cumulativeValueLowMM: b.cumulativeValueLowMM,
          cumulativeValueHighMM: b.cumulativeValueHighMM,
        })),
      };
      const r = await api.createCommitment({
        customerName,
        assessmentId,
        horizonYears: activeRoadmap.horizonYears,
        startDate: activeRoadmap.startDate,
        schedule,
        notes,
      });
      setShowCommitForm(false);
      setActiveCommitId(r.id);
      await reload();
    } catch (e: any) {
      setError(e?.message || 'Commit failed');
    } finally {
      setBusy(false);
    }
  };

  const logCheckin = async (asOfDate: string, status: Record<string, CheckinStatus>, notes: string) => {
    if (!activeCommitId) return;
    setBusy(true); setError(null);
    try {
      await api.createCheckin({ commitmentId: activeCommitId, asOfDate, status, notes });
      setShowCheckinForm(false);
      // Reload the commitment to get the new check-in.
      const fresh = await api.getCommitment(activeCommitId);
      setActive(fresh);
    } catch (e: any) {
      setError(e?.message || 'Check-in failed');
    } finally {
      setBusy(false);
    }
  };

  const deleteCommit = async (id: string) => {
    if (!window.confirm('Delete this commitment and all its check-ins?')) return;
    setBusy(true);
    try {
      await api.deleteCommitment(id);
      setActiveCommitId(null);
      await reload();
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative w-full max-w-4xl h-full bg-navy-800 border-l border-navy-600 overflow-y-auto"
        style={{ animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
      >
        <div className="sticky top-0 z-10 bg-navy-800 border-b border-navy-600 p-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-heading inline-flex items-center gap-2">
              <Activity className="w-5 h-5 text-electric" /> Outcome tracking
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Freeze the current roadmap as a commitment. Log quarterly check-ins to capture which use cases
              actually shipped — variance view shows what's on track, in flight, slipped, or dropped.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded hover:bg-navy-700 text-slate-300">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="m-5 text-xs px-3 py-2 rounded bg-lava/10 border border-lava/30 text-lava-300 inline-flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" /> {error}
          </div>
        )}

        {/* Commitments list */}
        <div className="px-5 py-4 border-b border-navy-700">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] text-navy-400 uppercase tracking-wider">
              {commitments?.length ?? '…'} commitment{(commitments?.length ?? 0) === 1 ? '' : 's'} for {customerName}
            </div>
            <button
              onClick={() => setShowCommitForm(true)}
              className="text-xs px-2.5 py-1 rounded border border-electric/40 text-electric hover:bg-electric/10 inline-flex items-center gap-1.5"
              disabled={busy}
            >
              <Plus className="w-3 h-3" /> Commit current roadmap
            </button>
          </div>

          {commitments && commitments.length === 0 && !showCommitForm && (
            <div className="text-xs text-navy-400 italic py-4">
              No commitments yet. Once the customer signs off on the active roadmap, freeze it as a commitment to enable check-ins.
            </div>
          )}

          {(commitments || []).length > 0 && (
            <ul className="space-y-1.5">
              {commitments!.map(c => (
                <li
                  key={c.id}
                  className={clsx(
                    'p-2 rounded border flex items-center justify-between gap-3',
                    activeCommitId === c.id ? 'border-electric/50 bg-electric/5' : 'border-navy-700 bg-navy-900/40 hover:bg-navy-900/60'
                  )}
                >
                  <button onClick={() => setActiveCommitId(c.id)} className="text-left flex-1 min-w-0">
                    <div className="text-sm text-heading">
                      Committed {fmtDate(c.created_at)} · {c.horizon_years}-yr horizon
                    </div>
                    <div className="text-[11px] text-navy-400 mt-0.5 truncate">
                      Start: {c.start_date}{c.notes ? ` · ${c.notes}` : ''}
                    </div>
                  </button>
                  <button
                    onClick={() => deleteCommit(c.id)}
                    className="text-navy-400 hover:text-lava p-1 flex-shrink-0"
                    title="Delete commitment"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {showCommitForm && (
          <CommitForm
            roadmap={activeRoadmap}
            onSave={commitRoadmap}
            onCancel={() => setShowCommitForm(false)}
            busy={busy}
          />
        )}

        {/* Active commitment detail + check-ins */}
        {busy && !active && <div className="px-5 py-8 text-center text-xs text-navy-400 inline-flex items-center gap-2 justify-center w-full"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>}
        {active && (
          <CommitmentDetail
            commitment={active}
            showCheckinForm={showCheckinForm}
            onOpenCheckinForm={() => setShowCheckinForm(true)}
            onCloseCheckinForm={() => setShowCheckinForm(false)}
            onSaveCheckin={logCheckin}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
};

// ── Commit form ─────────────────────────────────────────────────────────────
const CommitForm: React.FC<{
  roadmap: StrategicRoadmap;
  onSave: (notes: string) => void;
  onCancel: () => void;
  busy: boolean;
}> = ({ roadmap, onSave, onCancel, busy }) => {
  const [notes, setNotes] = useState('');
  const totalUcs = roadmap.buckets.reduce((s, b) => s + b.useCases.length, 0);
  return (
    <div className="px-5 py-4 border-b border-navy-700 bg-navy-900/40">
      <div className="text-xs font-semibold text-heading mb-2">Freeze current roadmap as commitment</div>
      <div className="text-[11px] text-slate-300 mb-3">
        Snapshots the active {roadmap.horizonYears}-year schedule ({totalUcs} use cases · ${roadmap.totalAnnualValueLowMM}M–${roadmap.totalAnnualValueHighMM}M / yr at horizon end).
        After commit you can log quarterly check-ins to track delivery vs plan.
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional notes — context for this commitment (which exec signed off, what was negotiated, etc.)"
        className="input-field text-xs w-full min-h-[60px] mb-2"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onSave(notes)}
          disabled={busy}
          className="px-3 py-1.5 rounded text-xs font-medium bg-electric text-heading border border-electric hover:bg-electric-400 disabled:opacity-50"
        >
          {busy ? <><Loader2 className="w-3 h-3 animate-spin inline mr-1" /> Committing…</> : 'Commit'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded text-xs border border-navy-600 text-slate-300 hover:bg-navy-700">Cancel</button>
      </div>
    </div>
  );
};

// ── Commitment detail (variance + check-ins) ────────────────────────────────
const CommitmentDetail: React.FC<{
  commitment: NonNullable<Awaited<ReturnType<typeof api.getCommitment>>>;
  showCheckinForm: boolean;
  onOpenCheckinForm: () => void;
  onCloseCheckinForm: () => void;
  onSaveCheckin: (asOfDate: string, status: Record<string, CheckinStatus>, notes: string) => void;
  busy: boolean;
}> = ({ commitment, showCheckinForm, onOpenCheckinForm, onCloseCheckinForm, onSaveCheckin, busy }) => {
  const latestCheckin = commitment.checkins[0];
  const formRef = useRef<HTMLDivElement | null>(null);

  // Build per-UC variance: planned bucket index + latest status.
  const variance = useMemo(() => buildVariance(commitment, latestCheckin), [commitment, latestCheckin]);

  // When the check-in form opens, scroll it into view so the user actually
  // sees that something happened. The form sits in the middle of a long
  // sidebar — without this, clicking "Log check-in" looks like a no-op.
  useEffect(() => {
    if (showCheckinForm && formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showCheckinForm]);

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-heading">Variance vs plan</div>
          <div className="text-[11px] text-navy-400">
            {commitment.checkins.length} check-in{commitment.checkins.length === 1 ? '' : 's'}
            {latestCheckin && <> · most recent {latestCheckin.as_of_date}</>}
          </div>
        </div>
        {!showCheckinForm && (
          <button
            onClick={onOpenCheckinForm}
            className="text-xs px-2.5 py-1 rounded border border-success-300/40 text-success-300 hover:bg-success-300/10 inline-flex items-center gap-1.5"
          >
            <Plus className="w-3 h-3" /> Log check-in
          </button>
        )}
      </div>

      {/* Inline check-in form — appears RIGHT under the button so the user
          sees that something happened on click. */}
      {showCheckinForm && (
        <div ref={formRef}>
          <CheckinForm
            commitment={commitment}
            onSave={onSaveCheckin}
            onCancel={onCloseCheckinForm}
            busy={busy}
          />
        </div>
      )}

      {/* Variance summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        {(['delivered', 'in_progress', 'committed', 'slipped', 'cancelled'] as CheckinStatus[]).map(s => (
          <VarianceTile key={s} status={s} count={variance.byStatus[s]} total={variance.total} />
        ))}
      </div>

      {/* Per-bucket plan vs actual */}
      <div className="space-y-2">
        {(commitment.schedule?.buckets || []).map((b: any) => {
          const ucs = (b.useCases || []) as Array<{ id: string; name: string; phase: number; domain: string }>;
          if (ucs.length === 0) return null;
          return (
            <div key={b.index} className="rounded border border-navy-700 bg-navy-900/40 p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-xs font-semibold text-heading">{b.label}</div>
                <div className="text-[10px] text-navy-400">{ucs.length} planned</div>
              </div>
              <ul className="space-y-1">
                {ucs.map(uc => {
                  const status = (variance.byUcId.get(uc.id) || 'committed') as CheckinStatus;
                  const meta = STATUS_META[status];
                  return (
                    <li key={uc.id} className="flex items-center justify-between gap-2 text-[11px] py-0.5">
                      <span className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span
                          className="px-1 py-px rounded text-[9px] flex-shrink-0"
                          style={{ backgroundColor: `${PHASE_COLORS[uc.phase]}20`, color: PHASE_COLORS[uc.phase] }}
                        >P{uc.phase}</span>
                        <span
                          className="px-1 py-px rounded text-[9px] flex-shrink-0"
                          style={{ backgroundColor: `${DOMAIN_COLORS[uc.domain] || '#6B7280'}15`, color: DOMAIN_COLORS[uc.domain] || '#6B7280' }}
                        >{uc.domain}</span>
                        <span className="text-heading truncate">{uc.name}</span>
                      </span>
                      <span className={clsx('inline-flex items-center gap-1 flex-shrink-0', meta.color)}>
                        {meta.icon}
                        {meta.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Check-in history */}
      {commitment.checkins.length > 0 && (
        <div className="mt-4 pt-3 border-t border-navy-700">
          <div className="text-xs font-semibold text-heading mb-2">Check-in history</div>
          <ul className="space-y-1.5">
            {commitment.checkins.map(c => (
              <li key={c.id} className="text-[11px] p-2 rounded bg-navy-900/40 border border-navy-700">
                <div className="text-heading">As of {c.as_of_date} · logged by {c.created_by}</div>
                {c.notes && <div className="text-slate-300 mt-0.5">{c.notes}</div>}
                <div className="text-[10px] text-navy-400 mt-0.5">
                  {Object.values(c.status).filter(s => s === 'delivered').length} delivered ·
                  {' '}{Object.values(c.status).filter(s => s === 'in_progress').length} in flight ·
                  {' '}{Object.values(c.status).filter(s => s === 'slipped').length} slipped
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// ── Check-in form ───────────────────────────────────────────────────────────
// Per-UC status set with click-to-pick pill buttons. Search + per-status filter
// at the top to make a 28-row list manageable. Bulk actions as buttons (one
// per status) so a single click marks every visible row as that status.
const CheckinForm: React.FC<{
  commitment: NonNullable<Awaited<ReturnType<typeof api.getCommitment>>>;
  onSave: (asOfDate: string, status: Record<string, CheckinStatus>, notes: string) => void;
  onCancel: () => void;
  busy: boolean;
}> = ({ commitment, onSave, onCancel, busy }) => {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const latestCheckin = commitment.checkins[0];
  const initialStatus = useMemo(() => {
    const m: Record<string, CheckinStatus> = {};
    const allUcs = (commitment.schedule?.buckets || []).flatMap((b: any) => (b.useCases || []) as Array<{ id: string }>);
    for (const uc of allUcs) {
      m[uc.id] = (latestCheckin?.status?.[uc.id] as CheckinStatus) || 'committed';
    }
    return m;
  }, [commitment, latestCheckin]);
  const [statusMap, setStatusMap] = useState<Record<string, CheckinStatus>>(initialStatus);
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CheckinStatus | 'all'>('all');

  const setStatus = (id: string, s: CheckinStatus) => setStatusMap(prev => ({ ...prev, [id]: s }));

  // Buckets with their UCs filtered by search + status filter.
  const filteredBuckets = useMemo(() => {
    return (commitment.schedule?.buckets || []).map((b: any) => ({
      ...b,
      useCases: ((b.useCases || []) as Array<{ id: string; name: string; domain: string; phase: number }>).filter(uc => {
        if (search.trim() && !uc.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
        if (statusFilter !== 'all' && (statusMap[uc.id] || 'committed') !== statusFilter) return false;
        return true;
      }),
    })).filter((b: any) => b.useCases.length > 0);
  }, [commitment, statusMap, search, statusFilter]);

  const visibleIds = useMemo(
    () => filteredBuckets.flatMap((b: any) => b.useCases.map((u: any) => u.id)),
    [filteredBuckets]
  );

  const bulkSet = (s: CheckinStatus) => {
    setStatusMap(prev => {
      const next = { ...prev };
      for (const id of visibleIds) next[id] = s;
      return next;
    });
  };

  // Counts for the filter chip badges.
  const statusCounts = useMemo(() => {
    const c: Record<CheckinStatus | 'all', number> = {
      all: 0, delivered: 0, in_progress: 0, committed: 0, slipped: 0, cancelled: 0,
    };
    for (const id of Object.keys(statusMap)) {
      c.all++;
      c[statusMap[id]]++;
    }
    return c;
  }, [statusMap]);

  const STATUSES: CheckinStatus[] = ['delivered', 'in_progress', 'committed', 'slipped', 'cancelled'];

  return (
    <div className="rounded-lg border border-success-300/40 bg-success-300/5 p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-success-300">Log check-in</div>
          <div className="text-[10px] text-navy-400 mt-0.5">
            Click a status pill on any row to set it. Use the bulk-action row to apply to all visible UCs.
          </div>
        </div>
        <button
          onClick={onCancel}
          className="text-navy-400 hover:text-heading p-1"
          title="Close form"
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Top row: as-of date + search */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[10px] text-navy-400 uppercase tracking-wider">As-of date</label>
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="input-field text-sm w-full mt-0.5"
          />
        </div>
        <div>
          <label className="text-[10px] text-navy-400 uppercase tracking-wider">Search use cases</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name…"
            className="input-field text-sm w-full mt-0.5"
          />
        </div>
      </div>

      {/* Status filter chips — click to narrow the list to one status. */}
      <div className="flex flex-wrap gap-1 mb-2">
        <button
          onClick={() => setStatusFilter('all')}
          className={clsx(
            'text-[11px] px-2 py-1 rounded border inline-flex items-center gap-1',
            statusFilter === 'all'
              ? 'bg-navy-700 border-navy-500 text-heading'
              : 'bg-navy-900/40 border-navy-700 text-navy-300 hover:bg-navy-800'
          )}
        >
          All <span className="text-navy-500 text-[10px]">{statusCounts.all}</span>
        </button>
        {STATUSES.map(s => {
          const meta = STATUS_META[s];
          const active = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(active ? 'all' : s)}
              className={clsx(
                'text-[11px] px-2 py-1 rounded border inline-flex items-center gap-1',
                active
                  ? `bg-navy-700 border-navy-500 ${meta.color}`
                  : 'bg-navy-900/40 border-navy-700 text-navy-300 hover:bg-navy-800'
              )}
            >
              {meta.icon}
              {meta.label}
              <span className="text-navy-500 text-[10px]">{statusCounts[s]}</span>
            </button>
          );
        })}
      </div>

      {/* Bulk actions — apply a status to every visible UC in one click. */}
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        <span className="text-[10px] text-navy-400 mr-1">
          Set <span className="text-heading font-mono">{visibleIds.length}</span> visible to:
        </span>
        {STATUSES.map(s => {
          const meta = STATUS_META[s];
          return (
            <button
              key={s}
              onClick={() => bulkSet(s)}
              disabled={visibleIds.length === 0}
              className={clsx(
                'text-[10px] px-1.5 py-0.5 rounded border inline-flex items-center gap-1 disabled:opacity-40',
                'border-navy-700 hover:bg-navy-800', meta.color
              )}
              title={`Mark all ${visibleIds.length} visible UCs as ${meta.label}`}
            >
              {meta.icon} {meta.label}
            </button>
          );
        })}
      </div>

      {/* Per-UC list — one row per UC with status pills */}
      <div className="max-h-[50vh] overflow-y-auto border border-navy-700 rounded bg-navy-900/40">
        {filteredBuckets.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-navy-400 italic text-center">
            No use cases match the current filters.
          </div>
        )}
        {filteredBuckets.map((b: any) => (
          <div key={b.index} className="border-b border-navy-700 last:border-b-0">
            <div className="px-3 py-1.5 bg-navy-800/60 text-[10px] font-semibold text-navy-300 uppercase tracking-wider sticky top-0">
              {b.label} <span className="text-navy-500 ml-1">· {b.useCases.length}</span>
            </div>
            {b.useCases.map((uc: { id: string; name: string; domain: string; phase: number }) => (
              <CheckinRow
                key={uc.id}
                uc={uc}
                status={statusMap[uc.id] || 'committed'}
                onChange={(s) => setStatus(uc.id, s)}
              />
            ))}
          </div>
        ))}
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes for this check-in (e.g. what slipped, why, blockers escalated)"
        className="input-field text-xs w-full mt-3 min-h-[50px]"
      />

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onSave(asOfDate, statusMap, notes)}
          disabled={busy}
          className="px-3 py-1.5 rounded text-xs font-medium bg-electric text-heading border border-electric hover:bg-electric-400 disabled:opacity-50"
        >
          {busy ? <><Loader2 className="w-3 h-3 animate-spin inline mr-1" /> Saving…</> : 'Save check-in'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded text-xs border border-navy-600 text-slate-300 hover:bg-navy-700">Cancel</button>
      </div>
    </div>
  );
};

// ── Check-in row — UC label + status pills ──────────────────────────────────
const CheckinRow: React.FC<{
  uc: { id: string; name: string; domain: string; phase: number };
  status: CheckinStatus;
  onChange: (s: CheckinStatus) => void;
}> = ({ uc, status, onChange }) => {
  const STATUSES: CheckinStatus[] = ['delivered', 'in_progress', 'committed', 'slipped', 'cancelled'];
  return (
    <div className="px-3 py-2 hover:bg-navy-800/40 border-b border-navy-700/40 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-heading truncate" title={uc.name}>{uc.name}</div>
          <div className="text-[10px] mt-0.5 inline-flex items-center gap-1.5">
            <span
              className="px-1 py-px rounded font-medium"
              style={{ backgroundColor: `${PHASE_COLORS[uc.phase]}20`, color: PHASE_COLORS[uc.phase] }}
            >P{uc.phase}</span>
            <span
              className="px-1 py-px rounded font-medium"
              style={{ backgroundColor: `${DOMAIN_COLORS[uc.domain] || '#6B7280'}15`, color: DOMAIN_COLORS[uc.domain] || '#6B7280' }}
            >{uc.domain}</span>
          </div>
        </div>
        <div className="flex gap-0.5 flex-shrink-0">
          {STATUSES.map(s => {
            const meta = STATUS_META[s];
            const active = status === s;
            return (
              <button
                key={s}
                onClick={() => onChange(s)}
                className={clsx(
                  'px-1.5 py-1 rounded text-[10px] inline-flex items-center gap-1 border transition-colors',
                  active
                    ? clsx('border-current bg-navy-900', meta.color)
                    : 'border-transparent text-navy-500 hover:bg-navy-700 hover:text-navy-200'
                )}
                title={meta.label}
              >
                {meta.icon}
                <span className={clsx(active ? 'inline' : 'hidden xl:inline')}>{meta.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── Variance tile ───────────────────────────────────────────────────────────
const VarianceTile: React.FC<{ status: CheckinStatus; count: number; total: number }> = ({ status, count, total }) => {
  const meta = STATUS_META[status];
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="rounded border border-navy-700 bg-navy-900/40 px-2 py-1.5">
      <div className={clsx('text-[10px] uppercase tracking-wider inline-flex items-center gap-1', meta.color)}>
        {meta.icon}{meta.label}
      </div>
      <div className="text-lg font-bold font-mono text-heading mt-0.5">{count}</div>
      <div className="text-[9px] text-navy-400">{pct}% of plan</div>
    </div>
  );
};

// ── helpers ─────────────────────────────────────────────────────────────────
function buildVariance(
  commitment: NonNullable<Awaited<ReturnType<typeof api.getCommitment>>>,
  latestCheckin?: { status: Record<string, string> },
) {
  const allUcs: Array<{ id: string }> = (commitment.schedule?.buckets || [])
    .flatMap((b: any) => (b.useCases || []) as Array<{ id: string }>);
  const byUcId = new Map<string, CheckinStatus>();
  const byStatus: Record<CheckinStatus, number> = {
    committed: 0, in_progress: 0, delivered: 0, slipped: 0, cancelled: 0,
  };
  for (const uc of allUcs) {
    const s = (latestCheckin?.status?.[uc.id] as CheckinStatus) || 'committed';
    byUcId.set(uc.id, s);
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  return { byUcId, byStatus, total: allUcs.length };
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return s;
  }
}
