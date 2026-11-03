import React, { useState } from 'react';
import { clsx } from 'clsx';
import {
  X as XIcon, Plus, Trash2, Calendar, AlertTriangle,
  Anchor as AnchorIcon, Info,
} from 'lucide-react';
import type { ExternalAnchor, AnchorType, AnchorHardness, StrategicRoadmap } from '../data/strategicRoadmap';
import { DOMAIN_NAMES, USE_CASES, getUseCaseById } from '../data/useCases';

const ANCHOR_TYPE_OPTIONS: { value: AnchorType; label: string }[] = [
  { value: 'rate_case',           label: 'Rate case filing' },
  { value: 'regulatory_deadline', label: 'Regulatory deadline (NERC, state PUC, EPA)' },
  { value: 'storm_season',        label: 'Storm season prep window' },
  { value: 'seasonal_peak',       label: 'Seasonal peak (summer / winter)' },
  { value: 'vendor_eol',          label: 'Vendor / system EOL or migration' },
  { value: 'board_milestone',     label: 'Board / executive commitment' },
  { value: 'other',               label: 'Other' },
];

const HARDNESS_OPTIONS: { value: AnchorHardness; label: string; help: string }[] = [
  { value: 'must_complete_before', label: 'Must complete before',  help: 'Constrained UCs must finish on or before this date.' },
  { value: 'must_start_before',    label: 'Must start before',     help: 'Constrained UCs must be in flight by this date.' },
  { value: 'informational',        label: 'Informational only',     help: 'Shown on the timeline but does not constrain placement.' },
];

interface Props {
  anchors: ExternalAnchor[];
  onChange: (next: ExternalAnchor[]) => void;
  onClose: () => void;
  roadmap: StrategicRoadmap;
}

