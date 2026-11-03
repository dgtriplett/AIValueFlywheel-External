import React, { useEffect, useMemo, useState } from 'react';
import { Zap, Share2, Download, RotateCcw, Check, Copy, Map as MapIcon, CheckCircle2, AlertTriangle, Presentation, Sliders, X, ShieldOff, Sparkles, Users as UsersIcon, Loader2, Calendar, Layers, TrendingUp, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { ASSUMPTION_FIELDS, DEFAULT_ASSUMPTIONS, assumptionFieldsFor, computeUseCaseValue, type BusinessAssumptions } from '../data/businessValue';
import { useAssumptionFields } from '../lib/useAssumptionFields';
import { CURRENCY_META, DEFAULT_LOCALE, localizeUnit, type CurrencyCode, type LocalePrefs, type UnitSystem } from '../data/locale';
import { USE_CASES, getUseCaseById } from '../data/useCases';
import { useActiveIndustry, setActiveIndustryId, setActiveIndustryIds } from '../industries/active';
import { clsx } from 'clsx';
import type { AssessmentResults } from '../data/scoring';
import type { AssessmentAnswers } from '../data/questions';
import { UTILITY_TYPE_OPTIONS, TERRITORY_SIZE_OPTIONS, STRATEGIC_PRIORITY_OPTIONS } from '../data/questions';
import { encodeAssessmentToUrl } from '../data/scoring';
import { PHASE_DESCRIPTIONS } from '../data/useCases';
import { MaturityScoreCard } from './MaturityScoreCard';
import { PersonalizedRoadmap } from './PersonalizedRoadmap';
import { useFeatureFlag } from '../lib/featureFlags';
import {
  buildStrategicRoadmap, compareRoadmaps, capacityToInvestment, investmentToCapacity,
  DEFAULT_CAPACITY_MODEL,
  type Horizon, type StrategicRoadmap, type RoadmapBucket, type RoadmapComparison,
  type CapacityModel, type RoadmapUseCase, type ExternalAnchor,
} from '../data/strategicRoadmap';
import { AnchorManager } from './AnchorManager';
import { OutcomeTracker } from './OutcomeTracker';
import { DOMAIN_COLORS, PHASE_COLORS, DOMAIN_NAMES } from '../data/useCases';
import { UseCaseDetailCard } from './UseCaseDetailCard';
import { ErrorBoundary } from './ErrorBoundary';
import { RoadmapBlastRadius } from './RoadmapBlastRadius';
import { AiInsightsPanel } from './AiInsightsPanel';
import { ExecutiveSummaryTab } from './ExecutiveSummaryTab';
import { DiscardedUseCasesPanel } from './DiscardedUseCasesPanel';
import { RefinementsPanel } from './RefinementsPanel';
import { UseCaseActionMenu } from './UseCaseActionMenu';
import { ScenarioSwitcher } from './ScenarioSwitcher';
import { ScenariosModal } from './ScenariosModal';
import { getValueOverride, countRefinements, activeRefinements } from '../data/refinements';
import { Tooltip } from './Tooltip';
import { HelpCircle } from 'lucide-react';
import type { RecommendedUseCase } from '../data/scoring';
import { Maximize2, X as XIcon, Briefcase, DollarSign as DollarIcon, Rocket, Handshake, Box, FileDown, Anchor as AnchorIcon, ChevronDown } from 'lucide-react';

interface ResultsDashboardProps {
  results: AssessmentResults;
  answers: AssessmentAnswers;
  onRestart: () => void;
  onViewRoadmap: () => void;
  savedAssessmentId?: string | null;
  saveError?: string | null;
  assumptions?: BusinessAssumptions;
  onAssumptionsChange?: (a: BusinessAssumptions) => void;
  onAnswersChange?: (a: AssessmentAnswers) => void;
  locale?: LocalePrefs;
  onLocaleChange?: (l: LocalePrefs) => void;
  fxRates?: Record<CurrencyCode, number>;
}

export const ResultsDashboard: React.FC<ResultsDashboardProps> = ({
  results, answers, onRestart, onViewRoadmap, savedAssessmentId, saveError,
  assumptions: assumptionsProp, onAssumptionsChange, onAnswersChange,
  locale, onLocaleChange, fxRates,
}) => {
  const industry = useActiveIndustry();

  // Sync the module-level active industry to the assessment's saved profile
  // on mount + whenever the profile's industry changes. Without this, the
  // "View Full Roadmap" modal (and any other view that reads from the
  // module-level state instead of `answers.profile`) can leak UCs from
  // non-saved industry packs if the session previously explored a blend.
  // The scoring + strategic-roadmap paths already read from
  // `answers.profile.industryIds` directly so they're unaffected, but the
  // explore-roadmap view follows the module state — keep them in sync.
  // Serialize the deps so a new `industryIds` array on each render doesn't
  // re-fire the effect when the actual values haven't changed.
  const profileIndustryKey = (answers.profile.industryIds || []).join(',') || (answers.profile.industryId || 'pu');
  useEffect(() => {
    const ids = answers.profile.industryIds && answers.profile.industryIds.length > 0
      ? answers.profile.industryIds
      : (answers.profile.industryId ? [answers.profile.industryId] : ['pu']);
    if (ids.length === 1) setActiveIndustryId(ids[0]);
    else setActiveIndustryIds(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileIndustryKey]);

  const [copied, setCopied] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showBlockers, setShowBlockers] = useState(false);
  const [exportingValueFlywheel, setExportingValueFlywheel] = useState(false);
  const [valueFlywheelExportError, setValueFlywheelExportError] = useState<string | null>(null);
  // Tabbed sections — the dashboard kept growing as we added modules. Tabs
  // keep each "page" focused, the assessment summary stays scannable, and
  // future modules drop in as new tabs without bloating the default view.
  // First tab is an exec-grade value summary; the detail-heavy views sit
  // behind it so a CIO doesn't drown on first paint.
  type DashboardTab = 'executive' | 'overview' | 'roadmap' | 'insights';
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('executive');

  // ── Discard / restore fine-tuning ────────────────────────────────────────
  // Discarded UCs live on `answers.refinements.discardedUseCaseIds` so they
  // persist with the saved assessment + flow through every scoring path
  // automatically. The Discarded panel below is the single re-add surface.
  const discardedIds = answers.refinements?.discardedUseCaseIds || [];
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [showRefinements, setShowRefinements] = useState(false);
  const [showScenarios, setShowScenarios] = useState(false);
  const refinementsCount = countRefinements(answers);
  const discardUseCase = (ucId: string) => {
    if (!onAnswersChange) return;
    if (discardedIds.includes(ucId)) return;
    onAnswersChange({
      ...answers,
      refinements: {
        ...(answers.refinements || {}),
        discardedUseCaseIds: [...discardedIds, ucId],
      },
    });
  };
  const restoreUseCase = (ucId: string) => {
    if (!onAnswersChange) return;
    onAnswersChange({
      ...answers,
      refinements: {
        ...(answers.refinements || {}),
        discardedUseCaseIds: discardedIds.filter(id => id !== ucId),
      },
    });
  };
  const restoreAllDiscarded = () => {
    if (!onAnswersChange) return;
    onAnswersChange({
      ...answers,
      refinements: { ...(answers.refinements || {}), discardedUseCaseIds: [] },
    });
  };
  const [localAssumptions, setLocalAssumptions] = useState<BusinessAssumptions>({ ...DEFAULT_ASSUMPTIONS });
  const assumptions = assumptionsProp ?? localAssumptions;
  const setAssumptionField = (k: keyof BusinessAssumptions, v: number) => {
    const next = { ...assumptions, [k]: v };
    if (onAssumptionsChange) onAssumptionsChange(next);
    else setLocalAssumptions(next);
  };
  const resetAssumptions = () => {
    if (onAssumptionsChange) onAssumptionsChange({ ...DEFAULT_ASSUMPTIONS });
    else setLocalAssumptions({ ...DEFAULT_ASSUMPTIONS });
  };

  const handleShare = async () => {
    const url = encodeAssessmentToUrl(answers);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    const text = generateTextSummary(results, answers);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pu-maturity-assessment-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleValueFlywheelExport = async () => {
    if (!savedAssessmentId) return;
    setExportingValueFlywheel(true);
    setValueFlywheelExportError(null);
    try {
      const blob = await api.valueFlywheelRoadmapPackage(savedAssessmentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const customer = (answers.profile.companyName || 'roadmap')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'roadmap';
      a.href = url;
      a.download = `value-flywheel-roadmap-${customer}-${savedAssessmentId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setValueFlywheelExportError(e instanceof Error ? e.message : 'Value Flywheel export failed');
    } finally {
      setExportingValueFlywheel(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-navy-600 px-6 py-4 sticky top-0 z-40 bg-navy/95 backdrop-blur">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-lava flex items-center justify-center">
              <Zap className="w-5 h-5 text-heading" />
            </div>
            <span className="text-lg font-semibold text-heading">Assessment Results</span>
            {savedAssessmentId && (
              <span className="flex items-center gap-1.5 text-xs text-success-300 ml-3 bg-success-600/15 border border-success-600/30 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
              </span>
            )}
            {saveError && !savedAssessmentId && (
              <span
                className="flex items-center gap-1.5 text-xs text-warning-400 ml-3 bg-warning-600/15 border border-warning-600/30 px-2 py-0.5 rounded-full"
                title={saveError}
              >
                <AlertTriangle className="w-3.5 h-3.5" /> Not saved
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onViewRoadmap}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                         bg-lava/10 text-lava border border-lava/30 hover:bg-lava/20 transition-all"
            >
              <MapIcon className="w-4 h-4" />
              View Full Roadmap
            </button>
            <button
              onClick={() => setShowAssumptions(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                         bg-navy-700 text-slate-300 border border-navy-500 hover:border-electric/30 hover:text-heading transition-all"
              title="Tune the financial inputs that drive the value-per-use-case math"
            >
              <Sliders className="w-4 h-4" />
              Assumptions
            </button>
            <button
              onClick={() => setShowBlockers(true)}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all',
                (answers.databricksBlockers?.length || 0) > 0
                  ? 'bg-warning-600/15 text-warning-400 border-warning-600/40'
                  : 'bg-navy-700 text-slate-300 border-navy-500 hover:border-electric/30 hover:text-heading'
              )}
              title="Mark Databricks capabilities that are blocked or limited in your environment"
            >
              <ShieldOff className="w-4 h-4" />
              Blockers
              {(answers.databricksBlockers?.length || 0) > 0 && (
                <span className="ml-1 text-[10px] bg-warning-600/30 text-warning-300 px-1.5 py-0.5 rounded-full">
                  {answers.databricksBlockers!.length}
                </span>
              )}
            </button>
            {savedAssessmentId && (
              <a
                href={api.pptxUrl(savedAssessmentId)}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                           bg-navy-700 text-slate-300 border border-navy-500 hover:border-electric/30 hover:text-heading transition-all"
              >
                <Presentation className="w-4 h-4" />
                PowerPoint
              </a>
            )}
            {savedAssessmentId && (
              <button
                onClick={handleValueFlywheelExport}
                disabled={exportingValueFlywheel}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                           bg-navy-700 text-slate-300 border border-navy-500 hover:border-electric/30 hover:text-heading transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                title="Download the JSON package for Value Flywheel import"
              >
                {exportingValueFlywheel
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <FileDown className="w-4 h-4" />}
                Value Flywheel
              </button>
            )}
            {(onAnswersChange && refinementsCount > 0) && (
              <button
                onClick={() => setShowRefinements(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                           bg-electric/10 text-electric border border-electric/30 hover:bg-electric/20 hover:text-heading transition-all"
                title="View + edit every per-UC refinement applied to this assessment"
              >
                <Sliders className="w-4 h-4" />
                Refinements <span className="bg-electric/20 text-electric-200 px-1.5 rounded text-[10px]">{refinementsCount}</span>
              </button>
            )}
            <button
              onClick={onRestart}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                         bg-navy-700 text-slate-300 border border-navy-500 hover:border-electric/30 hover:text-heading transition-all"
            >
              <RotateCcw className="w-4 h-4" />
              Retake
            </button>
          </div>
        </div>
      </header>

      {/* Phase Summary Banner */}
      <div className="px-6 py-6 border-b border-navy-600">
        <div className="max-w-7xl mx-auto">
          <p className="text-sm text-slate-400 max-w-3xl leading-relaxed">
            {PHASE_DESCRIPTIONS[results.currentPhase]}
          </p>
        </div>
      </div>

      {/* Tab nav — sticky so it stays visible while scrolling each section. */}
      <div className="sticky top-0 z-30 px-6 border-b border-navy-600 bg-navy/95 backdrop-blur">
        <div className="max-w-7xl mx-auto flex items-center gap-1 overflow-x-auto">
          <DashTabButton
            label="Executive Summary"
            active={dashboardTab === 'executive'}
            onClick={() => setDashboardTab('executive')}
          />
          <DashTabButton
            label="Overview"
            active={dashboardTab === 'overview'}
            onClick={() => setDashboardTab('overview')}
          />
          <DashTabButton
            label="Strategic Roadmap"
            active={dashboardTab === 'roadmap'}
            onClick={() => setDashboardTab('roadmap')}
          />
          <DashTabButton
            label="AI Insights"
            active={dashboardTab === 'insights'}
            onClick={() => setDashboardTab('insights')}
            badge="beta"
          />
        </div>
      </div>

      <main className="flex-1 px-6 py-6">
        {valueFlywheelExportError && (
          <div className="max-w-7xl mx-auto mb-4 px-3 py-2 rounded-md bg-lava/10 border border-lava/30 text-xs text-lava-300">
            {valueFlywheelExportError}
          </div>
        )}
        {dashboardTab === 'executive' && (
          <ExecutiveSummaryTab
            results={results}
            answers={answers}
            assumptions={assumptions}
            onJumpToTab={(t) => setDashboardTab(t)}
            onDiscardUseCase={onAnswersChange ? discardUseCase : undefined}
            onShowDiscarded={discardedIds.length > 0 ? () => setShowDiscarded(true) : undefined}
            discardedCount={discardedIds.length}
            onAnswersChange={onAnswersChange}
          />
        )}

        {dashboardTab === 'overview' && (
          <div className="max-w-7xl mx-auto space-y-6">
            <OverviewStorySummary
              results={results}
              answers={answers}
              assumptions={assumptions}
            />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7">
                <ProfileRecapCard answers={answers} results={results} />
              </div>
              <div className="lg:col-span-5">
                <DomainReadinessHeatmap results={results} answers={answers} />
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-4">
                <MaturityScoreCard results={results} />
              </div>
              <div className="lg:col-span-8">
                <PersonalizedRoadmap
                  results={results}
                  answers={answers}
                  onAnswersChange={onAnswersChange}
                  assumptions={assumptions}
                  complexityOverrides={answers.complexityOverrides}
                  valueOverrides={answers.refinements?.valueOverrides}
                  onComplexityChange={onAnswersChange ? (id, next) => {
                    const cur = { ...(answers.complexityOverrides || {}) };
                    if (typeof next === 'number') cur[id] = next;
                    else delete cur[id];
                    onAnswersChange({ ...answers, complexityOverrides: cur });
                  } : undefined}
                  onDiscardUseCase={onAnswersChange ? discardUseCase : undefined}
                  territorySize={answers.profile.territorySize}
                  customerContext={answers.profile.companyName ? {
                    customerName: answers.profile.companyName,
                    utilityType: answers.profile.utilityType,
                    strategicPriorities: answers.profile.strategicPriorities || [],
                    overallScore: results.overallScore,
                    currentPhase: results.currentPhase,
                  } : undefined}
                />
              </div>
            </div>
          </div>
        )}

        {dashboardTab === 'roadmap' && (
          <div className="max-w-7xl mx-auto space-y-6">
            {onAnswersChange && (
              <div className="flex items-center justify-between gap-3 px-1">
                <div className="text-[11px] uppercase tracking-wider text-navy-400">
                  Scenarios let you save, name, and switch between what-if versions of this roadmap.
                </div>
                <ScenarioSwitcher
                  answers={answers}
                  onChange={onAnswersChange}
                  onManage={() => setShowScenarios(true)}
                />
              </div>
            )}
            <StrategicRoadmapPanel
              answers={answers}
              results={results}
              assumptions={assumptions}
              savedAssessmentId={savedAssessmentId ?? null}
              onDiscardUseCase={onAnswersChange ? discardUseCase : undefined}
              onAnswersChange={onAnswersChange}
            />
          </div>
        )}

        {dashboardTab === 'insights' && (
          <div className="max-w-7xl mx-auto space-y-6">
            <ExecSummaryPanel assessmentId={savedAssessmentId ?? null} />
            <AiInsightsPanel assessmentId={savedAssessmentId ?? null} />
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-navy-600 px-6 py-4">
        <div className="max-w-7xl mx-auto text-center text-xs text-slate-600">
          AI Value Flywheel · Powered by Databricks
        </div>
      </footer>

      {showAssumptions && (
        <AssumptionsPanel
          assumptions={assumptions}
          onUpdate={setAssumptionField}
          onReset={resetAssumptions}
          onClose={() => setShowAssumptions(false)}
          utilityType={answers.profile.utilityType}
          locale={locale}
          onLocaleChange={onLocaleChange}
          fxRates={fxRates}
        />
      )}

      {showDiscarded && (
        <DiscardedUseCasesPanel
          discardedIds={discardedIds}
          onRestore={restoreUseCase}
          onRestoreAll={restoreAllDiscarded}
          onClose={() => setShowDiscarded(false)}
        />
      )}

      {showRefinements && onAnswersChange && (
        <RefinementsPanel
          answers={answers}
          onChange={onAnswersChange}
          onClose={() => setShowRefinements(false)}
        />
      )}

      {showScenarios && onAnswersChange && (
        <ScenariosModal
          answers={answers}
          onChange={onAnswersChange}
          onClose={() => setShowScenarios(false)}
        />
      )}

      {showBlockers && (
        <BlockersPanel
          blockers={answers.databricksBlockers || []}
          onChange={(next) => onAnswersChange?.({ ...answers, databricksBlockers: next })}
          onClose={() => setShowBlockers(false)}
        />
      )}
    </div>
  );
};

// ─── Assumptions side panel ──────────────────────────────────────────────────

/** Returns the unique sorted list of databricksPrereqs across the catalog. */
function allDatabricksCapabilities(): string[] {
  const set = new Set<string>();
  for (const uc of USE_CASES) {
    for (const p of uc.databricksPrereqs || []) set.add(p);
  }
  return Array.from(set).sort();
}

const BlockersPanel: React.FC<{
  blockers: string[];
  onChange: (next: string[]) => void;
  onClose: () => void;
}> = ({ blockers, onChange, onClose }) => {
  const all = useMemo(() => allDatabricksCapabilities(), []);
  const set = new Set(blockers);
  // Bucket by header keyword so the list is scannable
  const groups: Record<string, string[]> = {};
  for (const cap of all) {
    let group = 'Other';
    const c = cap.toLowerCase();
    if (c.includes('unity catalog') || c.includes('lakeflow') || c.includes('delta sharing')) group = 'Foundation';
    else if (c.includes('sdp') || c.includes('auto loader') || c.includes('photon')) group = 'Pipelines & runtime';
    else if (c.includes('warehouse')) group = 'BI & SQL';
    else if (c.includes('mlflow') || c.includes('model serving') || c.includes('lakehouse monitoring')) group = 'ML / MLOps';
    else if (c.includes('agent') || c.includes('vector search')) group = 'Agents & GenAI';
    else if (c.includes('lakebase') || c.includes('apps')) group = 'App stack';
    else if (c.includes('geospatial') || c.includes('h3')) group = 'Geospatial';
    (groups[group] ||= []).push(cap);
  }
  const toggle = (cap: string) => {
    const next = new Set(blockers);
    if (next.has(cap)) next.delete(cap);
    else next.add(cap);
    onChange(Array.from(next));
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-md h-full bg-navy-800 border-l border-navy-600 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-navy-800 border-b border-navy-600 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldOff className="w-4 h-4 text-warning-400" />
            <h3 className="text-base font-semibold text-heading">Databricks blockers</h3>
            {blockers.length > 0 && (
              <span className="text-[10px] uppercase tracking-wider bg-warning-600/20 text-warning-300 px-1.5 py-0.5 rounded">
                {blockers.length} blocked
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {blockers.length > 0 && (
              <button
                onClick={() => onChange([])}
                className="text-[11px] px-2 py-1 rounded border border-navy-500 text-navy-300 hover:text-heading"
              >
                <RotateCcw className="w-3 h-3 inline mr-1" /> Clear
              </button>
            )}
            <button onClick={onClose} className="text-navy-400 hover:text-heading p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-3 text-xs text-navy-300 border-b border-navy-600 leading-relaxed">
          Tick any Databricks capability that is unavailable, restricted, or
          gated for this customer (e.g. <em>Lakebase not in their region yet</em>,
          <em> internal change-control on Agent Framework</em>). Each blocker raises the
          effective complexity by +1 on every use case that requires it. Recommendation
          rankings update live.
        </div>

        {Object.entries(groups).map(([group, caps]) => (
          <div key={group} className="px-5 py-4 border-b border-navy-600">
            <h4 className="text-[10px] uppercase tracking-wider text-navy-400 mb-3">{group}</h4>
            <div className="space-y-2">
              {caps.map((cap) => {
                const active = set.has(cap);
                const usedBy = USE_CASES.filter(uc => (uc.databricksPrereqs || []).includes(cap)).length;
                return (
                  <label key={cap} className="flex items-start gap-3 cursor-pointer p-2 rounded hover:bg-navy-700/50">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggle(cap)}
                      className="mt-0.5 accent-warning-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className={clsx('text-xs', active ? 'text-warning-300 font-medium' : 'text-heading')}>
                        {cap}
                      </div>
                      <div className="text-[10px] text-navy-500 mt-0.5">
                        Required by {usedBy} use case{usedBy === 1 ? '' : 's'}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const AssumptionsPanel: React.FC<{
  assumptions: BusinessAssumptions;
  onUpdate: (k: keyof BusinessAssumptions, v: number) => void;
  onReset: () => void;
  onClose: () => void;
  utilityType?: import('../data/questions').UtilityType | null;
  locale?: LocalePrefs;
  onLocaleChange?: (l: LocalePrefs) => void;
  fxRates?: Record<CurrencyCode, number>;
}> = ({ assumptions, onUpdate, onReset, onClose, utilityType, locale, onLocaleChange, fxRates }) => {
  // Filter fields to those relevant for the assessed customer's utility type
  // — drops T&D line miles for nuclear / gen-only, drops customer count for
  // gen-only / nuclear, etc. Also includes admin-added custom fields.
  const allFields = useAssumptionFields();
  const visibleFields = assumptionFieldsFor(utilityType ?? null, allFields);
  const grouped: Record<string, typeof ASSUMPTION_FIELDS> = {};
  for (const f of visibleFields) {
    grouped[f.category] ||= [];
    grouped[f.category].push(f);
  }
  const loc = locale || DEFAULT_LOCALE;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-md h-full bg-navy-800 border-l border-navy-600 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-navy-800 border-b border-navy-600 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-lava" />
            <h3 className="text-base font-semibold text-heading">Assumptions</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onReset}
              className="text-[11px] px-2 py-1 rounded border border-navy-500 text-navy-300 hover:text-heading hover:border-navy-400"
              title="Reset to default values"
            >
              <RotateCcw className="w-3 h-3 inline mr-1" /> Reset
            </button>
            <button onClick={onClose} className="text-navy-400 hover:text-heading p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="px-5 py-3 text-xs text-navy-300 border-b border-navy-600">
          Tune these to match the customer. Use case values recompute live and your
          changes auto-save (1 s debounce).
        </div>

        {onLocaleChange && (
          <div className="px-5 py-4 border-b border-navy-600">
            <h4 className="text-[10px] uppercase tracking-wider text-navy-400 mb-3">Locale</h4>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-navy-300">Currency</label>
                <select
                  value={loc.currency}
                  onChange={(e) => {
                    const code = e.target.value as CurrencyCode;
                    const rate = fxRates?.[code] ?? loc.fxRate;
                    onLocaleChange({ ...loc, currency: code, fxRate: rate });
                  }}
                  className="input-field text-xs w-full mt-1"
                >
                  {(Object.keys(CURRENCY_META) as CurrencyCode[]).map((c) => (
                    <option key={c} value={c}>
                      {CURRENCY_META[c].symbol} {c} — {CURRENCY_META[c].name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-navy-300">Units</label>
                <div className="flex gap-2 mt-1">
                  {(['imperial', 'metric'] as UnitSystem[]).map((u) => (
                    <button
                      key={u}
                      onClick={() => onLocaleChange({ ...loc, units: u })}
                      className={clsx(
                        'flex-1 px-3 py-1.5 rounded-md text-xs border',
                        loc.units === u
                          ? 'bg-electric/10 border-electric/30 text-electric'
                          : 'border-navy-500 text-navy-300 hover:text-heading hover:border-navy-400'
                      )}
                    >
                      {u === 'imperial' ? 'Imperial (mi)' : 'Metric (km)'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-[10px] text-navy-500 leading-relaxed">
                FX rate: 1 USD = {loc.fxRate.toFixed(loc.fxRate >= 50 ? 0 : 2)} {loc.currency}.
                Admins can update rates in Settings → <code>LOCALE_FX_RATES_JSON</code>.
              </div>
            </div>
          </div>
        )}

        {Object.entries(grouped).map(([category, fields]) => (
          <div key={category} className="px-5 py-4 border-b border-navy-600">
            <h4 className="text-[10px] uppercase tracking-wider text-navy-400 mb-3">{category}</h4>
            <div className="space-y-3">
              {fields.map((f) => (
                <div key={f.key}>
                  <label className="flex items-center justify-between text-xs text-navy-300 mb-1">
                    <span>{f.label}</span>
                    <span className="font-mono text-navy-400 text-[11px]">{localizeUnit(f.unit, loc)}</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      value={assumptions[f.key] as number}
                      onChange={(e) => onUpdate(f.key, Number(e.target.value))}
                      className="flex-1 accent-lava"
                    />
                    <input
                      type="number"
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      value={assumptions[f.key] as number}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n)) onUpdate(f.key, n);
                      }}
                      className="input-field font-mono text-right text-xs w-28 py-1"
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-navy-500">
                    <span>{f.min.toLocaleString()}</span>
                    <span>{f.max.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

function generateTextSummary(results: AssessmentResults, answers: AssessmentAnswers): string {
  const lines: string[] = [];
  lines.push('=================================================');
  lines.push('  DATA & AI MATURITY ASSESSMENT RESULTS');
  lines.push('=================================================');
  lines.push('');
  lines.push(`Date: ${new Date().toLocaleDateString()}`);
  lines.push('');
  lines.push('MATURITY SCORE');
  lines.push('-------------------------------------------------');
  lines.push(`Current Phase: ${results.currentPhase} - ${results.phaseName}`);
  lines.push(`Overall Score: ${results.overallScore}/100`);
  lines.push('');
  lines.push('DIMENSION SCORES');
  lines.push('-------------------------------------------------');
  lines.push(`Data Infrastructure:  ${results.dimensionScores.dataInfra}/100`);
  lines.push(`Operational Data:     ${results.dimensionScores.operationalData}/100`);
  lines.push(`Analytics Maturity:   ${results.dimensionScores.analytics}/100`);
  lines.push(`AI/ML Readiness:      ${results.dimensionScores.ai}/100`);
  lines.push(`Governance:           ${results.dimensionScores.governance}/100`);
  lines.push('');
  lines.push('TOP RECOMMENDATIONS');
  lines.push('-------------------------------------------------');
  results.recommendations.slice(0, 5).forEach((rec, i) => {
    lines.push(`${i + 1}. ${rec.useCase.name}`);
    lines.push(`   Phase: ${rec.useCase.phase} | Readiness: ${rec.readinessScore}/100 | Time: ${rec.useCase.timeToValue}`);
    lines.push(`   ${rec.reasoning}`);
    if (rec.useCase.kpiImpact[0]) {
      const kpi = rec.useCase.kpiImpact[0];
      lines.push(`   Key Impact: ${kpi.kpi} ${kpi.delta > 0 ? '+' : ''}${kpi.delta}${kpi.unit}`);
    }
    lines.push('');
  });
  lines.push('=================================================');
  lines.push('Generated by AI Value Flywheel');
  return lines.join('\n');
}

// ── Tab nav button ─────────────────────────────────────────────────────────
const DashTabButton: React.FC<{
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
}> = ({ label, active, onClick, badge }) => (
  <button
    onClick={onClick}
    className={clsx(
      'relative px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap',
      active
        ? 'text-heading border-lava'
        : 'text-slate-400 border-transparent hover:text-heading hover:border-navy-500'
    )}
  >
    {label}
    {badge && (
      <span className="ml-2 text-[9px] uppercase tracking-wider text-electric bg-electric/10 border border-electric/30 px-1.5 py-0.5 rounded">
        {badge}
      </span>
    )}
  </button>
);

// ── Overview "story" summary strip ────────────────────────────────────────
// Lives below the MaturityScoreCard + PersonalizedRoadmap row on the Overview
// tab. With peer benchmarking moved off this page, this card uses the
// reclaimed real estate to deliver a tight three-beat narrative:
//   • What you're aiming at  — total quantified value across the roadmap
//   • Where you stand        — biggest dimension gap (the lowest score)
//   • What to do this quarter — the #1 readiness UC
// Each beat hyperlinks (visually) into the corresponding deep view so the
// reader knows where to click for the detail.
const OverviewStorySummary: React.FC<{
  results: AssessmentResults;
  answers: AssessmentAnswers;
  assumptions: BusinessAssumptions;
}> = ({ results, answers, assumptions }) => {
  const totalValue = React.useMemo(() => {
    let low = 0, high = 0;
    for (const r of results.recommendations) {
      const v = computeUseCaseValue(
        r.useCase.id,
        assumptions,
        getValueOverride(answers, r.useCase.id),
      );
      low += v.annualValueLowMM;
      high += v.annualValueHighMM;
    }
    return { low: Math.round(low), high: Math.round(high) };
  }, [results.recommendations, assumptions, answers]);

  // The dimension with the lowest score — that's the most actionable gap.
  const dims = results.dimensionScores;
  const dimEntries: Array<{ key: keyof typeof dims; label: string; score: number }> = [
    { key: 'dataInfra',         label: 'Data Infrastructure',  score: dims.dataInfra },
    { key: 'operationalData',   label: 'Operational Data',     score: dims.operationalData },
    { key: 'analytics',         label: 'Analytics Maturity',   score: dims.analytics },
    { key: 'ai',                label: 'AI / ML Readiness',    score: dims.ai },
    { key: 'governance',        label: 'Governance',           score: dims.governance },
  ];
  const weakest = dimEntries.reduce((min, d) => d.score < min.score ? d : min, dimEntries[0]);

  const topRec = results.recommendations[0];
  const topRecValue = topRec
    ? computeUseCaseValue(
        topRec.useCase.id,
        assumptions,
        getValueOverride(answers, topRec.useCase.id),
      )
    : null;

  return (
    <div className="rounded-xl border border-navy-700 bg-gradient-to-r from-navy-900/60 via-navy-800/40 to-navy-900/60 p-5">
      <div className="text-[11px] uppercase tracking-wider text-navy-400 mb-3">
        Your story in one row
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-navy-700 bg-navy-900/40 p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarIcon className="w-3.5 h-3.5 text-success-300" />
            <div className="text-[10px] uppercase tracking-wider text-navy-300">What you're aiming at</div>
          </div>
          <div className="text-xl font-bold text-heading font-mono">
            ${totalValue.low}–${totalValue.high}M<span className="text-xs text-navy-400 ml-1 font-normal">/ yr</span>
          </div>
          <div className="text-[11px] text-navy-400 mt-1">
            Quantified annual value across the {results.recommendations.length} recommended use cases.
          </div>
        </div>

        <div className="rounded-lg border border-navy-700 bg-navy-900/40 p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-3.5 h-3.5 text-warning-400" />
            <div className="text-[10px] uppercase tracking-wider text-navy-300">Where you stand</div>
          </div>
          <div className="text-base font-bold text-heading">
            {weakest.label}{' '}
            <span className="font-mono text-warning-400">{weakest.score}</span>
          </div>
          <div className="text-[11px] text-navy-400 mt-1">
            Your lowest dimension — closing this is the foundation for everything that follows.
          </div>
        </div>

        <div className="rounded-lg border border-navy-700 bg-navy-900/40 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Rocket className="w-3.5 h-3.5 text-electric" />
            <div className="text-[10px] uppercase tracking-wider text-navy-300">What to do this quarter</div>
          </div>
          {topRec ? (
            <>
              <div className="text-sm font-semibold text-heading leading-tight">
                {topRec.useCase.name}
              </div>
              <div className="text-[11px] text-navy-400 mt-1 flex items-center gap-2 flex-wrap">
                <span className="text-success-300">${topRecValue?.annualValueLowMM ?? 0}–{topRecValue?.annualValueHighMM ?? 0}M/yr</span>
                <span>·</span>
                <span>{topRec.useCase.timeToValue}</span>
                <span>·</span>
                <span>Readiness {topRec.readinessScore}</span>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-navy-400 italic">
              No recommended UCs remaining — you've completed everything in scope.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Overview "What you told us" recap card ───────────────────────────────
// Compact recap of the customer's profile inputs and current Databricks
// posture. Pairs with the OverviewStorySummary strip + Maturity Score Card
// to give the SA an at-a-glance reminder of what powered the assessment.
const ProfileRecapCard: React.FC<{
  answers: AssessmentAnswers;
  results: AssessmentResults;
}> = ({ answers, results }) => {
  const p = answers.profile;
  const utilityLabel = (() => {
    if (!p.utilityType) return '—';
    const opt = UTILITY_TYPE_OPTIONS.find(o => o.value === p.utilityType);
    return opt?.label || p.utilityType;
  })();
  const sizeLabel = (() => {
    if (!p.territorySize) return '—';
    const opt = TERRITORY_SIZE_OPTIONS.find(o => o.value === p.territorySize);
    return opt?.label || p.territorySize;
  })();
  const priorities = (p.strategicPriorities || [])
    .map(pv => {
      const opt = STRATEGIC_PRIORITY_OPTIONS.find(o => o.value === pv);
      return opt?.label || pv;
    });

  const completedCount = (answers.currentUseCases?.selectedUseCases || []).length;
  const blockerCount = (answers.databricksBlockers || []).length;

  // Quick infrastructure posture summary — derive a 0–5 readiness count from
  // the "yes" answers so the AE can quickly tell if foundations are mostly
  // in place or mostly absent.
  const infraSignals: Array<[string, string | null | undefined]> = [
    ['Cloud platform', answers.infrastructure?.cloudPlatform],
    ['SCADA accessible', answers.infrastructure?.scadaAccessible],
    ['Streaming pipelines', answers.infrastructure?.streamingPipelines],
    ['Unified data catalog', answers.infrastructure?.dataCatalog],
    ['ML in production', answers.infrastructure?.mlModelsInProd],
  ];
  const infraYes = infraSignals.filter(([, v]) => v === 'yes').length;
  const infraPartial = infraSignals.filter(([, v]) => v === 'partial').length;

  return (
    <div className="card p-5 h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">What you told us</h3>
        <span className="text-[10px] text-navy-500">Drives every recommendation on this page</span>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <RecapField label="Organization" value={p.companyName || '—'} />
        <RecapField label="Type" value={utilityLabel} />
        <RecapField label="Size" value={sizeLabel} />
        <RecapField label="Industry pack" value={(p.industryIds && p.industryIds.length > 1)
          ? `Blend (${p.industryIds.length} packs)`
          : (industryLabelFromId(p.industryId || p.industryIds?.[0] || 'pu'))} />
      </div>
      <div className="mb-3">
        <div className="text-[10px] text-navy-400 uppercase tracking-wider mb-1.5">Strategic priorities ({priorities.length})</div>
        {priorities.length === 0 ? (
          <div className="text-[11px] text-navy-500 italic">None declared.</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {priorities.map((label, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-electric/15 text-electric border border-electric/30">
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-navy-700">
        <RecapStat
          label="Already deployed"
          value={completedCount}
          tone={completedCount > 0 ? 'good' : 'neutral'}
          hint="use cases marked complete"
        />
        <RecapStat
          label="Foundations live"
          value={`${infraYes}/5`}
          tone={infraYes >= 4 ? 'good' : infraYes >= 2 ? 'warn' : 'bad'}
          hint={infraPartial > 0 ? `+${infraPartial} partial` : 'cloud · SCADA · streaming · catalog · ML'}
        />
        <RecapStat
          label="Platform blockers"
          value={blockerCount}
          tone={blockerCount === 0 ? 'good' : 'warn'}
          hint={blockerCount === 0 ? 'no blockers logged' : 'see Blockers panel'}
        />
      </div>
      <div className="mt-3 pt-3 border-t border-navy-700 text-[11px] text-navy-300 leading-relaxed">
        With <span className="text-heading font-medium">{results.recommendations.length}</span> applicable
        use cases in scope, the recommendations below are ranked by{' '}
        <span className="text-heading font-medium">readiness</span> — how well your declared foundations
        match each UC's prerequisites — then aligned to the priorities above.
      </div>
    </div>
  );
};

const RecapField: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-[10px] text-navy-400 uppercase tracking-wider mb-0.5">{label}</div>
    <div className="text-xs text-heading font-medium truncate" title={value}>{value}</div>
  </div>
);

const RecapStat: React.FC<{
  label: string;
  value: string | number;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  hint: string;
}> = ({ label, value, tone, hint }) => {
  const valueColor = tone === 'good' ? 'text-success-300'
    : tone === 'warn' ? 'text-warning-400'
    : tone === 'bad' ? 'text-lava-300'
    : 'text-slate-200';
  return (
    <div className="rounded-lg bg-navy-900/40 border border-navy-700 px-2 py-2 text-center">
      <div className={clsx('text-lg font-bold font-mono', valueColor)}>{value}</div>
      <div className="text-[9px] text-navy-400 uppercase tracking-wider mt-0.5">{label}</div>
      <div className="text-[9px] text-navy-500 mt-0.5 leading-tight">{hint}</div>
    </div>
  );
};

function industryLabelFromId(id: string): string {
  const map: Record<string, string> = {
    pu: 'Power & Utilities',
    tl: 'Transportation & Logistics',
    epc: 'Engineering, Procurement & Construction',
    mfg_auto: 'Automotive Mfg',
    mfg_semi: 'Semiconductor Mfg',
    mfg_hightech: 'High-Tech Mfg',
    mfg_industrials: 'Industrial Mfg',
    dist_gen: 'Distributed Generation',
  };
  return map[id] || id;
}

// ── Overview domain readiness heatmap ────────────────────────────────────
// Bins recommended + completed UCs by domain so the SA can see which
// business areas have the most opportunity and which are already mature.
// Each row: domain name, count of completed (✓), count of recommended
// (in pipeline), and a mini bar showing the recommendation density.
const DomainReadinessHeatmap: React.FC<{
  results: AssessmentResults;
  answers: AssessmentAnswers;
}> = ({ results, answers }) => {
  const completedSet = new Set(answers.currentUseCases?.selectedUseCases || []);
  // Aggregate by domain.
  const byDomain = new Map<string, { recommended: number; completed: number; topReadiness: number }>();
  for (const rec of results.recommendations) {
    const d = rec.useCase.domain;
    const cur = byDomain.get(d) || { recommended: 0, completed: 0, topReadiness: 0 };
    cur.recommended += 1;
    if (rec.readinessScore > cur.topReadiness) cur.topReadiness = rec.readinessScore;
    byDomain.set(d, cur);
  }
  for (const ucId of completedSet) {
    const uc = getUseCaseById(ucId);
    if (!uc) continue;
    const cur = byDomain.get(uc.domain) || { recommended: 0, completed: 0, topReadiness: 0 };
    cur.completed += 1;
    byDomain.set(uc.domain, cur);
  }

  const rows = Array.from(byDomain.entries())
    .map(([domain, stats]) => ({ domain, ...stats }))
    .sort((a, b) => (b.recommended + b.completed) - (a.recommended + a.completed));

  const maxTotal = rows.length > 0
    ? Math.max(...rows.map(r => r.recommended + r.completed))
    : 1;

  return (
    <div className="card p-5 h-full">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Domain readiness</h3>
        <span className="text-[10px] text-navy-500">{rows.length} active</span>
      </div>
      <p className="text-[11px] text-navy-400 mb-3">
        Where the catalog has opportunity for you — and where you're already operating.
      </p>
      {rows.length === 0 ? (
        <div className="text-xs text-navy-400 italic">No domain data — recommendations are empty.</div>
      ) : (
        <div className="space-y-1.5">
          {rows.slice(0, 7).map(r => {
            const color = DOMAIN_COLORS[r.domain] || '#618794';
            const total = r.recommended + r.completed;
            const pct = total === 0 ? 0 : Math.round((total / maxTotal) * 100);
            const completedPct = total === 0 ? 0 : Math.round((r.completed / total) * 100);
            return (
              <div key={r.domain} className="group">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-xs text-heading font-medium truncate" title={r.domain}>{r.domain}</span>
                  <span className="text-[10px] text-navy-300 font-mono flex-shrink-0">
                    <span className="text-success-300">{r.completed}</span>
                    <span className="text-navy-500">/</span>
                    <span className="text-electric">{r.recommended}</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-navy-700 overflow-hidden flex">
                  <div
                    className="h-full"
                    style={{ width: `${(pct * completedPct) / 100}%`, backgroundColor: '#10B981' }}
                    title={`${r.completed} completed`}
                  />
                  <div
                    className="h-full"
                    style={{ width: `${pct - (pct * completedPct) / 100}%`, backgroundColor: color, opacity: 0.7 }}
                    title={`${r.recommended} recommended`}
                  />
                </div>
              </div>
            );
          })}
          {rows.length > 7 && (
            <div className="text-[10px] text-navy-500 italic pt-1">+{rows.length - 7} additional domains</div>
          )}
        </div>
      )}
      <div className="mt-3 pt-3 border-t border-navy-700 flex items-center gap-3 text-[10px] text-navy-400">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-success-300" /> completed
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-electric/70" /> recommended (in scope)
        </span>
      </div>
    </div>
  );
};

// ── Experimental: AI Executive Summary panel ──────────────────────────────
const ExecSummaryPanel: React.FC<{ assessmentId: string | null }> = ({ assessmentId }) => {
  const enabled = useFeatureFlag('exp_ai_exec_summary');
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null;

  const generate = async () => {
    if (!assessmentId) {
      setError('Submit the assessment first so we have something to summarize.');
      return;
    }
    setBusy(true); setError(null);
    try {
      const r = await api.generateExecSummary(assessmentId);
      setText(r.summary);
    } catch (e: any) {
      setError(e?.message || 'Generation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5 border-electric/30 bg-electric/5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-electric" />
          <h3 className="text-sm font-semibold text-heading">AI Executive Summary</h3>
          <span className="text-[10px] uppercase tracking-wider bg-electric/20 text-electric px-1.5 py-0.5 rounded">beta</span>
        </div>
        <button
          onClick={generate}
          disabled={busy || !assessmentId}
          className={clsx(
            'px-3 py-1.5 rounded text-xs font-medium border transition-colors',
            busy || !assessmentId
              ? 'border-navy-500 text-navy-500 cursor-not-allowed'
              : 'bg-electric text-heading border-electric hover:bg-electric-400'
          )}
        >
          {busy ? <span className="inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Generating…</span> :
           text ? 'Regenerate' : 'Generate summary'}
        </button>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        One-page executive briefing generated from this assessment using Databricks Foundation Model serving.
        Designed to paste into a deck or an email to leadership.
      </p>
      {error && <div className="text-xs text-lava-300 bg-lava/10 border border-lava/30 px-3 py-2 rounded mb-2">{error}</div>}
      {text && (
        <div className="rounded-lg bg-navy-800/80 border border-navy-600 p-4">
          <pre className="text-sm text-slate-200 whitespace-pre-wrap font-sans leading-relaxed">{text}</pre>
          <button
            onClick={() => navigator.clipboard.writeText(text)}
            className="mt-3 text-[11px] text-electric hover:text-heading inline-flex items-center gap-1"
          >
            <Copy className="w-3 h-3" /> Copy
          </button>
        </div>
      )}
    </div>
  );
};

// ── Experimental: Strategic 3/5-Year Roadmap panel ─────────────────────────
// Promotes the assessment from a tactical "top 5 use cases" output to a
// dependency-respecting multi-year program covering ALL eligible use cases.
//
// Sequencing is deterministic (data/strategicRoadmap.ts). Optional LLM
// narrative wraps prose around the schedule without modifying it.
const StrategicRoadmapPanel: React.FC<{
  answers: AssessmentAnswers;
  results: AssessmentResults;
  assumptions: BusinessAssumptions;
  savedAssessmentId?: string | null;
  /** Called from the X button on each UC card in the bucket grid. The parent
   *  pushes the discard onto `answers.refinements.discardedUseCaseIds`; the
   *  next render of `buildStrategicRoadmap` filters the UC out of the eligible
   *  pool so the schedule reflows automatically. */
  onDiscardUseCase?: (id: string) => void;
  /** When supplied, each UC row in the bucket grid renders the unified
   *  `UseCaseActionMenu` (pin / discard / oop / note / value / bucket pin). */
  onAnswersChange?: (next: AssessmentAnswers) => void;
}> = ({ answers, results, assumptions, savedAssessmentId, onDiscardUseCase, onAnswersChange }) => {
  const enabled = useFeatureFlag('exp_strategic_roadmap');
  const [horizon, setHorizon] = useState<Horizon>(3);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openBucketIdx, setOpenBucketIdx] = useState<number | null>(null);
  const [investmentMPerYear, setInvestmentMPerYear] = useState<number>(0);
  const [showCompare, setShowCompare] = useState(false);
  // "Accelerate delivery" is collapsed by default — the dashboard's primary
  // story is the baseline roadmap. SA opens this section when they want to
  // model SI partners, accelerators, or extra partner capacity.
  const [accelerateExpanded, setAccelerateExpanded] = useState<boolean>(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [detailUcId, setDetailUcId] = useState<string | null>(null);
  const [siUcIds, setSiUcIds] = useState<Set<string>>(new Set());
  // Bulk-apply accelerators — replaces per-UC accelerator selection. When on,
  // every UC with a linked accelerator gets its complexity reduced by the
  // UC's `acceleratorTimeReductionPct` (admin-managed) or 40% default. Lives
  // in component state because it's a roadmap presentation choice, not part
  // of the saved assessment payload.
  const [applyAccelerators, setApplyAccelerators] = useState<boolean>(false);
  // Line of Business drill-down: null = enterprise-wide; "Distribution"/"Generation"/etc.
  // produces a focused per-LOB roadmap for talking to that line's leader.
  const [lobFilter, setLobFilter] = useState<string | null>(null);
  // External anchors (rate cases, NERC deadlines, storm season, vendor EOLs).
  // Local-only state for now — persist via assessment.answers in a follow-up.
  const [anchors, setAnchors] = useState<ExternalAnchor[]>([]);
  const [showAnchors, setShowAnchors] = useState(false);
  const anchorsEnabled = useFeatureFlag('exp_external_anchors');
  // Outcome tracking — frozen commitments + quarterly check-ins.
  const [showOutcomeTracker, setShowOutcomeTracker] = useState(false);
  const outcomeTrackingEnabled = useFeatureFlag('exp_outcome_tracking');
  // POC doc generation moved to the per-UC detail card — see PocDocButton.
  const [showSiPicker, setShowSiPicker] = useState(false);
  const [generatingDeck, setGeneratingDeck] = useState(false);
  const [deckError, setDeckError] = useState<string | null>(null);
  const toggleSi = (id: string) => setSiUcIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Admin-tuned capacity model. Falls back to defaults if endpoint not yet
  // available or values are unset. Loaded once.
  const [capacityModel, setCapacityModel] = useState<CapacityModel>(DEFAULT_CAPACITY_MODEL);
  useEffect(() => {
    if (!enabled) return;
    api.capacityModel().then(r => {
      setCapacityModel({
        baselineCapacityPerHalf: r.baselineCapacityPerHalf || DEFAULT_CAPACITY_MODEL.baselineCapacityPerHalf,
        capacityCostPerPointM: r.capacityCostPerPointM || DEFAULT_CAPACITY_MODEL.capacityCostPerPointM,
      });
    }).catch(() => { /* keep defaults */ });
  }, [enabled]);

  const extraCapacityPerHalf = useMemo(
    () => investmentToCapacity(investmentMPerYear, capacityModel),
    [investmentMPerYear, capacityModel]
  );

  // Count how many in-scope UCs actually have a reusable Databricks asset
  // attached (accelerator or brickbuilder). Shown on the toggle so the user
  // sees whether the toggle would do anything — when 0, there's nothing for
  // it to accelerate and the button explains that.
  const acceleratableCount = useMemo(() => {
    let n = 0;
    for (const uc of USE_CASES) {
      const pa = uc.partnerAssets;
      if (!pa) continue;
      if ((pa.accelerator?.length || 0) > 0 || (pa.brickbuilder?.length || 0) > 0) n += 1;
    }
    return n;
  }, []);

  // Build BOTH baseline (no investment) and invested roadmaps so we can show
  // the marginal-ROI comparison. Both use the same maturity-adjusted baseline.
  const siList = useMemo(() => Array.from(siUcIds), [siUcIds]);
  const baselineRoadmap: StrategicRoadmap = useMemo(
    () => buildStrategicRoadmap(answers, results.currentPhase, horizon, assumptions, {
      capacityModel,
      siDeliveredUseCaseIds: siList,
      lobFilter,
      anchors,
      applyAccelerators,
    }),
    [answers, results.currentPhase, horizon, assumptions, capacityModel, siList, lobFilter, anchors, applyAccelerators]
  );
  const investedRoadmap: StrategicRoadmap = useMemo(
    () => buildStrategicRoadmap(answers, results.currentPhase, horizon, assumptions, {
      capacityModel,
      extraCapacityPerHalf,
      siDeliveredUseCaseIds: siList,
      lobFilter,
      anchors,
      applyAccelerators,
    }),
    [answers, results.currentPhase, horizon, assumptions, capacityModel, extraCapacityPerHalf, siList, lobFilter, anchors, applyAccelerators]
  );
  const comparison: RoadmapComparison = useMemo(
    () => compareRoadmaps(baselineRoadmap, investedRoadmap),
    [baselineRoadmap, investedRoadmap]
  );

  const activeRoadmap = investmentMPerYear > 0 ? investedRoadmap : baselineRoadmap;

  // How many UCs in the active roadmap actually got accelerated. This is the
  // number the user expects to see on the toggle's count — the `acceleratableCount`
  // is "potentially-accelerable in the catalog", but `appliedCount` is "of those,
  // how many ended up in the rendered roadmap." When 0, the toggle has nothing
  // to do for the current scope (e.g. accelerators only exist in P&U and the
  // user's roadmap doesn't include any P&U UCs).
  const appliedAcceleratorCount = useMemo(() => {
    if (!applyAccelerators) return 0;
    return activeRoadmap.buckets.reduce(
      (sum, b) => sum + b.useCases.filter(u => u.acceleratorApplied).length,
      0
    );
  }, [applyAccelerators, activeRoadmap]);

  const detailRec = useMemo((): RecommendedUseCase | null => {
    if (!detailUcId) return null;
    const uc = getUseCaseById(detailUcId);
    if (!uc) return null;
    const rec = results.recommendations.find(r => r.useCase.id === detailUcId);
    if (rec) return rec;
    return {
      useCase: uc, readinessScore: 0, dependencyScore: 0, priorityScore: 0,
      capabilityScore: 0, complexityScore: 0,
      reasoning: 'Scheduled in the strategic roadmap based on dependencies and value.',
    };
  }, [detailUcId, results]);

  if (!enabled) return null;

  const generateNarrative = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.strategicRoadmapNarrative({
        horizonYears: horizon,
        customerName: answers.profile.companyName || 'the customer',
        utilityType: answers.profile.utilityType,
        territorySize: answers.profile.territorySize,
        strategicPriorities: answers.profile.strategicPriorities || [],
        overallScore: results.overallScore,
        currentPhase: results.currentPhase,
        buckets: activeRoadmap.buckets,
        totalAnnualValueLowMM: activeRoadmap.totalAnnualValueLowMM,
        totalAnnualValueHighMM: activeRoadmap.totalAnnualValueHighMM,
        unscheduledUseCaseIds: activeRoadmap.unscheduledUseCaseIds,
        lobFilter,
        externalDependencies: activeRoadmap.externalDependencies,
      });
      setNarrative(r.narrative);
    } catch (e: any) {
      setError(e?.message || 'Generation failed');
    } finally {
      setBusy(false);
    }
  };

  const generateDeck = async () => {
    setGeneratingDeck(true); setDeckError(null);
    try {
      // Capture blast-radius SVG → PNG (data URL) so the deck can embed it.
      // We render an off-screen instance in this panel for exactly this purpose
      // (results page doesn't normally show the blast radius — it lives on the
      // Roadmap view). Serialize with explicit width/height + xmlns so the
      // image-loading path is deterministic, then composite onto a navy canvas
      // so the deck has the right background tone.
      let blastRadiusPng: string | null = null;
      const svgEl = document.querySelector('svg[data-blast-radius="true"]') as SVGSVGElement | null;
      if (svgEl) {
        try {
          const W = 1600, H = 1200;
          const cloned = svgEl.cloneNode(true) as SVGSVGElement;
          cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          cloned.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
          cloned.setAttribute('width', String(W));
          cloned.setAttribute('height', String(H));
          // Ensure the viewBox is set if it isn't
          if (!cloned.getAttribute('viewBox')) {
            cloned.setAttribute('viewBox', `0 0 ${svgEl.clientWidth || W} ${svgEl.clientHeight || H}`);
          }
          const xml = new XMLSerializer().serializeToString(cloned);
          // base64 with unicode-safe encoding
          const svg64 = btoa(unescape(encodeURIComponent(xml)));
          const dataUrl = `data:image/svg+xml;base64,${svg64}`;
          const img = new Image();
          img.crossOrigin = 'anonymous';
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = (e) => reject(e || new Error('image load'));
            img.src = dataUrl;
          });
          const canvas = document.createElement('canvas');
          canvas.width = W; canvas.height = H;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            // Brand navy background so the rendered PNG matches the dark slide
            ctx.fillStyle = '#0B2026';
            ctx.fillRect(0, 0, W, H);
            ctx.drawImage(img, 0, 0, W, H);
            blastRadiusPng = canvas.toDataURL('image/png');
          }
        } catch (err) {
          // Fail gracefully — deck still useful without the image
          console.warn('Blast radius capture failed:', err);
        }
      } else {
        console.warn('Blast radius SVG not found on page');
      }
      const blob = await api.strategicRoadmapDeck({
        horizonYears: horizon,
        customerName: answers.profile.companyName || 'Customer',
        utilityType: answers.profile.utilityType,
        territorySize: answers.profile.territorySize,
        strategicPriorities: answers.profile.strategicPriorities || [],
        overallScore: results.overallScore,
        currentPhase: results.currentPhase,
        phaseName: results.phaseName,
        dimensionScores: results.dimensionScores,
        roadmap: investmentMPerYear > 0 ? investedRoadmap : baselineRoadmap,
        narrative,
        blastRadiusPngBase64: blastRadiusPng,
        siDeliveredUseCaseIds: Array.from(siUcIds),
        lobFilter,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const customerSlug = (answers.profile.companyName || 'customer').replace(/\s+/g, '_');
      const lobSlug = lobFilter ? `-${lobFilter.replace(/\s+/g, '_')}` : '';
      a.download = `strategic-roadmap-${customerSlug}${lobSlug}-${horizon}yr.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setDeckError(e?.message || 'Deck generation failed');
    } finally {
      setGeneratingDeck(false);
    }
  };

  const headerControls = (
    <div className="flex items-center gap-2 flex-wrap">
      {/* LOB drill-down: enterprise OR a single line of business. Surfaces a
          focused view for director-level conversations (e.g. Distribution Ops). */}
      <select
        value={lobFilter || ''}
        onChange={(e) => { setLobFilter(e.target.value || null); setNarrative(null); }}
        className="bg-navy-800 border border-navy-600 text-slate-200 text-xs px-2 py-1 rounded hover:bg-navy-700 cursor-pointer"
        title="Show the full enterprise roadmap or drill into a single line of business"
      >
        <option value="">Enterprise (all LOBs)</option>
        {DOMAIN_NAMES.map(d => (
          <option key={d} value={d}>{d} only</option>
        ))}
      </select>
      <div className="inline-flex rounded border border-navy-600 overflow-hidden">
        {[3, 5].map(h => (
          <button
            key={h}
            onClick={() => { setHorizon(h as Horizon); setNarrative(null); }}
            className={clsx(
              'px-2.5 py-1 text-xs font-medium',
              horizon === h ? 'bg-electric text-heading' : 'bg-navy-800 text-slate-300 hover:bg-navy-700'
            )}
          >{h}-yr</button>
        ))}
      </div>
      {!showFullscreen && (
        <button
          onClick={() => setShowFullscreen(true)}
          className="px-2.5 py-1 rounded border border-navy-600 text-slate-300 hover:bg-navy-700 text-xs inline-flex items-center gap-1.5"
        >
          <Maximize2 className="w-3 h-3" /> Expand
        </button>
      )}
      {/* SI partners + Apply accelerators were in this toolbar previously.
          They now live inside the "Accelerate delivery" panel below
          (collapsed by default) so the baseline customer-delivery view is
          the visual focus. */}
      {outcomeTrackingEnabled && savedAssessmentId && answers.profile.companyName && (
        <button
          onClick={() => setShowOutcomeTracker(true)}
          className="px-2.5 py-1 rounded border border-success-300/40 text-success-300 hover:bg-success-300/10 text-xs inline-flex items-center gap-1.5"
          title="Freeze the current roadmap as a commitment, then log quarterly check-ins to track delivery vs plan"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
          Track outcomes
        </button>
      )}
      {anchorsEnabled && (
        <button
          onClick={() => setShowAnchors(true)}
          className={clsx(
            'px-2.5 py-1 rounded border text-xs inline-flex items-center gap-1.5',
            activeRoadmap.anchorViolations.length > 0
              ? 'border-warning/50 text-warning-200 hover:bg-warning/10'
              : 'border-navy-600 text-slate-300 hover:bg-navy-700'
          )}
          title="Pin real-world dates the roadmap must respect (rate cases, NERC deadlines, storm season, vendor EOL)"
        >
          <AnchorIcon className="w-3 h-3" />
          Anchors
          {anchors.length > 0 && (
            <span className="bg-electric/20 text-electric px-1 rounded text-[10px]">{anchors.length}</span>
          )}
          {activeRoadmap.anchorViolations.length > 0 && (
            <AlertTriangle className="w-3 h-3 text-warning-200" />
          )}
        </button>
      )}
      <button
        onClick={generateDeck}
        disabled={generatingDeck}
        className={clsx(
          'px-3 py-1.5 rounded text-xs font-medium border transition-colors inline-flex items-center gap-1.5',
          generatingDeck ? 'border-navy-500 text-navy-500 cursor-not-allowed'
                         : 'border-success-300/40 text-success-300 hover:bg-success-300/10'
        )}
        title="Download a PowerPoint deck of this roadmap"
      >
        {generatingDeck ? <><Loader2 className="w-3 h-3 animate-spin" /> Building deck…</> :
                         <><FileDown className="w-3 h-3" /> Download deck</>}
      </button>
      <button
        onClick={generateNarrative}
        disabled={busy}
        className={clsx(
          'px-3 py-1.5 rounded text-xs font-medium border transition-colors inline-flex items-center gap-1.5',
          busy ? 'border-navy-500 text-navy-500 cursor-not-allowed'
               : 'bg-electric text-heading border-electric hover:bg-electric-400'
        )}
      >
        {busy ? <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</> :
         narrative ? <><Sparkles className="w-3 h-3" /> Regenerate narrative</> :
                     <><Sparkles className="w-3 h-3" /> Generate narrative</>}
      </button>
    </div>
  );

  const body = (large: boolean) => (
    <>
      {/* Customer baseline throughput readout (in-house only, no SI). */}
      <CapacityDial
        roadmap={activeRoadmap}
        baseline={baselineRoadmap}
        investmentMPerYear={investmentMPerYear}
        onChangeInvestment={(v) => { setInvestmentMPerYear(v); setNarrative(null); }}
        capacityModel={capacityModel}
        comparison={comparison}
        showCompare={showCompare}
        onToggleCompare={() => setShowCompare(s => !s)}
      />

      {/* Acceleration controls — collapsed by default so the baseline view
          is what the SA sees first. Expand to model SI partners, apply
          Databricks accelerators, or buy extra partner capacity. */}
      <AccelerateDeliveryPanel
        expanded={accelerateExpanded}
        onToggle={() => setAccelerateExpanded(v => !v)}
        siCount={siUcIds.size}
        onOpenSiPicker={() => setShowSiPicker(true)}
        applyAccelerators={applyAccelerators}
        onToggleAccelerators={() => acceleratableCount > 0 && setApplyAccelerators(v => !v)}
        acceleratableCount={acceleratableCount}
        appliedAcceleratorCount={appliedAcceleratorCount}
        investmentMPerYear={investmentMPerYear}
        onChangeInvestment={(v) => { setInvestmentMPerYear(v); setNarrative(null); }}
        capacityModel={capacityModel}
        showCompare={showCompare}
        onToggleCompare={() => setShowCompare(s => !s)}
      />

      {error && <div className="text-xs text-lava-300 bg-lava/10 border border-lava/30 px-3 py-2 rounded my-3">{error}</div>}

      {/* Anchor violations banner — visible when at least one constrained anchor
          can't be satisfied with current capacity / dependencies. */}
      {activeRoadmap.anchorViolations.length > 0 && (
        <div className="mt-3 rounded border border-warning/40 bg-warning/5 p-3">
          <div className="text-xs font-semibold text-warning-200 mb-1 inline-flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {activeRoadmap.anchorViolations.length} anchor constraint{activeRoadmap.anchorViolations.length === 1 ? '' : 's'} can't be met
          </div>
          <ul className="space-y-1 text-[11px] text-warning-200/90">
            {activeRoadmap.anchorViolations.slice(0, 3).map((v, i) => (
              <li key={i}>• <strong>{v.anchor.label}</strong> ({v.anchor.date}) — {v.reason}</li>
            ))}
          </ul>
          <div className="text-[10px] text-warning-200/70 mt-1.5 italic">
            Open Anchors → check what's blocking. Options: increase the investment dial,
            mark the affected UCs as SI-delivered, push the date, or accept the slip.
          </div>
        </div>
      )}

      {/* Cumulative-value sparkline (overlays baseline vs invested when investment > 0) */}
      <div className="mt-4">
        <ValueTrajectorySparkline
          buckets={activeRoadmap.buckets}
          baselineBuckets={investmentMPerYear > 0 ? baselineRoadmap.buckets : null}
        />
      </div>

      {/* Bucket grid */}
      <div
        className={clsx('mt-4 grid', large ? 'gap-3' : 'gap-2')}
        style={{ gridTemplateColumns: `repeat(${horizon === 3 ? 6 : 10}, minmax(0, 1fr))` }}
      >
        {activeRoadmap.buckets.map((b, i) => {
          const bucketAnchors = activeRoadmap.resolvedAnchors.filter(r => r.bucketIdx === i);
          const hasViolation = bucketAnchors.some(a => activeRoadmap.anchorViolations.find(v => v.anchor.id === a.anchor.id));
          return (
            <BucketCard
              key={i}
              bucket={b}
              bucketIndex={i}
              bucketCount={activeRoadmap.buckets.length}
              isOpen={openBucketIdx === i}
              onToggle={() => setOpenBucketIdx(openBucketIdx === i ? null : i)}
              totalLow={activeRoadmap.totalAnnualValueLowMM}
              large={large}
              onUseCaseClick={(id) => setDetailUcId(id)}
              onDiscardUseCase={onDiscardUseCase}
              answers={answers}
              onAnswersChange={onAnswersChange}
              anchors={bucketAnchors.map(a => a.anchor)}
              hasViolation={hasViolation}
            />
          );
        })}
      </div>

      {/* Year-band labels */}
      <div
        className="mt-1 grid gap-2 text-[10px] text-navy-400 text-center"
        style={{ gridTemplateColumns: `repeat(${horizon}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: horizon }, (_, y) => (
          <div key={y} className="border-t border-navy-700 pt-1">Year {y + 1}</div>
        ))}
      </div>

      {/* LLM narrative */}
      {narrative && (
        <div className="mt-5 rounded-lg bg-navy-800/80 border border-navy-600 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-electric" />
            <div className="text-xs font-semibold text-heading">Executive narrative</div>
          </div>
          <pre className="text-sm text-slate-200 whitespace-pre-wrap font-sans leading-relaxed">{narrative}</pre>
          <button
            onClick={() => navigator.clipboard.writeText(narrative)}
            className="mt-3 text-[11px] text-electric hover:text-heading inline-flex items-center gap-1"
          >
            <Copy className="w-3 h-3" /> Copy
          </button>
        </div>
      )}
    </>
  );

  return (
    <>
      <div className="card p-5 border-electric/30 bg-electric/5">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="w-4 h-4 text-electric" />
            <h3 className="text-sm font-semibold text-heading">
              {lobFilter
                ? <>{lobFilter} {horizon}-Year Roadmap</>
                : <>Strategic {horizon}-Year Roadmap</>}
            </h3>
            <span className="text-[10px] uppercase tracking-wider bg-electric/20 text-electric px-1.5 py-0.5 rounded">beta</span>
            {lobFilter && (
              <span
                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: `${DOMAIN_COLORS[lobFilter] || '#6B7280'}25`,
                  color: DOMAIN_COLORS[lobFilter] || '#6B7280',
                }}
              >LOB drill-down</span>
            )}
          </div>
          {headerControls}
        </div>
        {lobFilter && (
          <LobScopeBanner roadmap={activeRoadmap} onClear={() => { setLobFilter(null); setNarrative(null); }} />
        )}
        <p className="text-xs text-slate-400 mb-4">
          {lobFilter
            ? <>Drill-down for the <strong className="text-heading">{lobFilter}</strong> line of business — </>
            : <>Sequenced program — </>}
          {activeRoadmap.scheduledCount} of {activeRoadmap.eligibleCount} {lobFilter ? `${lobFilter} ` : ''}use cases scheduled over {horizon} years.
          Total annualized value at horizon end:&nbsp;
          <span className="text-success-300 font-semibold">
            ${activeRoadmap.totalAnnualValueLowMM}M–${activeRoadmap.totalAnnualValueHighMM}M / yr
          </span>
          {activeRoadmap.unscheduledUseCaseIds.length > 0 && (
            <> · <span className="text-slate-500">{activeRoadmap.unscheduledUseCaseIds.length} use cases deferred beyond horizon</span></>
          )}
        </p>
        {body(false)}
      </div>

      {/* Fullscreen explorer */}
      {showFullscreen && (
        <div className="fixed inset-0 z-40 bg-navy-900 overflow-auto">
          <div className="sticky top-0 z-10 bg-navy-900 border-b border-navy-700 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3 flex-wrap">
              <Calendar className="w-5 h-5 text-electric" />
              <h2 className="text-lg font-bold text-heading">
                {lobFilter
                  ? <>{lobFilter} {horizon}-Year Roadmap</>
                  : <>Strategic {horizon}-Year Roadmap</>}
              </h2>
              <span className="text-[10px] uppercase tracking-wider bg-electric/20 text-electric px-1.5 py-0.5 rounded">beta · fullscreen</span>
              {lobFilter && (
                <span
                  className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: `${DOMAIN_COLORS[lobFilter] || '#6B7280'}25`,
                    color: DOMAIN_COLORS[lobFilter] || '#6B7280',
                  }}
                >LOB drill-down</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {headerControls}
              <button
                onClick={() => setShowFullscreen(false)}
                className="p-2 rounded hover:bg-navy-700 text-slate-300"
                title="Close fullscreen"
              ><XIcon className="w-5 h-5" /></button>
            </div>
          </div>
          <div className="px-6 py-6 max-w-[1600px] mx-auto">
            {lobFilter && (
              <LobScopeBanner roadmap={activeRoadmap} onClear={() => { setLobFilter(null); setNarrative(null); }} />
            )}
            <p className="text-sm text-slate-400 mb-5">
              {lobFilter
                ? <>Drill-down for the <strong className="text-heading">{lobFilter}</strong> line of business — </>
                : <>Sequenced program covering </>}
              {activeRoadmap.scheduledCount} of {activeRoadmap.eligibleCount} {lobFilter ? `${lobFilter} ` : ''}use cases over {horizon} years.
              Total annualized value at horizon end:&nbsp;
              <span className="text-success-300 font-semibold">
                ${activeRoadmap.totalAnnualValueLowMM}M–${activeRoadmap.totalAnnualValueHighMM}M / yr
              </span>
            </p>
            {body(true)}
          </div>
        </div>
      )}

      {/* Use case detail panel — reuses the standard one */}
      {detailRec && (
        <ErrorBoundary label="use case details" onClose={() => setDetailUcId(null)}>
        <UseCaseDetailCard
          recommendation={detailRec}
          completedUseCases={results.completedUseCases}
          onClose={() => setDetailUcId(null)}
          assumptions={assumptions}
          valueOverride={getValueOverride(answers, detailRec.useCase.id)}
          territorySize={answers.profile.territorySize}
          customerContext={{
            customerName: answers.profile.companyName || '',
            utilityType: answers.profile.utilityType,
            strategicPriorities: answers.profile.strategicPriorities || [],
            overallScore: results.overallScore,
            currentPhase: results.currentPhase,
            horizonValueLowMM: activeRoadmap.totalAnnualValueLowMM,
            horizonValueHighMM: activeRoadmap.totalAnnualValueHighMM,
          }}
        />
        </ErrorBoundary>
      )}

      {/* Off-screen blast radius — exists only so the deck capture has an SVG
          to serialize. Positioned absolutely off-screen, never visible. */}
      <div
        aria-hidden="true"
        style={{ position: 'fixed', left: -10000, top: -10000, width: 1200, height: 900, pointerEvents: 'none', opacity: 0 }}
      >
        <RoadmapBlastRadius
          results={results}
          onSelect={() => {}}
          onOpenDetail={() => {}}
          selectedUcId={null}
          customerView={answers.profile.utilityType}
        />
      </div>

      {/* External anchors manager */}
      {showAnchors && (
        <AnchorManager
          anchors={anchors}
          onChange={setAnchors}
          onClose={() => setShowAnchors(false)}
          roadmap={activeRoadmap}
        />
      )}

      {/* Outcome tracker — commitments + quarterly check-ins */}
      {showOutcomeTracker && (
        <OutcomeTracker
          customerName={answers.profile.companyName || 'Customer'}
          assessmentId={savedAssessmentId ?? null}
          activeRoadmap={activeRoadmap}
          onClose={() => setShowOutcomeTracker(false)}
        />
      )}


      {/* SI partner picker */}
      {showSiPicker && (
        <SiPartnerPicker
          eligibleUseCaseIds={Array.from(new Set([
            ...investedRoadmap.buckets.flatMap(b => b.useCases.map(u => u.id)),
            ...investedRoadmap.unscheduledUseCaseIds,
          ]))}
          selected={siUcIds}
          onToggle={toggleSi}
          onClose={() => setShowSiPicker(false)}
          siProgramCostTotalM={investedRoadmap.siProgramCostTotalM}
          siCount={investedRoadmap.siDeliveredCount}
        />
      )}

      {deckError && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md bg-lava/90 text-heading text-xs px-4 py-3 rounded shadow-xl">
          Deck error: {deckError}
        </div>
      )}
    </>
  );
};

// SI partner picker — lets the user select use cases that will be delivered
// by SI partners. Surfaces accelerator/brickbuilder availability per UC since
// those make SI engagement cheaper / faster. SI-delivered UCs run on a
// parallel partner workstream and don't consume in-house capacity.
const SiPartnerPicker: React.FC<{
  eligibleUseCaseIds: string[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClose: () => void;
  siProgramCostTotalM: number;
  siCount: number;
}> = ({ eligibleUseCaseIds, selected, onToggle, onClose, siProgramCostTotalM, siCount }) => {
  const [filter, setFilter] = useState<'all' | 'accelerator' | 'brickbuilder' | 'partner'>('all');
  const ucs = useMemo(() => {
    return eligibleUseCaseIds
      .map(id => USE_CASES.find(u => u.id === id))
      .filter(Boolean)
      .map(u => u!) as typeof USE_CASES;
  }, [eligibleUseCaseIds]);

  const filtered = useMemo(() => {
    if (filter === 'all') return ucs;
    return ucs.filter(uc => {
      const pa = uc.partnerAssets || {};
      if (filter === 'accelerator') return (pa.accelerator || []).length > 0;
      if (filter === 'brickbuilder') return (pa.brickbuilder || []).length > 0;
      if (filter === 'partner') return (pa.partner || []).length > 0;
      return true;
    });
  }, [ucs, filter]);

  // Sort: those with assets first, then alphabetical
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aHas = ((a.partnerAssets?.accelerator || []).length + (a.partnerAssets?.brickbuilder || []).length + (a.partnerAssets?.partner || []).length) > 0;
      const bHas = ((b.partnerAssets?.accelerator || []).length + (b.partnerAssets?.brickbuilder || []).length + (b.partnerAssets?.partner || []).length) > 0;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [filtered]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-2xl h-full bg-navy-800 border-l border-navy-600 overflow-y-auto"
           style={{ animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}>
        <div className="sticky top-0 z-10 bg-navy-800 border-b border-navy-600 p-5 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-heading inline-flex items-center gap-2">
              <Handshake className="w-5 h-5 text-electric" /> SI partner delivery
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Select use cases your SI partners will deliver. They run in parallel to your in-house team and don't consume your delivery throughput.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded hover:bg-navy-700 text-slate-300">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-navy-700 bg-navy-900/40">
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="rounded bg-navy-800 px-3 py-2 border border-navy-700">
              <div className="text-navy-400">Selected for SI</div>
              <div className="text-heading font-mono text-base">{siCount}</div>
            </div>
            <div className="rounded bg-navy-800 px-3 py-2 border border-navy-700">
              <div className="text-navy-400">Estimated SI program cost</div>
              <div className="text-electric font-mono text-base">${siProgramCostTotalM.toFixed(2)}M total</div>
            </div>
            <div className="rounded bg-navy-800 px-3 py-2 border border-navy-700">
              <div className="text-navy-400">In horizon UCs eligible</div>
              <div className="text-heading font-mono text-base">{eligibleUseCaseIds.length}</div>
            </div>
          </div>
          <div className="mt-3 flex gap-1.5 flex-wrap">
            {([
              ['all', 'All eligible', null],
              ['brickbuilder', 'Brickbuilder', <Box className="w-3 h-3" key="b" />],
              ['accelerator', 'Accelerator', <Rocket className="w-3 h-3" key="a" />],
              ['partner', 'Partner asset', <Handshake className="w-3 h-3" key="p" />],
            ] as const).map(([k, label, icon]) => (
              <button
                key={k}
                onClick={() => setFilter(k as any)}
                className={clsx(
                  'px-2.5 py-1 rounded border text-[11px] inline-flex items-center gap-1',
                  filter === k ? 'bg-electric text-heading border-electric'
                              : 'bg-navy-800 text-slate-300 border-navy-600 hover:bg-navy-700'
                )}
              >{icon}{label}</button>
            ))}
          </div>
        </div>

        <ul className="divide-y divide-navy-700">
          {sorted.map(uc => {
            const pa = uc.partnerAssets || {};
            const isSel = selected.has(uc.id);
            return (
              <li key={uc.id} className="p-4 hover:bg-navy-700/40">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => onToggle(uc.id)}
                    className="mt-1 w-4 h-4 accent-electric"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-sm font-medium text-heading truncate">{uc.name}</div>
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: `${PHASE_COLORS[uc.phase]}20`, color: PHASE_COLORS[uc.phase] }}
                      >P{uc.phase}</span>
                      <span className="text-[10px] text-navy-400">cx {uc.complexity}/5</span>
                    </div>
                    {(pa.brickbuilder?.length || pa.accelerator?.length || pa.partner?.length) ? (
                      <div className="mt-1 space-y-0.5">
                        {(pa.brickbuilder || []).map((a, i) => (
                          <div key={`b${i}`} className="text-[11px] text-slate-300 inline-flex items-start gap-1.5 mr-3">
                            <Box className="w-3 h-3 text-electric flex-shrink-0 mt-0.5" />
                            <a href={a.url} target="_blank" rel="noreferrer" className="hover:text-electric truncate">{a.title}</a>
                          </div>
                        ))}
                        {(pa.accelerator || []).map((a, i) => (
                          <div key={`a${i}`} className="text-[11px] text-slate-300 inline-flex items-start gap-1.5 mr-3">
                            <Rocket className="w-3 h-3 text-success-300 flex-shrink-0 mt-0.5" />
                            <a href={a.url} target="_blank" rel="noreferrer" className="hover:text-success-300 truncate">{a.title}</a>
                          </div>
                        ))}
                        {(pa.partner || []).map((a, i) => (
                          <div key={`p${i}`} className="text-[11px] text-slate-300 inline-flex items-start gap-1.5 mr-3">
                            <Handshake className="w-3 h-3 text-electric flex-shrink-0 mt-0.5" />
                            <a href={a.url} target="_blank" rel="noreferrer" className="hover:text-electric truncate">{a.title}</a>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-navy-500 italic mt-0.5">No pre-built assets — SI scope from scratch.</div>
                    )}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

// ── Capacity / investment dial ───────────────────────────────────────────
//
// Anchored to the customer's team-maturity-adjusted baseline. Every $X added
// per year buys (X/2)/costPerPoint extra complexity-points of throughput per
// half. Comparison vs. baseline surfaces the marginal ROI of the spend.
const CapacityDial: React.FC<{
  roadmap: StrategicRoadmap;
  baseline: StrategicRoadmap;
  investmentMPerYear: number;
  onChangeInvestment: (v: number) => void;
  capacityModel: CapacityModel;
  comparison: RoadmapComparison;
  showCompare: boolean;
  onToggleCompare: () => void;
}> = ({ roadmap, baseline, investmentMPerYear, onChangeInvestment, capacityModel, comparison, showCompare, onToggleCompare }) => {
  const tm = roadmap.teamMaturity;
  const presets = [0, 0.5, 1, 2, 5, 10];
  const maxCap = capacityToInvestment(15, capacityModel); // top of slider
  return (
    <div className="rounded-lg bg-navy-900/60 border border-navy-700 p-4">
      {/* Baseline-only readout. The "Accelerate delivery" expand below is
          what surfaces SI partners + accelerators + extra-spend dials. */}
      <div className="flex items-start gap-2 mb-1">
        <Briefcase className="w-3.5 h-3.5 text-electric mt-0.5" />
        <div className="text-xs font-semibold text-heading">Customer delivery throughput (baseline, in-house only)</div>
        <Tooltip
          placement="bottom"
          content={
            <div className="space-y-2 text-[11px] leading-relaxed max-w-[420px]">
              <p>
                <strong>cx-pts</strong> = <em>complexity points</em>. Every use case carries a catalog
                complexity rating (1–5). One cx-pt of throughput per half-year ≈ one complexity-1 UC shipped
                end-to-end in 6 months. <strong>Each customer's cost per UC isn't flat</strong> — it depends on the
                team strengths the UC actually requires.
              </p>
              <p>
                <strong>Baseline capacity per half-year</strong> = configured baseline ×
                sponsorship multiplier (sponsorship clears blockers and funds tooling, but doesn't depend
                on which UC you're shipping):
              </p>
              <p className="font-mono text-[10px] text-navy-200">
                {roadmap.configuredBaselineCapacityPerHalf} (config) × {tm.sponsorshipMultiplier} (sponsorship)
                {' = '}<strong className="text-success-300">{roadmap.baselineCapacityPerHalf.toFixed(1)} cx-pts/half</strong>
              </p>
              <p>
                <strong>Per-UC cost is component-aware.</strong> The model splits each UC's effort across
                <strong> data engineering</strong>, <strong>data science</strong>, and <strong>cloud / platform</strong>{' '}
                based on its rubric (data sources, systems, IT/OT, ML maturity, streaming, Databricks capability
                breadth). Each slice is scaled by your team's stated capability in that role:
              </p>
              <p className="font-mono text-[10px] text-navy-200">
                role 5 → ×0.70 · role 4 → ×0.85 · role 3 → ×1.00 (anchor)<br />
                role 2 → ×1.25 · role 1 → ×1.55
              </p>
              <p>
                Example: a heavy-ML UC catalog-rated 3 cx-pts, with your DS team at 2/5, will consume more than
                3 cx-pts of capacity. The roadmap sequences UCs against this realistic cost, so the deliver-by
                dates reflect <em>your</em> team — not a generic team. Hover any UC for the exact adjustment.
              </p>
              <p>
                <strong className="text-electric">SI partner</strong> delivery (configured in “Accelerate
                delivery” below) runs in parallel and is treated as flat throughput — SI teams flex across roles,
                so we don't apply the per-customer adjustment to them.
              </p>
              <p className="text-navy-300 italic">
                Throughput is a delivery-rate floor; real engagements are also bounded by org change-management
                capacity, not just headcount or budget.
              </p>
            </div>
          }
        >
          <HelpCircle className="w-3 h-3 text-navy-400 hover:text-electric cursor-help mt-0.5" />
        </Tooltip>
      </div>
      <div className="text-[11px] text-navy-300 leading-relaxed mb-3">{tm.rationale}</div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
        <div className="rounded bg-navy-800/80 px-2 py-1.5 border border-navy-700">
          <div className="text-navy-400">Configured baseline</div>
          <div className="text-heading font-mono">{roadmap.configuredBaselineCapacityPerHalf} cx-pts/half</div>
        </div>
        <div className="rounded bg-navy-800/80 px-2 py-1.5 border border-navy-700">
          <div className="text-navy-400">Sponsorship</div>
          <div className="text-heading font-mono">×{tm.sponsorshipMultiplier} ({tm.sponsorshipScore}/5)</div>
        </div>
        <div className="rounded bg-success-300/10 px-2 py-1.5 border border-success-300/30">
          <div className="text-navy-400">Effective baseline</div>
          <div className="text-success-300 font-mono font-semibold">
            {roadmap.baselineCapacityPerHalf.toFixed(1)} cx-pts/half
          </div>
        </div>
        <div className="rounded bg-navy-800/80 px-2 py-1.5 border border-navy-700">
          <div className="text-navy-400">Team capability</div>
          <div className="text-heading font-mono text-[10px] leading-tight">
            DE {tm.dataEng}/5 · DS {tm.dataSci}/5 · Cloud {tm.cloudInfra}/5
          </div>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-navy-400 leading-relaxed">
        Per-UC cost adjusts above or below the catalog complexity based on the UC's work mix vs your team
        strengths. Hover any UC card to see its specific adjustment.
      </div>
      {investmentMPerYear > 0 && (
        <div className="mt-3 pt-3 border-t border-navy-700 text-[11px]">
          <span className="text-navy-400">Extra capacity from SI / partner investment:&nbsp;</span>
          <span className="text-electric font-mono font-semibold">
            +{roadmap.extraCapacityPerHalf.toFixed(1)} cx-pts/half
          </span>
          <span className="text-navy-400">&nbsp;· total now {roadmap.totalCapacityPerHalf.toFixed(1)} cx-pts/half</span>
        </div>
      )}

      {/* Comparison: marginal ROI of the investment */}
      {showCompare && investmentMPerYear > 0 && (
        <div className="mt-4 pt-3 border-t border-navy-700">
          <div className="text-[11px] font-semibold text-heading mb-2 inline-flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3 text-success-300" />
            Marginal impact of ${comparison.incrementalInvestmentMPerYear.toFixed(2)}M/yr investment
            (${comparison.incrementalInvestmentTotalM.toFixed(1)}M total over {roadmap.horizonYears} years)
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <KpiTile
              label="Extra UCs delivered"
              value={`+${comparison.incrementalUseCases}`}
              sub={`${baseline.scheduledCount} → ${roadmap.scheduledCount}`}
            />
            <KpiTile
              label="Extra annualized value"
              value={`+$${comparison.incrementalAnnualValueLowMM}M`}
              sub={`up to +$${comparison.incrementalAnnualValueHighMM}M / yr`}
              good
            />
            <KpiTile
              label="Time-to-baseline-value"
              value={comparison.bucketsAheadAtBaselineFinalValue !== null
                ? `${comparison.bucketsAheadAtBaselineFinalValue} half${comparison.bucketsAheadAtBaselineFinalValue === 1 ? '' : 's'} earlier`
                : 'no acceleration'}
              sub={`reach $${baseline.totalAnnualValueLowMM}M sooner`}
              good={(comparison.bucketsAheadAtBaselineFinalValue || 0) > 0}
            />
            <KpiTile
              label="Marginal $ value / $ invested"
              value={`${comparison.marginalValuePerInvestedDollar.toFixed(2)}×`}
              sub="annual run-rate per $ spent over horizon"
              good={comparison.marginalValuePerInvestedDollar >= 1}
            />
          </div>
          <div className="text-[10px] text-navy-400 mt-2 italic">
            Directional model: throughput scales linearly with spend up to dependency-driven ceiling.
            Real engagements are bounded by org change-management capacity, not just $.
          </div>
        </div>
      )}
    </div>
  );
};

// ── Accelerate-delivery panel (collapsible) ───────────────────────────────
// Houses everything that *speeds up* the customer-baseline roadmap: SI
// partner delivery, Databricks accelerators / brickbuilders, and extra
// in-house capacity purchased through partner spend. Collapsed by default
// so the dashboard's primary read is the baseline customer-only roadmap.
const AccelerateDeliveryPanel: React.FC<{
  expanded: boolean;
  onToggle: () => void;
  siCount: number;
  onOpenSiPicker: () => void;
  applyAccelerators: boolean;
  onToggleAccelerators: () => void;
  acceleratableCount: number;
  appliedAcceleratorCount: number;
  investmentMPerYear: number;
  onChangeInvestment: (v: number) => void;
  capacityModel: CapacityModel;
  showCompare: boolean;
  onToggleCompare: () => void;
}> = ({
  expanded, onToggle, siCount, onOpenSiPicker, applyAccelerators, onToggleAccelerators,
  acceleratableCount, appliedAcceleratorCount, investmentMPerYear, onChangeInvestment,
  capacityModel, showCompare, onToggleCompare,
}) => {
  const presets = [0, 0.5, 1, 2, 5, 10];
  const maxCap = capacityToInvestment(15, capacityModel);
  const anyAcceleration = siCount > 0 || applyAccelerators || investmentMPerYear > 0;

  return (
    <div className={clsx(
      'mt-3 rounded-lg border bg-navy-900/40',
      anyAcceleration ? 'border-electric/40' : 'border-navy-700'
    )}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-navy-800/40 transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 text-left">
          <ChevronDown
            className={clsx(
              'w-4 h-4 text-navy-300 transition-transform',
              expanded ? '' : '-rotate-90'
            )}
          />
          <Rocket className={clsx('w-3.5 h-3.5', anyAcceleration ? 'text-electric' : 'text-navy-400')} />
          <span className="text-xs font-semibold text-heading">Accelerate delivery</span>
          <span className="text-[11px] text-navy-300">— SI partners, Databricks accelerators, extra capacity</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {siCount > 0 && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-electric/15 text-electric border border-electric/30">
              SI: {siCount}
            </span>
          )}
          {applyAccelerators && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-success-600/15 text-success-300 border border-success-600/30">
              Accel: {appliedAcceleratorCount}
            </span>
          )}
          {investmentMPerYear > 0 && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-electric/15 text-electric border border-electric/30">
              +${investmentMPerYear.toFixed(1)}M/yr
            </span>
          )}
          {!anyAcceleration && (
            <span className="text-[10px] text-navy-500 italic">none applied</span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-4">
          <div className="text-[11px] text-navy-300 leading-relaxed">
            Customer-team baseline above is unchanged. Anything below this line speeds delivery
            on top of it — SI partners run in parallel (flat throughput, doesn't consume your
            team's cx-pts), Databricks accelerators trim per-UC complexity, and extra partner
            spend buys cx-pts of additional in-house capacity.
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* SI + Accelerators column */}
            <div className="space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-navy-400 mb-1.5">SI partner delivery</div>
                <button
                  onClick={onOpenSiPicker}
                  className="w-full text-left px-3 py-2 rounded border border-navy-600 bg-navy-800/60 hover:bg-navy-700 text-xs inline-flex items-center justify-between gap-1.5"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Handshake className="w-3 h-3 text-electric" />
                    Pick SI-delivered use cases
                  </span>
                  {siCount > 0
                    ? <span className="bg-electric/20 text-electric px-1.5 rounded text-[10px]">{siCount} selected</span>
                    : <span className="text-navy-500 text-[10px]">none selected</span>}
                </button>
                <div className="text-[10px] text-navy-400 mt-1 leading-relaxed">
                  SI-delivered UCs run on a parallel workstream with flat throughput — no team-skill adjustment.
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-navy-400 mb-1.5">Databricks accelerators</div>
                <button
                  onClick={onToggleAccelerators}
                  disabled={acceleratableCount === 0}
                  className={clsx(
                    'w-full text-left px-3 py-2 rounded border text-xs inline-flex items-center justify-between gap-1.5',
                    acceleratableCount === 0
                      ? 'border-navy-700 text-navy-500 cursor-not-allowed opacity-60'
                      : applyAccelerators
                        ? 'border-success-300/50 text-success-300 bg-success-600/10 hover:bg-success-600/20'
                        : 'border-navy-600 text-slate-300 bg-navy-800/60 hover:bg-navy-700'
                  )}
                  title={acceleratableCount === 0
                    ? 'No use cases in this catalog have a Databricks accelerator or brickbuilder attached.'
                    : applyAccelerators
                      ? `${appliedAcceleratorCount} of ${acceleratableCount} acceleratable UCs are in the current roadmap. Click to turn off.`
                      : `Apply every Databricks accelerator + brickbuilder. Reduces complexity / time-in-bucket by ~40%.`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Rocket className="w-3 h-3" />
                    {applyAccelerators
                      ? `Accelerators on · ${appliedAcceleratorCount} applied`
                      : `Apply accelerators (${acceleratableCount} available)`}
                  </span>
                  {applyAccelerators
                    ? <span className="bg-success-300/20 text-success-300 px-1.5 rounded text-[10px]">on</span>
                    : <span className="text-navy-500 text-[10px]">off</span>}
                </button>
                <div className="text-[10px] text-navy-400 mt-1 leading-relaxed">
                  Templates + reusable assets cut implementation time by ~40% on UCs that have a matching asset.
                </div>
              </div>
            </div>

            {/* Investment dial column */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] uppercase tracking-wider text-navy-400">Extra partner capacity</div>
                <button
                  onClick={onToggleCompare}
                  disabled={investmentMPerYear === 0}
                  className={clsx(
                    'text-[10px]',
                    investmentMPerYear === 0
                      ? 'text-navy-500 cursor-not-allowed'
                      : 'text-electric hover:text-heading'
                  )}
                >{showCompare ? 'hide vs baseline' : 'compare vs baseline'}</button>
              </div>
              <input
                type="range"
                min={0}
                max={maxCap}
                step={0.25}
                value={investmentMPerYear}
                onChange={(e) => onChangeInvestment(Number(e.target.value))}
                className="w-full accent-electric"
              />
              <div className="flex items-center justify-between text-[10px] text-navy-400 mt-1">
                <span>$0M</span>
                <span className="text-heading font-mono">${investmentMPerYear.toFixed(2)}M / yr</span>
                <span>${maxCap.toFixed(1)}M</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {presets.map(p => (
                  <button
                    key={p}
                    onClick={() => onChangeInvestment(p)}
                    className={clsx(
                      'text-[10px] px-2 py-0.5 rounded border',
                      Math.abs(investmentMPerYear - p) < 0.01
                        ? 'bg-electric text-heading border-electric'
                        : 'bg-navy-800 text-slate-300 border-navy-600 hover:bg-navy-700'
                    )}
                  >${p}M</button>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-navy-400 leading-relaxed">
                ${capacityModel.capacityCostPerPointM}M of additional annual spend buys 1 cx-pt of extra
                throughput per half-year. Stacks on top of the baseline above.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const KpiTile: React.FC<{ label: string; value: string; sub?: string; good?: boolean }> = ({ label, value, sub, good }) => (
  <div className={clsx(
    'rounded px-3 py-2 border',
    good ? 'bg-success-300/10 border-success-300/30' : 'bg-navy-800/80 border-navy-700'
  )}>
    <div className="text-[10px] text-navy-400 uppercase tracking-wider">{label}</div>
    <div className={clsx('text-lg font-bold font-mono', good ? 'text-success-300' : 'text-heading')}>{value}</div>
    {sub && <div className="text-[10px] text-navy-400 mt-0.5">{sub}</div>}
  </div>
);

// LOB-scope banner — explains what the user's looking at when drilled into a
// single line of business, and surfaces external prerequisites (deps in
// OTHER LOBs) that the enterprise/other teams need to deliver in parallel.
const LobScopeBanner: React.FC<{
  roadmap: StrategicRoadmap;
  onClear: () => void;
}> = ({ roadmap, onClear }) => {
  const ext = roadmap.externalDependencies || [];
  const lob = roadmap.lobFilter;
  if (!lob) return null;
  const lobColor = DOMAIN_COLORS[lob] || '#6B7280';
  return (
    <div
      className="rounded-lg p-3 mb-4 flex items-start gap-3"
      style={{ backgroundColor: `${lobColor}10`, border: `1px solid ${lobColor}40` }}
    >
      <div
        className="w-1 self-stretch rounded"
        style={{ backgroundColor: lobColor }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-heading mb-0.5">
          Showing <span style={{ color: lobColor }}>{lob}</span>-only roadmap
        </div>
        <div className="text-[11px] text-slate-300 leading-relaxed">
          For a director-of-{lob.toLowerCase()} conversation. Use cases from other lines of business are excluded
          from the schedule. Their dependencies are assumed handled by the enterprise team and are listed below.
        </div>
        {ext.length > 0 && (
          <div className="mt-2">
            <div className="text-[10px] uppercase tracking-wider text-navy-400 mb-1">
              External prerequisites — handled by other LOBs / enterprise team ({ext.length})
            </div>
            <ul className="space-y-0.5">
              {ext.slice(0, 6).map(d => (
                <li key={d.id} className="text-[11px] text-slate-300 truncate">
                  <span
                    className="inline-block px-1 mr-1.5 rounded text-[9px]"
                    style={{ backgroundColor: `${DOMAIN_COLORS[d.domain] || '#6B7280'}25`, color: DOMAIN_COLORS[d.domain] || '#6B7280' }}
                  >{d.domain}</span>
                  {d.name}
                  <span className="text-navy-500 ml-1.5">· unlocks {d.dependedOnBy.length} {lob} UC{d.dependedOnBy.length === 1 ? '' : 's'}</span>
                </li>
              ))}
              {ext.length > 6 && (
                <li className="text-[11px] text-navy-400 italic">+ {ext.length - 6} more external prerequisites</li>
              )}
            </ul>
          </div>
        )}
      </div>
      <button
        onClick={onClear}
        className="text-[11px] text-electric hover:text-heading px-2 py-1 rounded border border-electric/40 hover:bg-electric/10 flex-shrink-0"
        title="Return to enterprise-wide roadmap"
      >Back to enterprise</button>
    </div>
  );
};

const BucketCard: React.FC<{
  bucket: RoadmapBucket;
  bucketIndex: number;
  bucketCount: number;
  isOpen: boolean;
  onToggle: () => void;
  totalLow: number;
  large?: boolean;
  onUseCaseClick?: (id: string) => void;
  /** Fine-tuning: discard a UC from this customer's plan. When supplied, an
   *  X-button renders on each UC card. Discarded UCs are filtered out of the
   *  roadmap on the next scoring pass. */
  onDiscardUseCase?: (id: string) => void;
  /** When provided, each UC row in the bucket shows the unified kebab menu
   *  (pin / discard / oop / note / value / bucket pin) instead of the bare X. */
  answers?: AssessmentAnswers;
  onAnswersChange?: (next: AssessmentAnswers) => void;
  anchors?: ExternalAnchor[];
  hasViolation?: boolean;
}> = ({ bucket, bucketIndex, bucketCount, isOpen, onToggle, totalLow, large, onUseCaseClick, onDiscardUseCase, answers, onAnswersChange, anchors = [], hasViolation }) => {
  const cumPct = totalLow > 0 ? Math.min(100, Math.round((bucket.cumulativeValueLowMM / totalLow) * 100)) : 0;
  return (
    <div className="relative">
      {/* Anchor markers — small flag icons hugging the top edge of the bucket */}
      {anchors.length > 0 && (
        <div className="absolute -top-2 left-0 right-0 flex items-center justify-center gap-0.5 z-10 pointer-events-none">
          {anchors.slice(0, 3).map(a => (
            <div
              key={a.id}
              className={clsx(
                'rounded-full w-2.5 h-2.5 border-2 border-navy-900',
                hasViolation ? 'bg-warning' : 'bg-electric'
              )}
              title={`${a.label} — ${a.date}`}
            />
          ))}
          {anchors.length > 3 && <span className="text-[8px] text-electric font-bold">+{anchors.length - 3}</span>}
        </div>
      )}
      <button
        onClick={onToggle}
        className={clsx(
          'w-full text-left rounded border bg-navy-800 hover:bg-navy-700 transition-colors',
          large ? 'p-3' : 'p-2',
          isOpen ? 'border-electric ring-1 ring-electric/40' : (hasViolation ? 'border-warning/60' : 'border-navy-600'),
          bucket.useCases.length === 0 && 'opacity-50',
        )}
        title={bucket.useCases.length ? `${bucket.useCases.length} use case(s)` : 'No use cases scheduled'}
      >
        <div className={clsx('font-bold text-navy-300 uppercase tracking-wider mb-1', large ? 'text-xs' : 'text-[10px]')}>{bucket.label}</div>
        <div className={clsx('font-bold text-heading', large ? 'text-2xl' : 'text-base')}>{bucket.useCases.length}</div>
        <div className={clsx('text-navy-400 leading-tight', large ? 'text-xs' : 'text-[9px]')}>use cases</div>
        <div className={clsx('mt-1 text-success-300 font-mono', large ? 'text-sm' : 'text-[10px]')}>
          ${bucket.cumulativeValueLowMM}M
        </div>
        <div className="mt-1 h-1 rounded bg-navy-700 overflow-hidden">
          <div className="h-full bg-electric" style={{ width: `${cumPct}%` }} />
        </div>
        {bucket.themes.length > 0 && (
          <div className={clsx('mt-1 text-navy-400 truncate', large ? 'text-[11px]' : 'text-[9px]')}>{bucket.themes.join(', ')}</div>
        )}
        {/* Inline UC chips when large — gives at-a-glance visibility without expanding */}
        {large && bucket.useCases.length > 0 && (
          <div className="mt-2 space-y-1">
            {bucket.useCases.slice(0, 4).map(uc => (
              <div key={uc.id} className="text-[10px] text-slate-300 truncate border-l-2 pl-1.5"
                style={{ borderColor: PHASE_COLORS[uc.phase] }}>
                {uc.name}
              </div>
            ))}
            {bucket.useCases.length > 4 && (
              <div className="text-[10px] text-navy-400 italic">+ {bucket.useCases.length - 4} more</div>
            )}
          </div>
        )}
      </button>

      {isOpen && bucket.useCases.length > 0 && (
        <div className={clsx(
          'absolute z-30 mt-1 left-0 rounded-lg border border-electric/40 bg-navy-900 shadow-xl',
          large ? 'p-4 min-w-[420px] max-w-[520px]' : 'p-3 min-w-[260px] right-0',
        )}>
          <div className="flex items-center justify-between mb-2">
            <div className={clsx('font-semibold text-heading', large ? 'text-sm' : 'text-xs')}>{bucket.label}</div>
            <div className="text-[10px] text-success-300 font-mono">
              cumulative ${bucket.cumulativeValueLowMM}M–${bucket.cumulativeValueHighMM}M / yr
            </div>
          </div>
          <ul className={clsx('space-y-1.5 overflow-y-auto', large ? 'max-h-[60vh]' : 'max-h-72')}>
            {bucket.useCases.map(uc => {
              const refs = answers ? activeRefinements(answers) : null;
              const isPinned = refs ? (refs.pinnedUseCaseIds || []).includes(uc.id) : false;
              const hasNote = refs ? !!(refs.notes || {})[uc.id] : false;
              const hasValueOv = refs ? !!(refs.valueOverrides || {})[uc.id] : false;
              const hasBucketPin = refs ? (refs.bucketPins || {})[uc.id] === bucketIndex : false;
              const hasMenuOrX = (answers && onAnswersChange) || !!onDiscardUseCase;
              return (
              <li key={uc.id} className="group relative">
                <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5">
                  {isPinned && (
                    <span className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded bg-electric/15 text-electric border border-electric/30" title="Pinned to top">P</span>
                  )}
                  {hasBucketPin && (
                    <span className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30" title={`Bucket-pinned to ${bucket.label}`}>B</span>
                  )}
                  {hasNote && (
                    <span className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30" title="Has note">N</span>
                  )}
                  {hasValueOv && (
                    <span className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" title="Value override">$</span>
                  )}
                  {answers && onAnswersChange ? (
                    <UseCaseActionMenu
                      ucId={uc.id}
                      answers={answers}
                      onChange={onAnswersChange}
                      bucketCount={bucketCount}
                      align="right"
                      triggerClassName="opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  ) : onDiscardUseCase ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDiscardUseCase(uc.id); }}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 text-navy-400 hover:text-lava hover:bg-lava/10 transition-opacity"
                      title="Discard"
                      aria-label="Discard use case"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  ) : null}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onUseCaseClick?.(uc.id); }}
                  className={clsx(
                    'w-full text-left border-l-2 pl-2 py-1 rounded hover:bg-navy-800 transition-colors',
                    hasMenuOrX ? 'pr-7' : '',
                    large ? 'text-xs pr-2' : 'text-[11px]'
                  )}
                  style={{ borderColor: PHASE_COLORS[uc.phase] }}
                  title="Open full use case detail"
                >
                  <div className="font-medium text-heading leading-tight inline-flex items-center gap-1.5">
                    {uc.name}
                    {uc.isSiDelivered && (
                      <Handshake className="w-3 h-3 text-electric flex-shrink-0" aria-label="SI-delivered" />
                    )}
                    {uc.hasBrickbuilder && (
                      <Box className="w-3 h-3 text-electric flex-shrink-0" aria-label="Brickbuilder available" />
                    )}
                    {!uc.hasBrickbuilder && uc.hasAccelerator && (
                      <Rocket className="w-3 h-3 text-success-300 flex-shrink-0" aria-label="Accelerator available" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span
                      className={clsx('px-1 py-px rounded', large ? 'text-[10px]' : 'text-[9px]')}
                      style={{ backgroundColor: `${PHASE_COLORS[uc.phase]}20`, color: PHASE_COLORS[uc.phase] }}
                    >P{uc.phase}</span>
                    <span
                      className={clsx('px-1 py-px rounded', large ? 'text-[10px]' : 'text-[9px]')}
                      style={{ backgroundColor: `${DOMAIN_COLORS[uc.domain] || '#6B7280'}15`, color: DOMAIN_COLORS[uc.domain] || '#6B7280' }}
                    >{uc.domain}</span>
                    <span className={clsx('text-success-300 font-mono', large ? 'text-[10px]' : 'text-[9px]')}>
                      ${uc.annualValueLowMM}M–${uc.annualValueHighMM}M/yr
                    </span>
                    <span
                      className={clsx('text-navy-400', large ? 'text-[10px]' : 'text-[9px]')}
                      title={uc.isSiDelivered
                        ? `Catalog complexity ${uc.complexity}/5. SI-delivered → flat throughput, no team-skill adjustment.`
                        : `Catalog complexity ${uc.complexity}/5 → ${uc.customerEffortPoints.toFixed(2)} cx-pts of in-house effort. ${uc.effortAdjustmentReason}`}
                    >
                      cx {uc.acceleratorApplied
                        ? <><s className="text-navy-500">{uc.baseComplexity}</s> {uc.complexity}</>
                        : <>{uc.complexity}</>}/5
                      {!uc.isSiDelivered && uc.customerEffortPoints !== uc.complexity && (
                        <span className={clsx(
                          'ml-1 font-mono',
                          uc.customerEffortPoints > uc.complexity ? 'text-warning-400' : 'text-success-300'
                        )}>
                          ({uc.customerEffortPoints.toFixed(1)} eff)
                        </span>
                      )}
                    </span>
                    <span className={clsx('text-navy-400', large ? 'text-[10px]' : 'text-[9px]')}>{uc.timeToValue}</span>
                    {uc.acceleratorApplied && (
                      <span
                        className={clsx('font-medium px-1.5 py-0.5 rounded bg-success-600/15 text-success-300 border border-success-600/30 inline-flex items-center gap-1', large ? 'text-[10px]' : 'text-[9px]')}
                        title={`Accelerated — complexity reduced from ${uc.baseComplexity} to ${uc.complexity} because a Databricks accelerator or brickbuilder is available.`}
                      >
                        <Rocket className="w-2.5 h-2.5" />
                        Accelerated
                      </span>
                    )}
                    {uc.isSiDelivered && (
                      <span className={clsx('text-electric font-mono px-1 rounded bg-electric/10 border border-electric/30', large ? 'text-[10px]' : 'text-[9px]')}>
                        SI · ${uc.siCostMM}M
                      </span>
                    )}
                  </div>
                  <div className={clsx('text-navy-400 mt-0.5', large ? 'text-[11px]' : 'text-[10px]')}>{uc.reason}</div>
                  {large && <div className="mt-1 text-[10px] text-electric">→ open full detail</div>}
                </button>
              </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

const ValueTrajectorySparkline: React.FC<{
  buckets: RoadmapBucket[];
  baselineBuckets?: RoadmapBucket[] | null;
}> = ({ buckets, baselineBuckets }) => {
  const w = 600;
  const h = 80;
  const allMax = Math.max(
    ...buckets.map(b => b.cumulativeValueHighMM),
    ...(baselineBuckets || []).map(b => b.cumulativeValueHighMM),
    1,
  );
  const stepX = buckets.length > 1 ? w / (buckets.length - 1) : 0;
  const toPoints = (bs: RoadmapBucket[], key: 'cumulativeValueLowMM' | 'cumulativeValueHighMM') =>
    bs.map((b, i) => `${i * stepX},${h - (b[key] / allMax) * h}`).join(' ');
  const pointsHigh = toPoints(buckets, 'cumulativeValueHighMM');
  const pointsLow = toPoints(buckets, 'cumulativeValueLowMM');
  const baselineHigh = baselineBuckets ? toPoints(baselineBuckets, 'cumulativeValueHighMM') : '';
  const finalLow = buckets[buckets.length - 1]?.cumulativeValueLowMM ?? 0;
  const finalHigh = buckets[buckets.length - 1]?.cumulativeValueHighMM ?? 0;
  const baselineFinalLow = baselineBuckets ? baselineBuckets[baselineBuckets.length - 1].cumulativeValueLowMM : null;
  return (
    <div className="rounded bg-navy-900/40 border border-navy-700 p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] font-medium text-slate-300 inline-flex items-center gap-1">
          <TrendingUp className="w-3 h-3 text-electric" /> Cumulative annualized value
          {baselineBuckets && (
            <span className="ml-2 text-[10px] text-navy-400">
              <span className="inline-block w-2 h-2 rounded-full bg-electric mr-1 align-middle" /> with investment ·
              <span className="inline-block w-2 h-2 rounded-full bg-navy-400 ml-2 mr-1 align-middle" /> baseline
            </span>
          )}
        </div>
        <div className="text-[10px] text-navy-400">
          ${finalLow}M–${finalHigh}M
          {baselineFinalLow !== null && (
            <> · baseline ${baselineFinalLow}M</>
          )}
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-16">
        {/* Active (with-investment when slider > 0, otherwise baseline) — drawn
            with the SAME hue as the `bg-electric` legend dot (lava) so users
            don't have to mentally remap colors between the legend and lines. */}
        <polyline points={`0,${h} ${pointsHigh} ${(buckets.length - 1) * stepX},${h}`} fill="rgba(255,54,33,0.14)" stroke="none" />
        <polyline points={pointsHigh} fill="none" stroke="#FF3621" strokeWidth={2} />
        <polyline points={pointsLow} fill="none" stroke="#FF3621" strokeOpacity={0.55} strokeWidth={1} strokeDasharray="3 3" />
        {baselineBuckets && (
          <polyline points={baselineHigh} fill="none" stroke="#94A3B8" strokeWidth={1.25} strokeDasharray="4 3" />
        )}
      </svg>
    </div>
  );
};
