import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { LandingPage } from './components/LandingPage';
import { AssessmentWizard } from './components/AssessmentWizard';
import { ConsistencyCheckModal, type ConsistencyIssue } from './components/ConsistencyCheckModal';
import { useFeatureFlag } from './lib/featureFlags';
import { ResultsDashboard } from './components/ResultsDashboard';
import { AccountBar, type Mode } from './components/AccountBar';
import { OperateView } from './components/OperateView';
import { AdminView } from './components/AdminView';
import { CompareView } from './components/CompareView';
import type { Session } from './lib/api';

// RoadmapView is large and route-bound — split it out of the initial bundle.
const RoadmapView = lazy(() =>
  import('./components/RoadmapView').then(m => ({ default: m.RoadmapView }))
);
import { INITIAL_ANSWERS, normalizeProfileFromAccount } from './data/questions';
import type { AssessmentAnswers } from './data/questions';
import { assessMaturity, decodeAssessmentFromUrl } from './data/scoring';
import type { AssessmentResults } from './data/scoring';
import { DEFAULT_ASSUMPTIONS, setCustomAssumptionFields, buildDefaultAssumptions, type BusinessAssumptions } from './data/businessValue';
import { setIndustries, setActiveIndustry, getActiveIndustry } from './industries/active';
import { setBlendPresets } from './industries/presets';
import { DEFAULT_FX_RATES, DEFAULT_LOCALE, parseFxRates, type CurrencyCode, type LocalePrefs } from './data/locale';
import { api, type CurrentUser, type DraftRow, type AssessmentListRow } from './lib/api';

type AppView = 'landing' | 'assessment' | 'results' | 'roadmap' | 'admin' | 'compare';

