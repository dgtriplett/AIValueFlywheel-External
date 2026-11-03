/**
 * Cross-industry use-case detection.
 *
 * Use cases live inside one industry pack via `industryId`, but in practice
 * many of them are conceptual twins — "Predictive Maintenance" shows up in
 * pu (for grid + generation equipment), mfg_industrials (for plant + field
 * assets), dist_gen (for deployed generators), and epc (for heavy equipment).
 * When a user composes a blend, we want to surface these twins as
 * "Cross-Industry Foundations" so the enterprise-wide leverage of a single
 * investment is visible.
 *
 * Detection has two paths:
 *   1. Normalized name match — `_normalize(uc.name)` clustered across packs.
 *      Auto-detects most cases (everyone calls "Predictive Maintenance"
 *      something close to that). Cheap, no admin work.
 *   2. Explicit `crossIndustryKey` on a UC — admin-settable override for cases
 *      that don't share a name but ARE the same concept. (Not used today;
 *      reserved for the future.)
 *
 * Returns clusters where ≥2 of the active packs contribute.
 */
import { USE_CASES } from './useCases';
import type { UseCase } from './useCases';

export interface CrossIndustryGroup {
  /** Stable cluster id (the normalized name). */
  key: string;
  /** Display label — pulled from the first cluster member's name. */
  label: string;
  /** UCs in this cluster — one per pack at most (best representative). */
  ucs: UseCase[];
  /** Phase the cluster sits in — taken as the min phase across members. */
  phase: number;
  /** Packs covered. */
  industryIds: string[];
}

// Words that don't carry meaning when matching twins across packs.
const _STOP_WORDS = new Set([
  'and', 'the', 'a', 'an', 'of', 'for', 'with', 'in', 'on', 'to',
  'data', 'lake',
]);

/** Normalize a UC name into a comparable token signature. Order-insensitive,
 *  punctuation-stripped, stop-word-removed, lowercased. */
function _normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !_STOP_WORDS.has(t))
    .sort()
    .join(' ');
}

/** Hardcoded equivalences — concepts named differently across packs but
 *  semantically the same. Each entry is a list of normalized signatures that
 *  should collapse to a single cluster. Useful when name-only matching
 *  misses a real twin. */
const _MANUAL_ALIASES: string[][] = [
  // Predictive maintenance shows up under many names across packs.
  ['equipment maintenance predictive', 'heavy maintenance predictive', 'maintenance plant predictive', 'maintenance predictive', 'predictive maintenance'],
  // Supplier visibility / Tier 2 risk
  ['multi supplier tier visibility', 'supplier visibility', 'component supplier visibility', 'ceramic bop supplier visibility', 'substrate gas specialty supplier visibility'],
  // Supplier disruption / risk scoring
  ['disruption forecasting risk supplier', 'specialty supplier lead time forecasting', 'supplier risk forecasting'],
  // GenAI service technician copilot
  ['copilot field genai service', 'copilot field technician genai'],
  // Connected vehicle / asset / device / fleet telemetry foundation
  ['connected telemetry vehicle', 'asset connected lake telemetry', 'connected device lake telemetry', 'connected energy lake server telemetry'],
  // Yield root cause
  ['root analytics cause stack yield', 'root analytics cause yield', 'cause excursion detection root yield'],
  // Demand forecasting
  ['channel demand inventory sensing', 'demand equipment forecasting parts service', 'demand forecast regional trim mix'],
  // ESG / scope 3 emissions
  ['emissions reporting scope sustainability', '1 3 emissions reporting scope sustainability'],
  // Plant / mfg foundation lake
  ['plant production unified', 'mes manufacturing per test unit', 'stack burn in lake manufacturing test'],
  // Safety leading indicators
  ['indicator leading models safety', 'indicators leading plant safety'],
  // Warranty + service records
  ['lake records repair warranty', 'lake records service warranty', 'lake service warranty'],
  // Autonomous quality / service loop
  ['autonomous closed loop quality', 'autonomous loop service'],
  // Self-optimizing plant / fleet / fab
  ['optimizing plant self', 'optimizing fab control self', 'optimizing dispatch fleet self', 'optimizing fleet self crew'],
];

const _ALIAS_INDEX: Map<string, string> = (() => {
  const idx = new Map<string, string>();
  for (const group of _MANUAL_ALIASES) {
    // First signature in the group is the canonical key for the whole group.
    const canonical = group[0];
    for (const sig of group) idx.set(sig, canonical);
  }
  return idx;
})();

function _signature(uc: UseCase): string {
  const base = _normalize(uc.name);
  return _ALIAS_INDEX.get(base) || base;
}

/** Find use cases that exist in ≥2 of the active packs (twins). The result is
 *  ordered by impact: more-packs-covered first, then by phase ascending. */
export function getCrossIndustryGroups(industryIds: string[]): CrossIndustryGroup[] {
  if (!industryIds || industryIds.length < 2) return [];
  const activeSet = new Set(industryIds);

  // Bucket UCs by signature, but only include UCs whose pack is in scope.
  const buckets = new Map<string, UseCase[]>();
  for (const uc of USE_CASES) {
    if (!uc.industryId || !activeSet.has(uc.industryId)) continue;
    const sig = _signature(uc);
    if (!buckets.has(sig)) buckets.set(sig, []);
    buckets.get(sig)!.push(uc);
  }

  const groups: CrossIndustryGroup[] = [];
  for (const [sig, ucs] of buckets) {
    // De-duplicate by industryId — keep the first UC per pack (the canonical
    // representative). If the same UC name appears twice in one pack, that
    // pack only contributes once to the cluster.
    const byPack = new Map<string, UseCase>();
    for (const uc of ucs) {
      const pid = uc.industryId || 'pu';
      if (!byPack.has(pid)) byPack.set(pid, uc);
    }
    if (byPack.size < 2) continue;  // not actually cross-industry
    const members = Array.from(byPack.values());
    groups.push({
      key: sig,
      label: members[0].name,
      ucs: members,
      phase: Math.min(...members.map(u => u.phase || 1)),
      industryIds: Array.from(byPack.keys()),
    });
  }

  groups.sort((a, b) => {
    if (b.ucs.length !== a.ucs.length) return b.ucs.length - a.ucs.length;
    return a.phase - b.phase;
  });
  return groups;
}

/** Inverse index: for each UC id, return its cross-industry group (if any).
 *  Used to badge individual cards with "appears in N packs" hints. */
export function buildCrossIndustryIndex(industryIds: string[]): Map<string, CrossIndustryGroup> {
  const groups = getCrossIndustryGroups(industryIds);
  const index = new Map<string, CrossIndustryGroup>();
  for (const g of groups) for (const uc of g.ucs) index.set(uc.id, g);
  return index;
}
