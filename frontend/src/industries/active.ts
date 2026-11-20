/**
 * Industries — multi-industry catalog + active-industry cache.
 *
 * Three layers:
 *   1. Master list of all enabled industries (loaded from /api/industries)
 *   2. The active industry id(s) — either a single pack or a blend of packs
 *   3. The synthetic composite IndustryMeta when a blend is active
 *
 * Blend mode: instead of `_activeId = "pu"`, the active state holds an array
 * of pack ids `["pu","tl","epc"]`. `getActiveIndustry()` returns either the
 * single pack OR a synthetic composite that unions every relevant field, so
 * downstream consumers (the wizard, the roadmap, the scoring engine) don't
 * have to know whether they're operating on a single pack or a blend.
 *
 * The "active industry id" used for filtering use cases becomes the union of
 * pack ids. Use `getActiveIndustryIds()` to test membership.
 */
import { useSyncExternalStore } from 'react';
import type { IndustryMeta } from './types';

/** Industry-neutral default used while the catalog is loading or when the
 *  fetch fails. No industry-specific copy here — the wizard will populate
 *  with a real industry pack once /api/industries returns. */
// AI Value Realization is P&U-only and serves no /api/industries pack (local-first), so the
// fallback IS the active industry. id must be 'pu' so StepProfile's legacy-P&U paths
// (UTILITY_TYPE_OPTIONS for customer type, sizeOptionsFor for scale) render their
// options when customerTypes/territorySize are empty — otherwise both grids are blank
// and the Profile step can't be completed.
export const FALLBACK_INDUSTRY: IndustryMeta = {
  id: 'pu',
  label: 'Power & Utilities',
  shortLabel: 'P&U',
  description: '',
  tagline: '',
  domains: [],
  phases: {
    '1': 'Operational Transparency',
    '2': 'Proactive Optimization',
    '3': 'Autonomous & Self-Optimizing',
  },
  customerTypes: [],
  territorySize: [],
  territorySizeQuestion: 'What is your scale?',
};

let _industries: IndustryMeta[] = [];
let _activeIds: string[] = ['pu'];  // singletons are the common case; blends are 2+
// Cached blended composite — recomputed only when _activeIds or _industries
// change. Needed so `getActiveIndustry()` + `getActiveIndustryIds()` return
// STABLE references frame-to-frame; useSyncExternalStore re-renders the
// world if a new array / object identity comes back every call.
let _cachedActiveIndustry: IndustryMeta | null = null;
let _cachedActiveIdsFrozen: readonly string[] = Object.freeze(['pu']);
const _listeners = new Set<() => void>();

function _invalidateCache(): void {
  _cachedActiveIndustry = null;
  _cachedActiveIdsFrozen = Object.freeze([..._activeIds]);
}

function notify(): void {
  _invalidateCache();
  for (const fn of _listeners) try { fn(); } catch { /* swallow */ }
}

/** Replace the cached industry list. Auto-selects the only one if there's
 *  exactly one; otherwise leaves the active id(s) unchanged where possible. */
export function setIndustries(list: IndustryMeta[]): void {
  _industries = list || [];
  if (_industries.length === 1) {
    _activeIds = [_industries[0].id];
  } else if (_activeIds.length === 0) {
    if (_industries.length > 0) _activeIds = [_industries[0].id];
  } else {
    // Drop any active ids that aren't in the new list. If everything got
    // dropped, fall back to the first available.
    _activeIds = _activeIds.filter(id => _industries.find(i => i.id === id));
    if (_activeIds.length === 0 && _industries.length > 0) {
      _activeIds = [_industries[0].id];
    }
  }
  notify();
}

export function getIndustries(): IndustryMeta[] {
  return _industries;
}

/** Set the active industry to a single pack. */
export function setActiveIndustryId(id: string): void {
  if (_industries.find(i => i.id === id)) {
    _activeIds = [id];
    notify();
  }
}

/** Set the active industry to a blend of packs. Pass [] to no-op. */
export function setActiveIndustryIds(ids: string[]): void {
  const valid = ids.filter(id => _industries.find(i => i.id === id));
  if (valid.length === 0) return;
  _activeIds = valid;
  notify();
}

export function getActiveIndustryId(): string {
  // Returns the first active id for legacy callers that expect a single id.
  // Use getActiveIndustryIds() when you need the full blend.
  return _activeIds[0] || 'pu';
}

export function getActiveIndustryIds(): readonly string[] {
  // Stable frozen reference; only changes when _activeIds is mutated through
  // setActiveIndustryId / setActiveIndustryIds / setIndustries. Critical for
  // useSyncExternalStore correctness — returning a fresh array each call
  // would force every subscriber to re-render every render cycle.
  return _cachedActiveIdsFrozen;
}

export function isBlendActive(): boolean {
  return _activeIds.length > 1;
}

