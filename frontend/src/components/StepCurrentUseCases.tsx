import React, { useMemo, useState, useEffect } from 'react';
import { clsx } from 'clsx';
import {
  CheckSquare, Square, ChevronDown, ChevronRight, HelpCircle, Cog, Database,
} from 'lucide-react';
import type { CurrentUseCasesAnswers, UtilityType } from '../data/questions';
import { CURRENT_USE_CASE_OPTIONS, useCaseMatchesUtility } from '../data/questions';
import { PHASE_NAMES, PHASE_COLORS, DOMAIN_NAMES, DOMAIN_COLORS } from '../data/useCases';
import { DATA_SOURCES } from '../data/dataSources';
import { Tooltip } from './Tooltip';
import { api, type DataSourceRow } from '../lib/api';
import { useActiveIndustryIds } from '../industries/active';

interface StepCurrentUseCasesProps {
  data: CurrentUseCasesAnswers;
  utilityType: UtilityType | null;
  /** Subset of the active industry's domains the customer actually operates
   *  in. Empty / undefined = no domain filter (back-compat). */
  operationsScope?: string[] | null;
  onChange: (data: CurrentUseCasesAnswers) => void;
}

type Mode = 'use_cases' | 'data_sources';

export const StepCurrentUseCases: React.FC<StepCurrentUseCasesProps> = ({
  data, utilityType, operationsScope, onChange,
}) => {
  const [mode, setMode] = useState<Mode>('use_cases');
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set([1, 2, 3]));
  const activeIndustryIds = useActiveIndustryIds();

  // Scope the checklist to the active industry / blend. Untagged options
  // (legacy P&U seed before multi-industry) keep their old behavior.
  const inIndustry = (industryId: string | undefined) =>
    !industryId || activeIndustryIds.length === 0 || activeIndustryIds.includes(industryId);
  const inOperationsScope = (domain: string) =>
    !operationsScope || operationsScope.length === 0 || operationsScope.includes(domain);

  const visibleOptions = useMemo(
    () => CURRENT_USE_CASE_OPTIONS.filter(o =>
      inIndustry(o.industryId)
      && inOperationsScope(o.domain)
      && useCaseMatchesUtility(o.utilityTypes, utilityType)
    ),
    [utilityType, activeIndustryIds, operationsScope]
  );

  // Canonical 31-source taxonomy from the converged backend (falls back to the
  // bundled list if the endpoint is unreachable, so the wizard still renders).
  const [apiSources, setApiSources] = useState<DataSourceRow[] | null>(null);
  useEffect(() => {
    let live = true;
    api.dataSourcesApi()
      .then((r) => { if (live) setApiSources(r.data_sources); })
      .catch(() => { if (live) setApiSources(null); });
    return () => { live = false; };
  }, []);

  const visibleDataSources = useMemo(
    () => (apiSources
      ? apiSources.map(d => ({ id: d.id, name: d.name, description: d.description || '',
                               category: d.category, utilityTypes: ['all'] as string[], matchTerms: [] as string[] }))
      : DATA_SOURCES.filter(d => useCaseMatchesUtility(d.utilityTypes, utilityType))),
    [utilityType, apiSources]
  );

  const PHASES = useMemo(() => [1, 2, 3].map(phase => ({
    phase, name: PHASE_NAMES[phase], color: PHASE_COLORS[phase],
    domains: DOMAIN_NAMES.map(domain => ({
      domain, color: DOMAIN_COLORS[domain],
      options: visibleOptions.filter(o => o.phase === phase && o.domain === domain),
    })).filter(d => d.options.length > 0),
  })), [visibleOptions]);

  const dataByCategory = useMemo(() => {
    const grouped: Record<string, typeof visibleDataSources> = {};
    for (const ds of visibleDataSources) {
      grouped[ds.category] ||= [] as any;
      grouped[ds.category].push(ds);
    }
    return grouped;
  }, [visibleDataSources]);

  const toggleUseCase = (id: string) => {
    const next = data.selectedUseCases.includes(id)
      ? data.selectedUseCases.filter(uc => uc !== id)
      : [...data.selectedUseCases, id];
    onChange({ ...data, selectedUseCases: next });
  };

  const toggleDataSource = (id: string) => {
    const current = data.selectedDataSources || [];
    const next = current.includes(id) ? current.filter(d => d !== id) : [...current, id];
    onChange({ ...data, selectedDataSources: next });
  };

  const togglePhase = (phase: number) => {
    const next = new Set(expandedPhases);
    if (next.has(phase)) next.delete(phase);
    else next.add(phase);
    setExpandedPhases(next);
  };

  const phaseSelectedCount = (phase: number) =>
    visibleOptions.filter(o => o.phase === phase && data.selectedUseCases.includes(o.id)).length;
  const phaseTotal = (phase: number) =>
    visibleOptions.filter(o => o.phase === phase).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-heading mb-2 flex items-center gap-2">
          What's already in production
          <Tooltip
            placement="bottom"
            content={
              <>
                Two views here: <strong>Use cases</strong> (what you actively run) and{' '}
                <strong>Data sources</strong> (what you have ingested or accessible, even if
                you aren&apos;t fully using it yet). Marking unused-but-available data unlocks
                more next-step recommendations.
              </>
            }
          >
            <HelpCircle className="w-4 h-4 text-navy-400" />
          </Tooltip>
        </h2>
        <p className="text-slate-400">
          Mark every capability your organization has live today and every dataset you have available.
          More accurate input → sharper recommendations.
        </p>
      </div>

      {/* Mode toggle */}
      <div
        role="tablist"
        aria-label="What to capture"
        className="inline-flex rounded-lg bg-navy-900 border border-navy-600 p-1"
      >
        <ModeBtn icon={<Cog className="w-4 h-4" />} label="Use Cases" active={mode === 'use_cases'} onClick={() => setMode('use_cases')} count={data.selectedUseCases.length} />
        <ModeBtn icon={<Database className="w-4 h-4" />} label="Data Sources" active={mode === 'data_sources'} onClick={() => setMode('data_sources')} count={(data.selectedDataSources || []).length} />
      </div>

      {mode === 'use_cases' ? (
        <>
          {PHASES.map(({ phase, name, color, domains }) => (
            <div key={phase} className="card overflow-hidden">
              <button
                onClick={() => togglePhase(phase)}
                className="w-full flex items-center gap-3 p-4 hover:bg-navy-700/50 transition-colors"
              >
                {expandedPhases.has(phase) ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <h3 className="text-base font-semibold text-heading">Phase {phase}: {name}</h3>
                <div className="flex-1" />
                <span className="text-xs text-slate-500 font-medium">
                  {phaseSelectedCount(phase)}/{phaseTotal(phase)} selected
                </span>
              </button>
              {expandedPhases.has(phase) && (
                <div className="px-4 pb-4 space-y-5">
                  {domains.map(({ domain, color: domColor, options }) => {
                    const domSelected = options.filter(o => data.selectedUseCases.includes(o.id)).length;
                    return (
                      <div key={domain}>
                        <div className="flex items-center gap-2 mb-2 pl-1">
                          <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: domColor }} />
                          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: domColor }}>{domain}</span>
                          <div className="flex-1 h-px bg-navy-600/50" />
                          <span className="text-[10px] text-slate-600">{domSelected}/{options.length}</span>
                        </div>
                        <div className="grid grid-cols-1 gap-1.5">
                          {options.map(opt => {
                            const isSelected = data.selectedUseCases.includes(opt.id);
                            return (
                              <button
                                key={opt.id}
                                onClick={() => toggleUseCase(opt.id)}
                                className={clsx(
                                  'flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all duration-150 text-left',
                                  isSelected ? 'border-electric/40 bg-electric/5' : 'border-transparent bg-navy-800/50 hover:bg-navy-700/50'
                                )}
                              >
                                {isSelected ? <CheckSquare className="w-4 h-4 text-electric flex-shrink-0" /> : <Square className="w-4 h-4 text-slate-600 flex-shrink-0" />}
                                <span className={clsx('text-sm leading-tight', isSelected ? 'text-heading font-medium' : 'text-slate-300')}>{opt.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          <div className="text-sm text-slate-500 text-center pt-1">
            {data.selectedUseCases.length} of {visibleOptions.length} use cases selected
            {utilityType && utilityType !== 'electric_gas' && (
              <span className="ml-2 text-navy-400">
                (filtered to {utilityType === 'gas' ? 'gas' :
                  utilityType === 'electric' ? 'electric' :
                  utilityType}-relevant use cases)
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="card p-4 bg-navy-700/40 text-sm text-navy-300">
            <strong className="text-heading">Why this matters:</strong> selecting a dataset here
            says &ldquo;we have or could easily access this data&rdquo; — even if no use case
            currently consumes it. We use it to surface use cases your data already supports
            but you haven&apos;t yet built.
          </div>

          {Object.entries(dataByCategory).map(([category, items]) => {
            const selectedInCat = items.filter(d => (data.selectedDataSources || []).includes(d.id)).length;
            return (
              <div key={category} className="card overflow-hidden">
                <div className="flex items-center gap-3 p-4 border-b border-navy-600">
                  <Database className="w-4 h-4 text-lava" />
                  <h3 className="text-base font-semibold text-heading">{category}</h3>
                  <div className="flex-1" />
                  <span className="text-xs text-slate-500 font-medium">{selectedInCat}/{items.length} selected</span>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {items.map(ds => {
                    const sel = (data.selectedDataSources || []).includes(ds.id);
                    return (
                      <button
                        key={ds.id}
                        onClick={() => toggleDataSource(ds.id)}
                        className={clsx(
                          'flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-all duration-150 text-left',
                          sel ? 'border-lava/40 bg-lava/5' : 'border-transparent bg-navy-800/50 hover:bg-navy-700/50'
                        )}
                      >
                        {sel ? <CheckSquare className="w-4 h-4 text-lava flex-shrink-0 mt-0.5" /> : <Square className="w-4 h-4 text-slate-600 flex-shrink-0 mt-0.5" />}
                        <div>
                          <div className={clsx('text-sm leading-tight', sel ? 'text-heading font-medium' : 'text-slate-300')}>{ds.name}</div>
                          <div className="text-[11px] text-navy-400 mt-0.5">{ds.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="text-sm text-slate-500 text-center pt-1">
            {(data.selectedDataSources || []).length} of {visibleDataSources.length} data sources selected
          </div>
        </>
      )}
    </div>
  );
};

const ModeBtn: React.FC<{
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void; count: number;
}> = ({ icon, label, active, onClick, count }) => (
  <button
    role="tab"
    aria-selected={active}
    onClick={onClick}
    className={clsx(
      'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
      active ? 'bg-lava text-heading' : 'text-navy-300 hover:text-heading'
    )}
  >
    {icon}
    {label}
    {count > 0 && (
      <span className={clsx(
        'text-[10px] rounded-full px-1.5 py-0.5 ml-1',
        active ? 'bg-white/20 text-heading' : 'bg-navy-600 text-navy-300'
      )}>
        {count}
      </span>
    )}
  </button>
);
