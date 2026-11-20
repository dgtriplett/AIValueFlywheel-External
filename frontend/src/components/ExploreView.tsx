import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Plus, LayoutGrid } from 'lucide-react';
import { RoadmapView } from './RoadmapView';
import { getUseCaseById } from '../data/useCases';
import type { AssessmentResults, RecommendedUseCase } from '../data/scoring';
import type { BusinessAssumptions } from '../data/businessValue';
import type { CurrencyCode, LocalePrefs } from '../data/locale';
import { api } from '../lib/api';

type PortfolioState = Record<string, { use_case_id: number; in_portfolio: boolean; status: string }>;

const LIVE = new Set(['live', 'value_realized']);
const STATUS_LABEL: Record<string, string> = {
  not_started: 'Not started', scoping: 'Scoping', in_progress: 'In progress',
  live: 'Live', value_realized: 'Value realized',
};

/** Explore: the whole use-case catalog as a dependency map (blast radius), with this
 *  business unit's portfolio highlighted — live use cases green, the rest of its
 *  roadmap blue — and a one-click "Add to portfolio" on any use case. */
export function ExploreView({
  assumptions, onAssumptionsChange, locale, onLocaleChange, fxRates, onOpenOperate,
}: {
  assumptions: BusinessAssumptions;
  onAssumptionsChange: (a: BusinessAssumptions) => void;
  locale: LocalePrefs;
  onLocaleChange: (l: LocalePrefs) => void;
  fxRates: Record<CurrencyCode, number>;
  onOpenOperate: () => void;
}) {
  const [state, setState] = useState<PortfolioState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [accountName, setAccountName] = useState<string | undefined>();

  const [portfolioIds, setPortfolioIds] = useState<number[]>([]);
  const load = useCallback(() => {
    api.operateRoadmap().then((r) => setPortfolioIds(r.use_cases.map((u) => u.id))).catch(() => setPortfolioIds([]));
    api.explorePortfolio()
      .then((r) => { setState(r.use_cases || {}); setErr(null); })
      .catch((e) => { setState({}); setErr(String(e?.message || e)); });
  }, []);
  useEffect(() => {
    load();
    api.session().then((s) => {
      const a = s.accounts.find((x) => x.id === s.active_account_id) || s.accounts[0];
      setAccountName(a?.name);
    }).catch(() => {});
  }, [load]);

  // The map's highlighting reads an assessment-shaped object: "completed" and
  // "recommended". Here they mean "live" and "on this business unit's roadmap".
  const results = useMemo((): AssessmentResults | null => {
    if (!state) return null;
    const inPortfolio = Object.entries(state).filter(([, v]) => v.in_portfolio);
    if (inPortfolio.length === 0) return null;
    const completed = inPortfolio.filter(([, v]) => LIVE.has(v.status)).map(([k]) => k);
    const recommendations: RecommendedUseCase[] = inPortfolio
      .filter(([, v]) => !LIVE.has(v.status))
      .map(([k]) => getUseCaseById(k))
      .filter((uc): uc is NonNullable<typeof uc> => !!uc)
      .map((useCase) => ({ useCase, readinessScore: 0, dependencyScore: 0, priorityScore: 0,
        capabilityScore: 0, complexityScore: 0, reasoning: '' }));
    return {
      currentPhase: 0, phaseName: '', overallScore: 0,
      dimensionScores: {} as AssessmentResults['dimensionScores'],
      completedUseCases: completed, recommendations, peerProfiles: [],
      phaseProgress: 0, domainProgress: [],
    };
  }, [state]);

  const add = async (catalogId: string) => {
    setBusy(catalogId); setErr(null);
    try {
      const r = await api.exploreAdd([catalogId]);
      if (r.unresolved.length) setErr('That use case is not in this workspace\'s catalog yet — an admin can re-run setup to refresh it.');
      load();
    } catch (e: any) {
      setErr(String(e?.message || e).includes('403')
        ? 'You have view-only access to this business unit.'
        : String(e?.message || e));
    } finally { setBusy(null); }
  };

  const onRoadmap = state ? Object.values(state).filter((v) => v.in_portfolio).length : 0;
  // Portfolio use cases that are not in the shipped catalog (created for this roadmap
  // or authored here) have no place on the map; say so rather than look missing.
  const custom = useMemo(() => {
    const onMap = new Set(Object.values(state || {}).map((v) => v.use_case_id));
    return portfolioIds.filter((id) => !onMap.has(id)).length;
  }, [state, portfolioIds]);

  const detailActions = (catalogId: string): React.ReactNode => {
    const s = state?.[catalogId];
    if (!state) return null;
    if (!s) return <span className="text-xs text-navy-400">Not in this workspace's catalog.</span>;
    if (s.in_portfolio) {
      return (
        <>
          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
            <Check className="w-3.5 h-3.5" /> On {accountName ? `${accountName}'s` : 'the'} portfolio · {STATUS_LABEL[s.status] || s.status}
          </span>
          <button onClick={onOpenOperate} className="inline-flex items-center gap-1 text-xs text-info-500 hover:underline">
            <LayoutGrid className="w-3.5 h-3.5" /> Track it in Operate
          </button>
        </>
      );
    }
    return (
      <button onClick={() => add(catalogId)} disabled={busy === catalogId}
        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
        <Plus className="w-3.5 h-3.5" /> {busy === catalogId ? 'Adding…' : `Add to ${accountName || 'this business unit'}'s portfolio`}
      </button>
    );
  };

  const headerActions = (
    <div className="flex items-center gap-3 text-xs">
      {err && <span className="text-rose-500 max-w-xs truncate" title={err}>{err}</span>}
      <span className="text-slate-400">
        {state == null ? 'Loading portfolio…'
          : `${onRoadmap} of ${Object.keys(state).length} catalog use cases on the portfolio`}
        {custom > 0 && <span className="text-slate-500"> · {custom} more created for this roadmap (in Operate, not on this map)</span>}
      </span>
    </div>
  );

  return (
    <RoadmapView
      results={results}
      answers={null}
      title="Explore the use-case catalog"
      headerActions={headerActions}
      detailActions={detailActions}
      customerName={accountName}
      assumptions={assumptions}
      onAssumptionsChange={onAssumptionsChange}
      locale={locale}
      onLocaleChange={onLocaleChange}
      fxRates={fxRates}
    />
  );
}
