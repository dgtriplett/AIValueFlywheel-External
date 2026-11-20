import { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { AccountBar, type Mode } from './components/AccountBar';
import { OperateView } from './components/OperateView';
import { AdminView } from './components/AdminView';
import type { Session } from './lib/api';
import { DEFAULT_ASSUMPTIONS, setCustomAssumptionFields, buildDefaultAssumptions, type BusinessAssumptions } from './data/businessValue';
import { setIndustries, setActiveIndustry, getActiveIndustry } from './industries/active';
import { setBlendPresets } from './industries/presets';
import { DEFAULT_FX_RATES, DEFAULT_LOCALE, parseFxRates, type CurrencyCode, type LocalePrefs } from './data/locale';
import { api, type CurrentUser } from './lib/api';

// Explore (the catalog map + blast radius) is large — split it out of the initial bundle.
const ExploreView = lazy(() =>
  import('./components/ExploreView').then(m => ({ default: m.ExploreView }))
);

const MODES: Mode[] = ['operate', 'explore', 'admin'];

function App() {
  // Operate / Explore / Admin is an in-shell mode, so the shared AccountBar stays put.
  // Persisted so it survives the reload an account switch triggers.
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const m = localStorage.getItem('aivr.mode') as Mode | null;
      return m && MODES.includes(m) ? m : 'operate';
    }
    catch { return 'operate'; }
  });
  const setModePersist = useCallback((m: Mode) => {
    setMode(m);
    try { localStorage.setItem('aivr.mode', m); } catch { /* private mode */ }
  }, []);
  const [session, setSession] = useState<Session | null>(null);
  const activeAccount = session?.accounts.find((a) => a.id === session.active_account_id) || session?.accounts[0];
  const [user, setUser] = useState<CurrentUser>({ email: null, name: null, isAdmin: false });

  // Business-value assumptions used by Explore's value estimates. Initial value:
  // DEFAULT_ASSUMPTIONS, overridden by saved user prefs once loaded.
  const [assumptions, setAssumptions] = useState<BusinessAssumptions>({ ...DEFAULT_ASSUMPTIONS });
  const assumptionsTimer = useRef<number | null>(null);

  // Locale (currency + units) — persisted with user prefs alongside assumptions.
  const [locale, setLocale] = useState<LocalePrefs>({ ...DEFAULT_LOCALE });
  const [fxRates, setFxRates] = useState<Record<CurrencyCode, number>>({ ...DEFAULT_FX_RATES });

  useEffect(() => {
    api.me().then(setUser).catch(() => {
      setUser({ email: null, name: null, isAdmin: false });
    });
    api.industries().then(list => {
      if (Array.isArray(list) && list.length > 0) setIndustries(list as any);
      else throw new Error('Empty industry list — falling back to /api/industry');
    }).catch(() => {
      api.activeIndustry().then(r => {
        if (r?.meta) setActiveIndustry(r.meta);
      }).catch(() => { /* keep FALLBACK_INDUSTRY (P&U) */ });
    });
    // Blend presets are best-effort; the picker works without them.
    api.blendPresets().then(list => { setBlendPresets(list as any); }).catch(() => {});
    if (window.location.pathname.startsWith('/admin') || window.location.hash === '#admin') {
      setModePersist('admin');
    }
  }, [setModePersist]);

  // Load saved user preferences (assumptions, locale) once we know who's signed in.
  useEffect(() => {
    if (!user.email) return;
    // Hydrate the custom-assumption-field cache FIRST so defaults from admin-added
    // fields are available before assumptions are initialized.
    api.assumptionFields().then(fields => {
      setCustomAssumptionFields(fields.map(f => ({
        key: f.key, label: f.label, unit: f.unit,
        step: f.step, min: f.min, max: f.max,
        category: f.category, defaultValue: f.defaultValue,
        relevantFor: (f.relevantFor || []) as any,
      })));
      const active = getActiveIndustry();
      setAssumptions((cur) => ({ ...buildDefaultAssumptions(active), ...cur }));
    }).catch(() => { /* keep built-in defaults */ });

    api.getMyPrefs().then((prefs) => {
      const a = (prefs as any)?.assumptions;
      if (a && typeof a === 'object') setAssumptions((cur) => ({ ...cur, ...a }));
      const l = (prefs as any)?.locale;
      if (l && typeof l === 'object') setLocale((cur) => ({ ...cur, ...l }));
    }).catch(() => { /* keep defaults */ });
    api.fxRates().then(r => setFxRates(parseFxRates(r.json))).catch(() => { /* keep defaults */ });
  }, [user.email]);

  // Auto-persist assumptions + locale changes (debounced 1s) to user prefs.
  useEffect(() => {
    if (!user.email) return;
    if (assumptionsTimer.current) window.clearTimeout(assumptionsTimer.current);
    assumptionsTimer.current = window.setTimeout(() => {
      api.putMyPrefs({
        assumptions: assumptions as unknown as Record<string, unknown>,
        locale: locale as unknown as Record<string, unknown>,
      }).catch(() => {});
    }, 1000);
    return () => { if (assumptionsTimer.current) window.clearTimeout(assumptionsTimer.current); };
  }, [assumptions, locale, user.email]);

  return (
    <div className="min-h-screen bg-navy-900 flex flex-col">
      <AccountBar mode={mode} onSetMode={setModePersist} onSession={setSession} />
      {mode === 'operate' && <OperateView accountName={activeAccount?.name} />}
      {mode === 'admin' && <AdminView />}
      {mode === 'explore' && (
        <Suspense fallback={<RouteFallback label="Loading the use-case catalog…" />}>
          <ExploreView
            assumptions={assumptions}
            onAssumptionsChange={setAssumptions}
            locale={locale}
            onLocaleChange={setLocale}
            fxRates={fxRates}
            onOpenOperate={() => setModePersist('operate')}
          />
        </Suspense>
      )}
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
