import { USE_CASES_GEN } from './useCases.generated';
import type { ComplexityScoring } from './complexityRubric';
import type { ValueModel } from './businessValue';

export interface KpiImpact {
  kpi: string;
  delta: number;
  unit: string;
}

export interface ComplexityFactor {
  /** Short label, e.g. "Data integration breadth" */
  factor: string;
  /** 1-5 — how much this factor pushes complexity up. */
  weight: number;
  /** One sentence explaining the score for this factor. */
  rationale: string;
}

export interface UseCase {
  id: string;
  /** Industry the use case belongs to (e.g. 'pu', 'tl'). Used to filter the
   *  catalog when the deploy hosts more than one industry pack. */
  industryId?: string;
  name: string;
  phase: number;
  domain: string;
  category: string;
  description: string;
  dataRequirements: string[];
  systemPrerequisites: string[];
  businessValue: string[];
  complexity: number;
  /** Structured rubric. When `mode === 'derived'`, the displayed `complexity`
   *  is computed from the rubric (admin can flip to 'manual' to override). */
  complexityScoring?: ComplexityScoring;
  /** Per-factor breakdown of why complexity is what it is. (Display-only.) */
  complexityFactors?: ComplexityFactor[];
  /** Databricks-specific products / features required, using current names. */
  databricksPrereqs?: string[];
  /** Continuous 0..1 radial-position score on the Blast Radius — combines
   *  complexity, dependency depth, capability breadth, ML maturity,
   *  streaming, IT/OT, time-to-value (push-outward) and business-value
   *  (pull-inward). 0 = innermost (do now), 1 = outermost (aspirational). */
  horizonScore?: number;
  /** Admin-editable Quantified Annual Value formula. When set, drives the
   *  $-figure shown on the use case detail card. When absent, the app falls
   *  back to a hard-coded formula (~50 use cases) or a phase/complexity
   *  generic estimate. */
  valueModel?: ValueModel;
  timeToValue: string;
  dependencies: string[];
  tags: string[];
  referenceCustomers: string[];
  utilityTypes?: string[];
  /** Strategic-priority values this UC delivers against (e.g. `reliability`,
   *  `cost_reduction`). When populated, the Executive Summary's per-priority
   *  rollup picks the UC up automatically. Falls back to a hardcoded P&U map
   *  when absent so existing P&U UCs continue to roll up correctly. */
  strategicPriorities?: string[];
  kpiImpact: KpiImpact[];
  /** Partner / Databricks-built assets per type. Auto-populated from
   *  artifacts seed at catalog-gen time. Surface as "accelerator available"
   *  badges in the roadmap and as candidates for SI-delivered work. */
  partnerAssets?: {
    accelerator?: { title: string; url: string; description: string }[];
    brickbuilder?: { title: string; url: string; description: string }[];
    partner?: { title: string; url: string; description: string }[];
  };
  /** Admin-overridden partner / SI cost estimate in $M (one-time fee).
   *  When set, replaces the formula-derived `complexity × cost-per-cx-pt`
   *  default in the strategic roadmap and the deck's "investment" panel.
   *  Lets engagements quote known partner SOW values per UC. */
  partnerCostEstimateMM?: number;
  /** When `applyAccelerators` is on in the strategic roadmap, UCs that have
   *  a linked accelerator are delivered faster. This is the fractional
   *  reduction in effective complexity (and therefore time-in-bucket).
   *  Range 0-0.8; default 0.4 (40% acceleration) when accelerator is present
   *  and no admin override is set. Lets engagements tune per-accelerator
   *  acceleration strength. */
  acceleratorTimeReductionPct?: number;
}

// ─── Domain + phase metadata ────────────────────────────────────────────────
// These are now industry-driven via the active industry pack. We keep a
// proxy at module level so existing imports of DOMAIN_NAMES / PHASE_NAMES
// keep working — values get replaced when setActiveIndustry() is called at
// app boot. Cross-component re-renders happen via useActiveIndustry() in
// places that subscribe; immediate consumers that import directly will get
// the latest values on next render.
import { getActiveIndustry } from '../industries/active';

function _domainsFromActive(): string[] {
  const ind = getActiveIndustry();
  return ind.domains && ind.domains.length > 0
    ? ind.domains
    : ['Generation', 'Transmission', 'Distribution', 'Customer', 'Regulatory', 'Corporate Services'];
}

/** Active industry's domain list. Read on every access so it's always
 *  consistent with the active industry pack. Cast to a tuple-like type for
 *  legacy consumers — most just use it as `string[]`. */