export const AnchorManager: React.FC<Props> = ({ anchors, onChange, onClose, roadmap }) => {
  const [draftId, setDraftId] = useState<string | null>(null);

  const upsert = (a: ExternalAnchor) => {
    const idx = anchors.findIndex(x => x.id === a.id);
    if (idx >= 0) onChange(anchors.map(x => (x.id === a.id ? a : x)));
    else onChange([...anchors, a]);
    setDraftId(null);
  };
  const remove = (id: string) => onChange(anchors.filter(x => x.id !== id));

  const editing = draftId ? anchors.find(a => a.id === draftId) || null : null;
  const showForm = draftId !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative w-full max-w-2xl h-full bg-navy-800 border-l border-navy-600 overflow-y-auto"
        style={{ animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
      >
        <div className="sticky top-0 z-10 bg-navy-800 border-b border-navy-600 p-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-heading inline-flex items-center gap-2">
              <AnchorIcon className="w-5 h-5 text-electric" /> External timeline anchors
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Pin real-world dates the roadmap must respect. The sequencer treats "must complete before"
              anchors as hard constraints — UCs that can't land before the date appear as violations.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded hover:bg-navy-700 text-slate-300">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Existing anchors */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] text-navy-400 uppercase tracking-wider">
              {anchors.length} anchor{anchors.length === 1 ? '' : 's'}
            </div>
            <button
              onClick={() => setDraftId(`new-${Date.now()}`)}
              className="text-xs px-2.5 py-1 rounded border border-electric/40 text-electric hover:bg-electric/10 inline-flex items-center gap-1.5"
            >
              <Plus className="w-3 h-3" /> Add anchor
            </button>
          </div>

          {anchors.length === 0 && !showForm && (
            <div className="text-xs text-navy-400 italic py-6 text-center">
              No anchors yet. Examples: a 2027 rate case filing, NERC CIP-002 deadline, hurricane-season prep cutoff.
            </div>
          )}

          <ul className="space-y-2">
            {anchors.map(a => {
              const violations = roadmap.anchorViolations.filter(v => v.anchor.id === a.id);
              const resolved = roadmap.resolvedAnchors.find(r => r.anchor.id === a.id);
              return (
                <li
                  key={a.id}
                  className={clsx(
                    'rounded border p-3',
                    violations.length > 0 ? 'border-warning/50 bg-warning/5' : 'border-navy-700 bg-navy-900/40'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-heading">{a.label}</div>
                      <div className="text-[11px] text-navy-300 mt-0.5">
                        <Calendar className="inline w-3 h-3 mr-1 align-text-bottom" />
                        {a.date}
                        <span className="mx-1.5 text-navy-500">·</span>
                        {ANCHOR_TYPE_OPTIONS.find(t => t.value === a.type)?.label || a.type}
                        <span className="mx-1.5 text-navy-500">·</span>
                        <span className={clsx(
                          'inline-flex items-center px-1 rounded text-[10px]',
                          a.hardness === 'informational' ? 'bg-navy-700 text-slate-300' : 'bg-electric/15 text-electric'
                        )}>
                          {HARDNESS_OPTIONS.find(h => h.value === a.hardness)?.label}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-300 mt-1">
                        {a.ucIds && a.ucIds.length > 0 && (
                          <>
                            Scope: {a.ucIds.length} use case{a.ucIds.length === 1 ? '' : 's'}
                            <span className="mx-1.5 text-navy-500">·</span>
                          </>
                        )}
                        {a.domain && (
                          <>
                            Scope: every UC in <span className="text-heading">{a.domain}</span>
                          </>
                        )}
                        {!a.ucIds?.length && !a.domain && (
                          <span className="text-navy-500 italic">No scope set — informational only</span>
                        )}
                      </div>
                      {a.notes && (
                        <div className="text-[11px] text-navy-400 italic mt-1">{a.notes}</div>
                      )}
                      {resolved && resolved.bucketIdx >= 0 && resolved.bucketIdx < roadmap.buckets.length && (
                        <div className="text-[10px] text-navy-400 mt-1">
                          Resolves to bucket: {roadmap.buckets[resolved.bucketIdx].label}
                        </div>
                      )}
                      {violations.length > 0 && (
                        <div className="text-[11px] text-warning-200 mt-2 inline-flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                          <div>
                            <div className="font-medium">{violations[0].reason}</div>
                            <div className="text-[10px] text-warning-200/80 mt-0.5">
                              {violations[0].affectedUcIds.slice(0, 3).map(id => getUseCaseById(id)?.name || id).join(', ')}
                              {violations[0].affectedUcIds.length > 3 && ` +${violations[0].affectedUcIds.length - 3} more`}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setDraftId(a.id)}
                        className="text-[11px] px-2 py-1 rounded text-navy-300 hover:text-heading hover:bg-navy-700"
                      >Edit</button>
                      <button
                        onClick={() => remove(a.id)}
                        className="text-navy-400 hover:text-lava p-1"
                        title="Remove anchor"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {showForm && (
          <AnchorForm
            initial={editing}
            draftId={draftId!}
            onSave={upsert}
            onCancel={() => setDraftId(null)}
          />
        )}

        {/* Help footer */}
        <div className="border-t border-navy-700 mt-4 px-5 py-3 bg-navy-900/40">
          <div className="text-[11px] text-navy-300 inline-flex items-start gap-2">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              When you add a "must complete before" anchor, the sequencer pulls the constrained UCs forward.
              If they can't fit (capacity or unmet dependencies push them past the date), the anchor shows as a violation —
              that's a signal to add more partner capacity, mark UCs as SI-delivered, or push the date.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Anchor add/edit form ────────────────────────────────────────────────────
const AnchorForm: React.FC<{
  initial: ExternalAnchor | null;
  draftId: string;
  onSave: (a: ExternalAnchor) => void;
  onCancel: () => void;
}> = ({ initial, draftId, onSave, onCancel }) => {
  const [label, setLabel] = useState(initial?.label || '');
  const [type, setType] = useState<AnchorType>(initial?.type || 'rate_case');
  const [date, setDate] = useState(initial?.date || '');
  const [hardness, setHardness] = useState<AnchorHardness>(initial?.hardness || 'must_complete_before');
  const [scope, setScope] = useState<'lob' | 'use_cases'>(initial?.domain ? 'lob' : 'use_cases');
  const [domain, setDomain] = useState<string>(initial?.domain || DOMAIN_NAMES[0]);
  const [ucIds, setUcIds] = useState<string[]>(initial?.ucIds || []);
  const [notes, setNotes] = useState(initial?.notes || '');
  const [ucFilter, setUcFilter] = useState('');

  const submit = () => {
    if (!label.trim() || !date) return;
    const id = initial?.id || draftId;
    const a: ExternalAnchor = {
      id, label: label.trim(), type, date, hardness, notes: notes.trim() || undefined,
    };
    if (hardness !== 'informational') {
      if (scope === 'lob') a.domain = domain;
      else if (scope === 'use_cases') a.ucIds = ucIds;
    }
    onSave(a);
  };

  const filteredUcs = USE_CASES
    .filter(uc => !ucFilter.trim() || uc.name.toLowerCase().includes(ucFilter.toLowerCase()))
    .slice(0, 30);

  return (
    <div className="border-t border-navy-700 mt-4 px-5 py-4 bg-navy-900/40">
      <div className="text-xs font-semibold text-heading mb-3">{initial ? 'Edit anchor' : 'New anchor'}</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-[10px] text-navy-400 uppercase tracking-wider">Label</label>
          <input
            className="input-field text-sm w-full mt-0.5"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Rate case filing — Maryland PSC"
            autoFocus
          />
        </div>
        <div>
          <label className="text-[10px] text-navy-400 uppercase tracking-wider">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as AnchorType)}
            className="input-field text-sm w-full mt-0.5"
          >
            {ANCHOR_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-navy-400 uppercase tracking-wider">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input-field text-sm w-full mt-0.5"
          />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-navy-400 uppercase tracking-wider">Hardness</label>
          <select
            value={hardness}
            onChange={(e) => setHardness(e.target.value as AnchorHardness)}
            className="input-field text-sm w-full mt-0.5"
          >
            {HARDNESS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="text-[10px] text-navy-400 mt-0.5">
            {HARDNESS_OPTIONS.find(o => o.value === hardness)?.help}
          </div>
        </div>

        {hardness !== 'informational' && (
          <>
            <div className="col-span-2">
              <label className="text-[10px] text-navy-400 uppercase tracking-wider">Constrains</label>
              <div className="inline-flex rounded border border-navy-600 overflow-hidden mt-0.5">
                <button
                  onClick={() => setScope('lob')}
                  className={clsx(
                    'px-3 py-1 text-xs',
                    scope === 'lob' ? 'bg-electric text-heading' : 'bg-navy-800 text-slate-300 hover:bg-navy-700'
                  )}
                >Whole LOB</button>
                <button
                  onClick={() => setScope('use_cases')}
                  className={clsx(
                    'px-3 py-1 text-xs',
                    scope === 'use_cases' ? 'bg-electric text-heading' : 'bg-navy-800 text-slate-300 hover:bg-navy-700'
                  )}
                >Specific use cases</button>
              </div>
            </div>

            {scope === 'lob' && (
              <div className="col-span-2">
                <select
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="input-field text-sm w-full mt-0.5"
                >
                  {DOMAIN_NAMES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}

            {scope === 'use_cases' && (
              <div className="col-span-2">
                <div className="text-[10px] text-navy-400 mb-1">{ucIds.length} selected</div>
                <input
                  className="input-field text-xs w-full mb-2"
                  value={ucFilter}
                  onChange={(e) => setUcFilter(e.target.value)}
                  placeholder="Filter use cases…"
                />
                <ul className="max-h-48 overflow-y-auto border border-navy-700 rounded">
                  {filteredUcs.map(uc => {
                    const checked = ucIds.includes(uc.id);
                    return (
                      <li key={uc.id} className="px-2 py-1 hover:bg-navy-700/40">
                        <label className="flex items-center gap-2 cursor-pointer text-[11px]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setUcIds(checked ? ucIds.filter(i => i !== uc.id) : [...ucIds, uc.id])}
                            className="w-3.5 h-3.5 accent-electric"
                          />
                          <span className="text-heading truncate">{uc.name}</span>
                          <span className="text-navy-400 text-[9px]">{uc.domain}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="col-span-2">
          <label className="text-[10px] text-navy-400 uppercase tracking-wider">Notes (optional)</label>
          <textarea
            className="input-field text-xs w-full mt-0.5 min-h-[40px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why this date matters for this customer"
          />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={submit}
          disabled={!label.trim() || !date}
          className={clsx(
            'px-3 py-1.5 rounded text-xs font-medium border',
            (!label.trim() || !date)
              ? 'border-navy-600 text-navy-500 cursor-not-allowed'
              : 'bg-electric text-heading border-electric hover:bg-electric-400'
          )}
        >Save anchor</button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded text-xs border border-navy-600 text-slate-300 hover:bg-navy-700"
        >Cancel</button>
      </div>
    </div>
  );
};
