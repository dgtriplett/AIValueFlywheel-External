/**
 * AiInsightsPanel — two LLM-driven add-ons that live on the results dashboard:
 *
 *   1. Proposed Use Cases — given the customer's profile + priorities + data
 *      sources + completed UCs, the LLM proposes 3-5 NEW use cases tailored
 *      specifically to them (not in the catalog). Conversation starters.
 *
 *   2. Data Source Strategy — aggregates dataRequirements across every
 *      recommended UC, dedupes via normalized keys, groups by phase, marks
 *      which the customer already has. An LLM writes a 1-2 paragraph
 *      executive narrative on top. The single artifact a CIO can hand their
 *      data-platform team.
 *
 * Both call backend endpoints that require a saved assessment id. The panel
 * renders lazily: nothing is fetched until the user expands the section, so
 * the dashboard's initial render stays fast.
 */
import React, { useState } from 'react';
import { clsx } from 'clsx';
import {
  Sparkles, Database, ChevronDown, ChevronRight, Loader2, AlertTriangle,
  CheckCircle2, Lightbulb, Layers,
} from 'lucide-react';
import { api } from '../lib/api';

interface AiInsightsPanelProps {
  assessmentId: string | null;
}

interface ProposalsState {
  loading: boolean;
  error: string | null;
  data: Awaited<ReturnType<typeof api.generateProposedUseCases>> | null;
}

interface DataStrategyState {
  loading: boolean;
  error: string | null;
  data: Awaited<ReturnType<typeof api.generateDataStrategy>> | null;
}