export function getActiveIndustry(): IndustryMeta {
  // Return a stable reference for the same (activeIds, industries) state so
  // hooks subscribed via useSyncExternalStore don't see a new object every
  // render. The cache is invalidated on state mutation in notify().
  if (_cachedActiveIndustry) return _cachedActiveIndustry;
  if (_activeIds.length === 0) {
    _cachedActiveIndustry = FALLBACK_INDUSTRY;
    return _cachedActiveIndustry;
  }
  if (_activeIds.length === 1) {
    _cachedActiveIndustry = _industries.find(i => i.id === _activeIds[0]) || FALLBACK_INDUSTRY;
    return _cachedActiveIndustry;
  }
  const packs = _activeIds
    .map(id => _industries.find(i => i.id === id))
    .filter((p): p is IndustryMeta => !!p);
  if (packs.length === 0) {
    _cachedActiveIndustry = FALLBACK_INDUSTRY;
  } else if (packs.length === 1) {
    _cachedActiveIndustry = packs[0];
  } else {
    _cachedActiveIndustry = composeBlend(packs);
  }
  return _cachedActiveIndustry;
}

/** Build a synthetic composite IndustryMeta from a set of packs. The composite
 *  unions every collection (domains, customer types, strategic priorities,
 *  data sources, infrastructure questions, assumption fields). Where packs
 *  overlap on a key (e.g. same assumption field), the first pack wins —
 *  that's the highest-precedence pack (the one the user selected first).
 *
 *  ID convention: `_blend:<sorted_ids>` so a blend like ["epc","pu","tl"]
 *  always renders to `_blend:epc,pu,tl` regardless of selection order.
 *  Useful for caching + URL persistence.
 */
export function composeBlend(packs: IndustryMeta[]): IndustryMeta {
  const sortedIds = packs.map(p => p.id).sort();
  const blendId = `_blend:${sortedIds.join(',')}`;
  const label = packs.map(p => p.label).join(' + ');
  const shortLabel = packs.map(p => p.shortLabel || p.id).join(' + ');

  const uniqueBy = <T>(items: T[], key: (t: T) => string): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of items) {
      const k = key(item);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out;
  };

  const domains = uniqueBy(packs.flatMap(p => p.domains || []), d => d);

  // Phases share the same number ↦ label mapping in 99% of packs. Pick the
  // first pack's phase labels; if any pack disagrees we still use the first
  // — phase numbers (1/2/3) are the universal contract.
  const phases = packs[0].phases || {};
  const phaseDescriptions = packs[0].phaseDescriptions;

  // Customer types: prefix each with the source pack's shortLabel so the
  // picker disambiguates (e.g. "EPC: Renewable EPC" vs "DistGen: Fuel Cell OEM")
  const customerTypes = packs.flatMap(p =>
    (p.customerTypes || []).map(ct => ({
      id: `${p.id}:${ct.id}`,
      label: `${p.shortLabel || p.id}: ${ct.label}`,
    }))
  );

  // Territory size: also prefix to disambiguate but flatten — most packs ask
  // similar questions ("scale of operation"), so we keep the first pack's
  // question label.
  const territorySize = uniqueBy(packs.flatMap(p => p.territorySize || []), t => t.id);
  const territorySizeQuestion = packs[0].territorySizeQuestion || 'What is your scale?';

  // Assumption fields union — first occurrence of each key wins.
  const assumptionFields = uniqueBy(
    packs.flatMap(p => p.assumptionFields || []),
    f => f.key
  );

  return {
    id: blendId,
    label,
    shortLabel,
    description: `Blended industry composition: ${packs.map(p => p.label).join(', ')}.`,
    tagline: '',
    domains,
    phases,
    phaseDescriptions,
    customerTypes,
    territorySize,
    territorySizeQuestion,
    assumptionFields,
  };
}

/** Returns true when the given use case's industry id is in scope for the
 *  currently active id(s). Used by every place that filters USE_CASES. */
export function ucMatchesActiveIndustry(uc: { industryId?: string }): boolean {
  if (!uc.industryId) return true;
  return _activeIds.includes(uc.industryId);
}

/** Returns true when the given UC matches any of the provided ids. Use this
 *  in scoring / roadmap code paths that pass an explicit id list. */
export function ucMatchesAnyIndustry(
  uc: { industryId?: string },
  industryIds: string[] | null | undefined,
): boolean {
  if (!industryIds || industryIds.length === 0) return true;
  if (!uc.industryId) return true;
  return industryIds.includes(uc.industryId);
}

/** Legacy single-industry setter — used by the legacy /api/industry hydrate
 *  path. Equivalent to setIndustries([meta]) with auto-select. */
export function setActiveIndustry(meta: IndustryMeta): void {
  setIndustries([meta]);
}

function _subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

export function useActiveIndustry(): IndustryMeta {
  return useSyncExternalStore(_subscribe, getActiveIndustry, getActiveIndustry);
}

export function useIndustries(): IndustryMeta[] {
  return useSyncExternalStore(_subscribe, getIndustries, getIndustries);
}

export function useActiveIndustryIds(): readonly string[] {
  return useSyncExternalStore(_subscribe, getActiveIndustryIds, getActiveIndustryIds);
}