/** New uuid-ish id for drafts (avoids extra deps). */
function newId(): string {
  if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) return (crypto as any).randomUUID();
  return 'draft_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function App() {
  const [view, setView] = useState<AppView>('landing');
  // Assess vs Operate is an in-shell mode (not a navigation away), so the shared
  // AccountBar stays put and the user can flip both ways. Persisted so it survives
  // the reload an account switch triggers.
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const m = localStorage.getItem('gc.mode') as Mode | null;
      return m === 'operate' || m === 'admin' ? m : 'assess';
    }
    catch { return 'assess'; }
  });
  const setModePersist = useCallback((m: Mode) => {
    setMode(m);
    try { localStorage.setItem('gc.mode', m); } catch { /* private mode */ }
  }, []);
  const [session, setSession] = useState<Session | null>(null);
  const activeAccount = session?.accounts.find((a) => a.id === session.active_account_id) || session?.accounts[0];
  const [answers, setAnswers] = useState<AssessmentAnswers>({ ...INITIAL_ANSWERS });
  const [results, setResults] = useState<AssessmentResults | null>(null);
  const [user, setUser] = useState<CurrentUser>({ email: null, name: null, isAdmin: false });
  const [savedAssessmentId, setSavedAssessmentId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Draft-tracking state — assigned when an assessment is started, cleared on submit.
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftStep, setDraftStep] = useState<number>(0);
  const draftTimer = useRef<number | null>(null);

  // Pre-submit consistency check (beta). When the flag is on and the user
  // hits Submit, we run an LLM audit BEFORE saving and show flagged issues.
  const consistencyCheckEnabled = useFeatureFlag('exp_ai_consistency_check');
  const [showConsistencyModal, setShowConsistencyModal] = useState(false);
  const [consistencyIssues, setConsistencyIssues] = useState<ConsistencyIssue[] | null>(null);
  const [consistencyLoading, setConsistencyLoading] = useState(false);

  // Lifted recent-work state. Lives at the App level so navigating away from
  // the landing page and returning shows instant cached data, instead of
  // unmounting LandingPage and re-fetching against the warehouse on every
  // remount (which was a 10-15s cold-start hit on return).
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [myAssessmentsList, setMyAssessmentsList] = useState<AssessmentListRow[] | null>(null);
  const [recentWorkError, setRecentWorkError] = useState<string | null>(null);

  const reloadMyWork = useCallback(() => {
    if (!user.email) {
      setDrafts(null); setMyAssessmentsList(null);
      setRecentWorkError(null);
      return;
    }
    // Distinguish "loaded → empty" from "load failed → unknown" by surfacing
    // the error to the landing page rather than silently swallowing it as
    // an empty list. Empty + error is rendered as a "couldn't load" hint.
    setRecentWorkError(null);
    Promise.allSettled([api.myDrafts(), api.myAssessments()]).then(([d, a]) => {
      if (d.status === 'fulfilled') setDrafts(d.value);
      else setDrafts([]);
      if (a.status === 'fulfilled') setMyAssessmentsList(a.value);
      else setMyAssessmentsList([]);
      const errs = [d, a].filter(r => r.status === 'rejected') as PromiseRejectedResult[];
      if (errs.length > 0) {
        setRecentWorkError(
          'Could not load your recent work. Check the network tab or try Refresh.'
        );
      }
    });
  }, [user.email]);

  // Initial fetch on sign-in. Subsequent reloads are triggered by mutating
  // events (submit, delete) or explicit user action — never by remounts.
  useEffect(() => { reloadMyWork(); }, [reloadMyWork]);

  const handleDeleteDraftRow = useCallback(async (id: string) => {
    setRecentWorkError(null);
    setDrafts(prev => prev ? prev.filter(d => d.id !== id) : prev);
    try {
      await api.deleteDraft(id);
    } catch (e: any) {
      setRecentWorkError(e?.message || 'Could not delete draft');
    }
    reloadMyWork();
  }, [reloadMyWork]);

  const handleDeleteAssessmentRow = useCallback(async (id: string, name: string) => {
    setRecentWorkError(null);
    setMyAssessmentsList(prev => prev ? prev.filter(a => a.id !== id) : prev);
    try {
      await api.deleteMyAssessment(id);
    } catch (e: any) {
      setRecentWorkError(e?.message || `Could not delete "${name}"`);
    }
    reloadMyWork();
  }, [reloadMyWork]);

  // Business-value assumptions — adjustable on Results / Roadmap.
  // Initial value: DEFAULT_ASSUMPTIONS, overridden by saved user prefs once loaded.
  const [assumptions, setAssumptions] = useState<BusinessAssumptions>({ ...DEFAULT_ASSUMPTIONS });
  const assumptionsTimer = useRef<number | null>(null);

  // Locale (currency + units) — persisted with user prefs alongside assumptions.
  const [locale, setLocale] = useState<LocalePrefs>({ ...DEFAULT_LOCALE });
  const [fxRates, setFxRates] = useState<Record<CurrencyCode, number>>({ ...DEFAULT_FX_RATES });

  useEffect(() => {
    api.me().then(setUser).catch(() => {
      setUser({ email: null, name: null, isAdmin: false });
    });
    // Hydrate the industry catalog — multi-industry. Falls back to the legacy
    // single-industry endpoint for older deploys.
    api.industries().then(list => {
      if (Array.isArray(list) && list.length > 0) setIndustries(list as any);
      else throw new Error('Empty industry list — falling back to legacy /api/industry');
    }).catch(() => {
      api.activeIndustry().then(r => {
        if (r?.meta) setActiveIndustry(r.meta);
      }).catch(() => { /* keep FALLBACK_INDUSTRY (P&U) */ });
    });
    // Hydrate blend presets — best-effort; absence isn't fatal (the picker
    // works without presets, just without the quick-pick row at top).
    api.blendPresets().then(list => { setBlendPresets(list as any); }).catch(() => {});
  }, []);

  // Load saved user preferences (assumptions, locale) once we know who's signed in.
  useEffect(() => {
    if (!user.email) return;
    // Hydrate the custom-assumption-field cache FIRST so any defaults from
    // admin-added fields are available before we initialize assumptions.
    api.assumptionFields().then(fields => {
      setCustomAssumptionFields(fields.map(f => ({
        key: f.key, label: f.label, unit: f.unit,
        step: f.step, min: f.min, max: f.max,
        category: f.category, defaultValue: f.defaultValue,
        relevantFor: (f.relevantFor || []) as any,
      })));
      // Re-seed assumptions with merged defaults (built-in + active industry
      // pack + custom). Don't overwrite user-modified values already in state.
      const active = getActiveIndustry();
      setAssumptions((cur) => ({ ...buildDefaultAssumptions(active), ...cur }));
    }).catch(() => { /* keep built-in defaults */ });

    api.getMyPrefs().then((prefs) => {
      const a = (prefs as any)?.assumptions;
      if (a && typeof a === 'object') {
        setAssumptions((cur) => ({ ...cur, ...a }));
      }
      const l = (prefs as any)?.locale;
      if (l && typeof l === 'object') {
        setLocale((cur) => ({ ...cur, ...l }));
      }
    }).catch(() => { /* keep defaults */ });
    // FX rates from admin config — public to all signed-in users.
    api.fxRates().then(r => {
      setFxRates(parseFxRates(r.json));
    }).catch(() => { /* keep DEFAULT_FX_RATES */ });
  }, [user.email]);

  // Auto-persist assumptions + locale changes (debounced 1s) to user prefs.
  // Also persist to the active submitted-assessment record so admins see latest values.
  useEffect(() => {
    if (!user.email) return;
    if (assumptionsTimer.current) window.clearTimeout(assumptionsTimer.current);
    assumptionsTimer.current = window.setTimeout(() => {
      api.putMyPrefs({
        assumptions: assumptions as unknown as Record<string, unknown>,
        locale: locale as unknown as Record<string, unknown>,
      }).catch(() => {});
      if (savedAssessmentId) {
        api.updateMyAssessmentAssumptions(savedAssessmentId, assumptions as unknown as Record<string, unknown>).catch(() => {});
      }
    }, 1000);
    return () => { if (assumptionsTimer.current) window.clearTimeout(assumptionsTimer.current); };
  }, [assumptions, locale, user.email, savedAssessmentId]);

  useEffect(() => {
    const savedAnswers = decodeAssessmentFromUrl();
    if (savedAnswers) {
      setAnswers(savedAnswers);
      const computedResults = assessMaturity(savedAnswers);
      setResults(computedResults);
      setView('results');
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (window.location.pathname.startsWith('/admin') || window.location.hash === '#admin') {
      setModePersist('admin');
    }
  }, []);

  // Autosave drafts when in assessment view (debounced 1.5s).
  useEffect(() => {
    if (view !== 'assessment' || !draftId || !user.email) return;
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      api.upsertDraft(
        draftId,
        answers.profile.companyName || '(untitled)',
        answers,
        draftStep,
      ).catch(() => { /* silent — drafts are best-effort */ });
    }, 1500);
    return () => {
      if (draftTimer.current) window.clearTimeout(draftTimer.current);
    };
  }, [answers, draftId, draftStep, user.email, view]);

  const handleStart = () => {
    // Prefill the company profile from the active account — captured once at account
    // creation, mapped from the modal's stored form to the wizard's value form.
    const prof = activeAccount ? normalizeProfileFromAccount({
      name: activeAccount.name,
      utility_type: activeAccount.utility_type,
      territory_size: (activeAccount as any).territory_size,
      geography: (activeAccount as any).geography,
      strategic_priorities: (activeAccount as any).strategic_priorities,
    }) : {};
    setAnswers({ ...INITIAL_ANSWERS, profile: { ...(INITIAL_ANSWERS as any).profile, ...prof } } as any);
    // A new assessment carries forward the prior submitted assessment's selections so
    // nothing is re-entered — the account's latest is the starting point (profile always
    // comes from the account, so it is preserved over the carried-forward answers).
    api.latestAssessment().then((r) => {
      const prev = r.assessment?.answers_json;
      if (prev) setAnswers((cur) => ({ ...(prev as any), profile: (cur as any).profile }) as any);
    }).catch(() => { /* first assessment for this account — nothing to carry */ });
    setResults(null);
    setSavedAssessmentId(null);
    setSaveError(null);
    setDraftId(newId());
    // Skip the Profile step when the account's profile is already complete — the user
    // lands on Infrastructure and never re-enters the profile.
    setDraftStep((activeAccount as any)?.profile_complete ? 1 : 0);
    setView('assessment');
  };

  const handleResumeDraft = async (id: string) => {
    try {
      const d = await api.getDraft(id);
      setAnswers(d.answers as unknown as AssessmentAnswers);
      setDraftId(d.id);
      setDraftStep(d.currentStep || 0);
      setResults(null);
      setSavedAssessmentId(null);
      setSaveError(null);
      setView('assessment');
    } catch (e) {
      console.error('Resume failed', e);
    }
  };

  const handleViewAssessment = async (id: string) => {
    // Load a previously-submitted assessment into the results view. We use
    // the saved snapshot of `results` rather than re-running `assessMaturity`
    // so the view reflects what the customer actually saw at submit time.
    try {
      console.log('[viewAssessment] fetching', id);
      const d = await api.getMyAssessment(id);
      console.log('[viewAssessment] got', { id: d.id, hasAnswers: !!d.answers, hasResults: !!d.results, resultKeys: d.results ? Object.keys(d.results) : null });
      const answers = d.answers as unknown as AssessmentAnswers;
      const fetched = d.results as unknown as Partial<AssessmentResults>;
      // If the saved snapshot is missing fields the UI needs, recompute on
      // the fly. Belt-and-suspenders so older saves still render.
      const needsRecompute = !fetched
        || typeof fetched.overallScore !== 'number'
        || !Array.isArray(fetched.recommendations)
        || !fetched.dimensionScores;
      const finalResults = needsRecompute ? assessMaturity(answers) : (fetched as AssessmentResults);
      setAnswers(answers);
      setResults(finalResults);
      setSavedAssessmentId(d.id);
      setSaveError(null);
      setDraftId(null);
      setView('results');
      console.log('[viewAssessment] view -> results', { recompute: needsRecompute });
    } catch (e: any) {
      console.error('[viewAssessment] failed', e);
      alert(`Could not open assessment: ${e?.message || e}`);
    }
  };

  const handleEditAndRerun = async (id: string) => {
    // Clone an existing submitted assessment's answers into a fresh draft so
    // the user can adjust a few inputs and resubmit as a NEW assessment.
    // Original record is preserved — they form a progression series under
    // the same customer name.
    try {
      const d = await api.getMyAssessment(id);
      const prior = d.answers as unknown as AssessmentAnswers;
      setAnswers(prior);
      setResults(null);
      setSavedAssessmentId(null);
      setSaveError(null);
      setDraftId(newId());
      setDraftStep(0);
      setView('assessment');
    } catch (e: any) {
      console.error('[editAndRerun] failed', e);
      alert(`Could not load assessment for editing: ${e?.message || e}`);
    }
  };

  // The actual save — pulled out of handleAssessmentComplete so the
  // consistency-check modal can call it after the user clicks "Submit anyway".
  const actuallySubmitAssessment = async () => {
    const computedResults = assessMaturity(answers);
    setResults(computedResults);
    setView('results');
    // Server-side, per-account: the single source of truth the account keeps —
    // Operate, Admin, compare, recent-work and prefill-from-latest all read it.
    const aid = draftId || newId();
    try {
      const r: any = computedResults;
      await api.saveAssessment({
        id: aid, status: 'submitted',
        label: activeAccount?.name || (answers as any)?.profile?.companyName,
        answers_json: answers, results_json: computedResults,
        overall_score: r?.overallScore ?? r?.overall_score ?? undefined,
        current_phase: r?.currentPhase ?? r?.current_phase ?? undefined,
      });
      setSavedAssessmentId(aid);
      // The draft and the submission are the SAME server row (same id): saving with
      // status='submitted' transitions it in place (draft→submitted), so we must NOT
      // delete it — just clear the in-flight draft id. (Previously drafts lived in a
      // separate localStorage store, so a delete here was safe; now it would remove the
      // submission we just saved.)
      setDraftId(null);
      // Refresh recent-work so the new submission shows on the landing.
      reloadMyWork();
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    }
  };

  const handleAssessmentComplete = async () => {
    // Beta: if AI consistency check is enabled, run the audit BEFORE saving.
    // The modal lets the user revise (jump back to a step) or submit anyway.
    if (consistencyCheckEnabled) {
      setShowConsistencyModal(true);
      setConsistencyLoading(true);
      setConsistencyIssues(null);
      try {
        const r = await api.consistencyCheck(answers);
        setConsistencyIssues(r.issues || []);
      } catch (e) {
        // Don't block submit on a check failure — just close the modal and submit.
        console.warn('Consistency check failed; submitting without it.', e);
        setShowConsistencyModal(false);
        await actuallySubmitAssessment();
      } finally {
        setConsistencyLoading(false);
      }
      return;
    }
    await actuallySubmitAssessment();
  };

  const handleRestart = () => {
    setAnswers({ ...INITIAL_ANSWERS });
    setResults(null);
    setSavedAssessmentId(null);
    setSaveError(null);
    setDraftId(null);
    setView('landing');
  };

  const handleBackToLanding = () => setView('landing');
  const handleViewRoadmap = () => setView('roadmap');
  const handleBackFromRoadmap = () => setView(results ? 'results' : 'landing');
  const handleOpenAdmin = () => setModePersist('admin');

  // Promote the current assessment's "current use cases" answers into the active
  // account's Operate state (coarse source availability -> module readiness -> portfolio).
  const handlePromote = useCallback(async () => {
    const cu = (answers.currentUseCases || {}) as { selectedDataSources?: string[]; selectedUseCases?: string[] };
    // The prescriptive roadmap's recommended next use cases → promoted into the
    // portfolio too, so Operate shows the full roadmap, not just what's already live.
    const roadmapIds = (((results as any)?.recommendations) || [])
      .map((r: any) => r?.useCase?.id).filter(Boolean);
    const sources = cu.selectedDataSources || [];
    const inProd = cu.selectedUseCases || [];
    // Guard: nothing to promote. The backend refuses to wipe on empty, but the UI must
    // not offer a no-op that looks like data loss — tell the user to assess first.
    if (sources.length === 0 && inProd.length === 0 && roadmapIds.length === 0) {
      throw new Error('Nothing to promote yet. Complete an assessment — select the data sources you have and the use cases in production / recommended — then promote.');
    }
    return api.promote(sources, inProd, roadmapIds, savedAssessmentId || undefined);
  }, [answers, results, savedAssessmentId]);

  const renderView = () => {
  switch (view) {
    case 'compare':
      return <CompareView accountName={activeAccount?.name} onBack={handleBackToLanding} />;
    case 'landing':
      return (
        <LandingPage
          onStart={handleStart}
          onViewRoadmap={handleViewRoadmap}
          user={user}
          onOpenAdmin={handleOpenAdmin}
          onResumeDraft={handleResumeDraft}
          onViewAssessment={handleViewAssessment}
          onEditAndRerun={handleEditAndRerun}
          onViewCompare={() => setView('compare')}
          drafts={drafts}
          myAssessments={myAssessmentsList}
          onReloadMyWork={reloadMyWork}
          onDeleteDraft={handleDeleteDraftRow}
          onDeleteAssessment={handleDeleteAssessmentRow}
          deleteError={recentWorkError}
          onDismissDeleteError={() => setRecentWorkError(null)}
        />
      );
    case 'assessment':
      return (
        <>
          <AssessmentWizard
            answers={answers}
            onAnswersChange={setAnswers}
            onComplete={handleAssessmentComplete}
            onBack={handleBackToLanding}
            onStepChange={setDraftStep}
            initialStep={draftStep}
            draftId={draftId}
          />
          {showConsistencyModal && (
            <ConsistencyCheckModal
              loading={consistencyLoading}
              issues={consistencyIssues}
              onClose={() => setShowConsistencyModal(false)}
              onSubmitAnyway={() => {
                setShowConsistencyModal(false);
                actuallySubmitAssessment();
              }}
              onGoToStep={(idx) => {
                setShowConsistencyModal(false);
                setDraftStep(idx);
              }}
            />
          )}
        </>
      );
    case 'results':
      return results ? (
        <ResultsDashboard
          results={results}
          answers={answers}
          onRestart={handleRestart}
          onViewRoadmap={handleViewRoadmap}
          savedAssessmentId={savedAssessmentId}
          saveError={saveError}
          assumptions={assumptions}
          onAssumptionsChange={setAssumptions}
          onAnswersChange={(next) => {
            setAnswers(next);
            // Customer-tuned complexity changes scoring — recompute live.
            setResults(assessMaturity(next));
          }}
          locale={locale}
          onLocaleChange={setLocale}
          fxRates={fxRates}
        />
      ) : null;
    case 'roadmap':
      return (
        <Suspense fallback={<RouteFallback label="Loading roadmap…" />}>
          <RoadmapView
            results={results}
            answers={answers}
            onBack={handleBackFromRoadmap}
            assumptions={assumptions}
            onAssumptionsChange={setAssumptions}
            locale={locale}
            onLocaleChange={setLocale}
            fxRates={fxRates}
          />
        </Suspense>
      );
    default:
      return null;
  }
  };

  return (
    <div className="min-h-screen bg-navy-900 flex flex-col">
      <AccountBar onPromote={handlePromote} mode={mode} onSetMode={setModePersist} onSession={setSession} />
      {mode === 'operate' ? <OperateView accountName={activeAccount?.name} />
        : mode === 'admin' ? <AdminView />
        : renderView()}
    </div>
  );
}

function RouteFallback({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
      {label}
    </div>
  );
}

export default App;