export const AiInsightsPanel: React.FC<AiInsightsPanelProps> = ({ assessmentId }) => {
  if (!assessmentId) {
    return (
      <div className="card p-5">
        <div className="text-sm text-navy-300 inline-flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-electric" />
          AI insights become available after you submit the assessment.
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <DataStrategyCard assessmentId={assessmentId} />
      <ProposedUseCasesCard assessmentId={assessmentId} />
    </div>
  );
};

// ─── Proposed Use Cases card ────────────────────────────────────────────────

const ProposedUseCasesCard: React.FC<{ assessmentId: string }> = ({ assessmentId }) => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ProposalsState>({ loading: false, error: null, data: null });

  const load = async () => {
    if (state.loading || state.data) return;
    setState({ loading: true, error: null, data: null });
    try {
      const data = await api.generateProposedUseCases(assessmentId);
      setState({ loading: false, error: null, data });
    } catch (e: any) {
      setState({ loading: false, error: e?.message || 'Failed to generate proposals', data: null });
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  return (
    <div className="card overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-navy-700/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-electric/15 border border-electric/30 flex items-center justify-center">
            <Lightbulb className="w-4 h-4 text-electric" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-heading">AI-Proposed Use Cases (Beta)</h3>
            <p className="text-[11px] text-navy-400 mt-0.5">
              3-5 new use cases tailored specifically to this customer's profile + data + priorities.
              Conversation starters that go beyond the curated catalog.
            </p>
          </div>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-navy-400" /> : <ChevronRight className="w-4 h-4 text-navy-400" />}
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-navy-700">
          {state.loading && (
            <div className="py-8 text-center text-sm text-navy-300 inline-flex items-center justify-center gap-2 w-full">
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating tailored proposals…
            </div>
          )}
          {state.error && (
            <div className="my-4 px-3 py-2 rounded-md bg-lava/10 border border-lava/30 text-sm text-lava-300 inline-flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {state.error}
            </div>
          )}
          {state.data && (
            <div className="space-y-4 pt-4">
              {state.data.rationale && (
                <div className="text-sm text-slate-300 leading-relaxed italic">
                  {state.data.rationale}
                </div>
              )}
              {state.data.proposals.length === 0 ? (
                <div className="text-sm text-navy-300">
                  No proposals returned. Check that <code>LLM_ENDPOINT_NAME</code> is configured in admin settings.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {state.data.proposals.map((p) => (
                    <ProposalCard key={p.id} p={p} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ProposalCard: React.FC<{ p: {
  id: string; name: string; phase: number; domain: string;
  description: string; businessValue: string[]; dataRequirements: string[];
  complexity: number; whyItFits: string; expectedValueMM: number;
} }> = ({ p }) => {
  const phaseColors: Record<number, string> = { 1: '#1E90FF', 2: '#00C896', 3: '#FFB800' };
  const phaseColor = phaseColors[p.phase] || '#94A3B8';
  return (
    <div className="rounded-lg border border-navy-600 bg-navy-800/60 p-4 hover:border-electric/40 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-semibold text-heading leading-tight">{p.name}</h4>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0"
          style={{ backgroundColor: `${phaseColor}20`, color: phaseColor }}
        >
          Phase {p.phase}
        </span>
      </div>
      <div className="flex items-center gap-3 mb-2 text-[10px] text-navy-300">
        <span>{p.domain}</span>
        <span>·</span>
        <span>Complexity {p.complexity}/5</span>
        {p.expectedValueMM > 0 && (
          <>
            <span>·</span>
            <span className="text-emerald-400 font-medium">~${p.expectedValueMM}M/yr</span>
          </>
        )}
      </div>
      <p className="text-xs text-slate-300 leading-relaxed mb-3">{p.description}</p>
      {p.whyItFits && (
        <div className="text-[11px] text-electric-300 mb-2 leading-relaxed">
          <span className="text-navy-400 uppercase tracking-wider text-[9px]">Why it fits </span>
          {p.whyItFits}
        </div>
      )}
      {p.businessValue.length > 0 && (
        <ul className="text-[11px] text-slate-400 space-y-0.5 mb-2">
          {p.businessValue.map((v, i) => (
            <li key={i} className="flex items-start gap-1">
              <span className="text-emerald-400 mt-0.5">•</span>
              <span>{v}</span>
            </li>
          ))}
        </ul>
      )}
      {p.dataRequirements.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {p.dataRequirements.slice(0, 4).map((d, i) => (
            <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-navy-700 text-navy-300">
              {d}
            </span>
          ))}
          {p.dataRequirements.length > 4 && (
            <span className="text-[9px] text-navy-500">+{p.dataRequirements.length - 4} more</span>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Data Source Strategy card ───────────────────────────────────────────────

const DataStrategyCard: React.FC<{ assessmentId: string }> = ({ assessmentId }) => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DataStrategyState>({ loading: false, error: null, data: null });

  const load = async () => {
    if (state.loading || state.data) return;
    setState({ loading: true, error: null, data: null });
    try {
      const data = await api.generateDataStrategy(assessmentId);
      setState({ loading: false, error: null, data });
    } catch (e: any) {
      setState({ loading: false, error: e?.message || 'Failed to load data strategy', data: null });
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  return (
    <div className="card overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-navy-700/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
            <Database className="w-4 h-4 text-cyan-300" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-heading">Data Source Strategy (Beta)</h3>
            <p className="text-[11px] text-navy-400 mt-0.5">
              Every data source the recommended roadmap needs, deduped + phased,
              with an executive narrative on what to ingest first.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {state.data && (
            <div className="text-[10px] text-navy-300 inline-flex items-center gap-2">
              <span className="text-emerald-400">{state.data.alreadyInScope} ready</span>
              <span>·</span>
              <span className="text-warning-200">{state.data.needToIngest} to ingest</span>
            </div>
          )}
          {open ? <ChevronDown className="w-4 h-4 text-navy-400" /> : <ChevronRight className="w-4 h-4 text-navy-400" />}
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-navy-700">
          {state.loading && (
            <div className="py-8 text-center text-sm text-navy-300 inline-flex items-center justify-center gap-2 w-full">
              <Loader2 className="w-4 h-4 animate-spin" />
              Building data strategy…
            </div>
          )}
          {state.error && (
            <div className="my-4 px-3 py-2 rounded-md bg-lava/10 border border-lava/30 text-sm text-lava-300 inline-flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {state.error}
            </div>
          )}
          {state.data && (
            <div className="pt-4 space-y-5">
              {/* Narrative paragraph */}
              {state.data.narrative && (
                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4">
                  <div className="text-[10px] uppercase tracking-wider text-cyan-300 mb-1.5 inline-flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3" /> Ingestion Priorities
                  </div>
                  <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-line">
                    {state.data.narrative}
                  </div>
                </div>
              )}

              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <Stat label="Total data sources" value={state.data.totalSources} color="#94A3B8" />
                <Stat label="Already accessible" value={state.data.alreadyInScope} color="#10B981" />
                <Stat label="To ingest" value={state.data.needToIngest} color="#F59E0B" />
              </div>

              {/* Categorized table */}
              <div className="space-y-4">
                {state.data.categories.map((cat) => (
                  <CategorySection key={cat.name} category={cat} />
                ))}
              </div>

              <div className="text-[10px] text-navy-400 italic flex items-center gap-1.5">
                <Layers className="w-3 h-3" />
                Phase badge = earliest UC that needs this source. Sources already in scope are marked green.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div className="rounded-lg border border-navy-700 bg-navy-800/40 px-3 py-2">
    <div className="text-2xl font-bold" style={{ color }}>{value}</div>
    <div className="text-[10px] text-navy-300 uppercase tracking-wider mt-0.5">{label}</div>
  </div>
);

const CategorySection: React.FC<{ category: {
  name: string;
  sources: Array<{
    label: string; earliestPhase: number;
    ucIds: string[]; ucNames: string[]; alreadyInScope: boolean;
  }>;
} }> = ({ category }) => {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-navy-300 font-semibold mb-2">
        {category.name} <span className="text-navy-500 font-normal">· {category.sources.length}</span>
      </div>
      <div className="space-y-1.5">
        {category.sources.map((src) => (
          <SourceRow key={src.label} src={src} />
        ))}
      </div>
    </div>
  );
};

const SourceRow: React.FC<{ src: {
  label: string; earliestPhase: number;
  ucIds: string[]; ucNames: string[]; alreadyInScope: boolean;
} }> = ({ src }) => {
  const [showUcs, setShowUcs] = useState(false);
  const phaseColors: Record<number, string> = { 1: '#1E90FF', 2: '#00C896', 3: '#FFB800' };
  const phaseColor = phaseColors[src.earliestPhase] || '#94A3B8';
  return (
    <div
      className={clsx(
        'rounded-md border p-3',
        src.alreadyInScope ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-navy-600 bg-navy-800/40'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {src.alreadyInScope ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          ) : (
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: phaseColor }} />
          )}
          <span className="text-sm text-heading truncate">{src.label}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider"
            style={{ backgroundColor: `${phaseColor}25`, color: phaseColor }}
          >
            Phase {src.earliestPhase}
          </span>
          <span className="text-[10px] text-navy-400">
            {src.ucIds.length} UC{src.ucIds.length === 1 ? '' : 's'}
          </span>
          <button
            onClick={() => setShowUcs((v) => !v)}
            className="text-[10px] text-navy-300 hover:text-heading"
          >
            {showUcs ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      {showUcs && (
        <ul className="mt-2 pl-6 space-y-0.5 text-[11px] text-navy-300">
          {src.ucNames.map((n, i) => (
            <li key={i} className="flex items-start gap-1">
              <span className="text-navy-500">→</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
