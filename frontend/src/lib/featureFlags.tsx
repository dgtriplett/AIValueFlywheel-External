// Feature flag context. Loads /api/feature-flags once on mount and exposes a
// `useFeatureFlag(key)` hook for boolean checks. Backend resolves admin vs.
// general user — frontend just reads the resolved boolean.
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api';

type FlagMap = Record<string, boolean>;

interface FeatureFlagCtx {
  flags: FlagMap;
  loaded: boolean;
  refresh: () => void;
}

const Ctx = createContext<FeatureFlagCtx>({ flags: {}, loaded: false, refresh: () => {} });

export const FeatureFlagProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [flags, setFlags] = useState<FlagMap>({});
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    api.myFeatureFlags()
      .then(f => { setFlags(f || {}); setLoaded(true); })
      .catch(() => { setFlags({}); setLoaded(true); });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return <Ctx.Provider value={{ flags, loaded, refresh }}>{children}</Ctx.Provider>;
};

/** Returns true iff the named flag is enabled for the current user. */
export function useFeatureFlag(key: string): boolean {
  return useContext(Ctx).flags[key] === true;
}

/** Full map + loading state. Use when you need to gate multiple flags or
 *  refresh after admin changes. */
export function useFeatureFlags(): FeatureFlagCtx {
  return useContext(Ctx);
}