export const DOMAIN_NAMES: readonly string[] = new Proxy([] as string[], {
  get(_t, prop) {
    const arr = _domainsFromActive();
    if (prop === 'length') return arr.length;
    if (typeof prop === 'string' && /^\d+$/.test(prop)) return arr[Number(prop)];
    if (prop === Symbol.iterator) return arr[Symbol.iterator].bind(arr);
    return (arr as any)[prop];
  },
  has(_t, prop) {
    const arr = _domainsFromActive();
    if (typeof prop === 'string' && /^\d+$/.test(prop)) return Number(prop) < arr.length;
    return prop in arr;
  },
}) as readonly string[];

export type DomainName = string;

// Color palette assigned positionally to whatever domains the active pack
// declares — first domain gets amber, second blue, etc. Stable per-pack
// because the pack ordering is stable. Lookup falls back to grey when a
// domain string isn't in the active pack (e.g. legacy data).
const _DOMAIN_COLOR_PALETTE = ['#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#EC4899', '#06B6D4', '#A855F7'];

export const DOMAIN_COLORS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_t, prop) {
    if (typeof prop !== 'string') return undefined;
    const arr = _domainsFromActive();
    const idx = arr.indexOf(prop);
    if (idx >= 0) return _DOMAIN_COLOR_PALETTE[idx % _DOMAIN_COLOR_PALETTE.length];
    return '#6B7280';
  },
  ownKeys() { return _domainsFromActive(); },
  getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
});

export const PHASE_NAMES: Record<number, string> = new Proxy({} as Record<number, string>, {
  get(_t, prop) {
    const ind = getActiveIndustry();
    const phases = (ind.phases as any) || {};
    const key = String(prop);
    if (phases[key]) return phases[key];
    // Fallback to the original P&U phase names so legacy P&U deploys don't
    // change behavior when the pack doesn't supply phases.
    return ({
      '0': 'Pre-Foundation',
      '1': 'Operational Transparency',
      '2': 'Proactive Optimization',
      '3': 'Mitigate Risk & Unplanned O&M',
    } as any)[key];
  },
});

export const PHASE_TIMEFRAMES: Record<number, string> = {
  0: 'Immediate priority',
  1: 'Months 0–12',
  2: 'Months 6–24',
  3: 'Months 18–48',
};

export const PHASE_DESCRIPTIONS: Record<number, string> = {
  0: 'Your organization has not yet established foundational data integration. The most critical first step is building a unified, governed data platform and integrating core operational data sources (SCADA, AMI, SAP/ERP, GIS). Utilities that skip foundational work see success rates below 25% on advanced use cases.',
  1: 'You are in the Operational Transparency phase — establishing foundational data integration, visibility, and descriptive/diagnostic analytics. These use cases focus on consolidating siloed data into unified views and building the first layer of predictive models. They share common data infrastructure requirements (AMI, SCADA, GIS, OMS, CIS) and produce the clean, historized datasets that Phase 2 and 3 use cases depend on.',
  2: 'You are in the Proactive Optimization phase — moving from visibility to action with optimization, simulation, and proactive intervention. These use cases build on Phase 1\'s clean data and foundational models to enable "what-if" analysis, automated recommendations, and cross-system optimization. They require more sophisticated ML/AI models, digital twins, and tighter IT/OT integration.',
  3: 'You are in the Mitigate Risk & Unplanned O&M phase — the leading edge of utility data maturity. Autonomous and semi-autonomous systems, digital twins at scale, and AI-driven decision-making that closes the loop from insight to action. These use cases require mature data foundations, validated Phase 1-2 models, organizational trust in AI, and advanced engineering.',
};

export const PHASE_COLORS: Record<number, string> = {
  0: '#6B7280',
  1: '#1E90FF',
  2: '#00C896',
  3: '#FFB800',
};

export function getUseCaseById(id: string, industryId?: string | null): UseCase | undefined {
  // industryId is optional for callers that already trust UC ids are globally
  // unique (the catalog generator enforces this). Pass it explicitly when
  // you want a defensive scope — e.g. when resolving a UC referenced from a
  // saved assessment that knows its industry.
  if (!industryId) return USE_CASES.find(uc => uc.id === id);
  return USE_CASES.find(uc => uc.id === id && (!uc.industryId || uc.industryId === industryId));
}

export const USE_CASES: UseCase[] = USE_CASES_GEN;
