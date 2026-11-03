/**
 * Strategic 3- or 5-year roadmap sequencer.
 *
 * Takes the assessment answers + scored recommendations and produces a
 * deterministic, dependency-respecting time-bucketed plan covering ALL eligible
 * use cases (not just the top 10 readiness picks).
 *
 * Bucketing:
 *   3yr horizon → 6 half-year buckets
 *   5yr horizon → 10 half-year buckets
 *
 * Sequencing rules (in priority order):
 *   1. A UC's `dependencies` must be in earlier buckets OR already completed.
 *   2. Phase preference: phase 1 leads, phase 2 mid, phase 3 later (soft).
 *   3. Within a bucket, sort by readinessScore (high → low) once dependencies
 *      are satisfied.
 *   4. Per-bucket capacity scales by complexity — a complexity-5 UC consumes
 *      more capacity than a complexity-1 UC. Default budget per bucket is 6
 *      complexity-points; UCs are placed until budget is exhausted.
 *
 * Anything that doesn't fit in the horizon goes to `unscheduledUseCaseIds`.
 */

import { AssessmentAnswers, useCaseMatchesUtility } from './questions';
import { USE_CASES, UseCase } from './useCases';
import {
  computeRecommendations,
  getCompletedUseCases,
  effectiveComplexity,
  RecommendedUseCase,
} from './scoring';
import {
  BusinessAssumptions,
  computeUseCaseValue,
  DEFAULT_ASSUMPTIONS,
} from './businessValue';

export type Horizon = 3 | 5;

/**
 * Capacity model — translates $ investment into delivery throughput.
 *
 * Baseline (no extra investment): the customer's own team can deliver
 * BASELINE_CAPACITY_POINTS_PER_HALF complexity-points of work per half-year.
 * This anchors to a typical mid-size utility data team running 2-3 concurrent
 * data/AI workstreams (one complexity-3 + one complexity-1, or three cx-2's).
 *
 * Investment translation:
 *   $CAPACITY_COST_PER_POINT_M of incremental annual SI / partner / contractor
 *   spend buys one complexity-point of additional throughput per half-year.
 *
 * The default ($0.4M / cx-pt-per-half = $0.8M / cx-pt-per-year) anchors to a
 * realistic blended SI engagement: ~$200k per FTE per 6 months at typical
 * lakehouse-implementation rates, with one FTE producing roughly 1 cx-point
 * of completed work per half (i.e. one complexity-1 UC end-to-end, or part
 * of a higher-cx UC).
 *
 * These defaults are admin-overridable via app config keys:
 *   STRATEGIC_ROADMAP_BASELINE_CAPACITY_PER_HALF
 *   STRATEGIC_ROADMAP_CAPACITY_COST_PER_POINT_M
 */
export const BASELINE_CAPACITY_POINTS_PER_HALF = 6;
export const CAPACITY_COST_PER_POINT_M = 0.4;

export interface CapacityModel {
  baselineCapacityPerHalf: number;
  capacityCostPerPointM: number;
}

export const DEFAULT_CAPACITY_MODEL: CapacityModel = {
  baselineCapacityPerHalf: BASELINE_CAPACITY_POINTS_PER_HALF,
  capacityCostPerPointM: CAPACITY_COST_PER_POINT_M,
};

/** Convert annual investment $M into added capacity points per half. */
export function investmentToCapacity(investmentMPerYear: number, model: CapacityModel = DEFAULT_CAPACITY_MODEL): number {
  if (investmentMPerYear <= 0) return 0;
  // $X/year invested → $X/2 per half-year → divided by cost-per-point-per-half.
  return (investmentMPerYear / 2) / model.capacityCostPerPointM;
}

/** Inverse — what does N extra capacity points per half cost annually? */
export function capacityToInvestment(extraPointsPerHalf: number, model: CapacityModel = DEFAULT_CAPACITY_MODEL): number {
  return extraPointsPerHalf * model.capacityCostPerPointM * 2;
}

/**
 * Team-maturity → throughput multiplier.
 *
 * Two-layer model:
 *   1. **Baseline-level**: sponsorship is the only multiplier applied to the
 *      flat `baselineCapacityPerHalf`. It's an enabling factor (clears
 *      blockers, funds tooling) that affects the whole program rather than
 *      any one UC. sponsorship ≤ 2 → ×0.9, sponsorship ≥ 4 → ×1.1.
 *   2. **Per-UC**: the in-house cx-pt cost of each UC is adjusted by how well
 *      the customer's data-eng / data-sci / cloud-infra capabilities line up
 *      with what that specific UC actually demands. A heavy-ML UC against a
 *      weak DS team consumes more cx-pts than the flat catalog number
 *      suggests; an integration-heavy UC against a strong DE team consumes
 *      less. See `customerEffortPoints()` below.
 *
 * Earlier versions of this model used an averaged-capability "delivery
 * multiplier" applied to the baseline. That double-counted with the new
 * per-UC adjustment, so it's been removed. `deliveryCapabilityAvg` is kept
 * on the breakdown for display purposes only.
 */
export interface TeamMaturityBreakdown {
  deliveryCapabilityAvg: number;    // 1..5  — display only
  dataEng: number;                  // 1..5  — display only
  dataSci: number;                  // 1..5  — display only
  cloudInfra: number;               // 1..5  — display only
  sponsorshipScore: number;         // 1..5
  sponsorshipMultiplier: number;    // 0.9..1.1
  totalMultiplier: number;          // = sponsorshipMultiplier (kept for back-compat with consumers)
  rationale: string;
}

export function deriveTeamMaturity(answers: AssessmentAnswers): TeamMaturityBreakdown {
  const c = answers.capabilities;
  const dEng = c.dataEngineering ?? 3;
  const dSci = c.dataScience ?? 3;
  const dCloud = c.cloudInfra ?? 3;
  const sponsor = c.executiveSponsorship ?? 3;
  const deliveryAvg = (dEng + dSci + dCloud) / 3;

  const sponsorshipMultiplier = sponsor <= 2 ? 0.9 : sponsor >= 4 ? 1.1 : 1.0;

  let rationale = '';
  if (deliveryAvg >= 4) rationale = `Mature delivery team (DE ${dEng}, DS ${dSci}, Cloud ${dCloud}).`;
  else if (deliveryAvg >= 3) rationale = `Solid delivery team (DE ${dEng}, DS ${dSci}, Cloud ${dCloud}).`;
  else if (deliveryAvg >= 2) rationale = `Early-stage team (DE ${dEng}, DS ${dSci}, Cloud ${dCloud}).`;
  else rationale = `Limited in-house delivery capability (DE ${dEng}, DS ${dSci}, Cloud ${dCloud}).`;
  if (sponsor >= 4) rationale += ' Strong executive sponsorship accelerates decision velocity.';
  else if (sponsor <= 2) rationale += ' Weak sponsorship slows decision velocity.';
  rationale += ' Per-UC cost reflects how well each capability matches the UC’s actual work mix.';

  return {
    deliveryCapabilityAvg: +deliveryAvg.toFixed(2),
    dataEng: dEng,
    dataSci: dSci,
    cloudInfra: dCloud,
    sponsorshipScore: sponsor,
    sponsorshipMultiplier,
    totalMultiplier: sponsorshipMultiplier,
    rationale,
  };
}

// ── Per-UC component mix + customer-effort adjustment ─────────────────────
//
// A UC's catalog complexity (cx-pts) is a flat number, but in reality the
// effort splits across data engineering, data science, and cloud / platform
// infrastructure work. We derive that split from the UC's rubric when
// present, then scale each role's slice by how skilled the customer is in
// that role. The output is the cx-pts THIS customer's in-house team will
// burn on the UC.

export interface UcComponentMix {
  dataEng: number;
  dataSci: number;
  cloudInfra: number;
}

const ML_SCORE_LOCAL: Record<string, number> = { none: 1, classical: 3, genai: 4, agentic: 5 };
const IT_OT_SCORE_LOCAL: Record<string, number> = { none: 1, some: 3, heavy: 5 };

function countBin(n: number, t1: number, t2: number, t3: number, t4: number): number {
  if (n <= t1) return 1;
  if (n <= t2) return 2;
  if (n <= t3) return 3;
  if (n <= t4) return 4;
  return 5;
}

/** Decompose a UC's effort across DE / DS / Cloud-infra. Sums to 1.0.
 *  Rubric-driven when the UC has a complexity rubric (the catalog-default
 *  path); falls back to keyword heuristics otherwise. */
export function getUcComponentMix(uc: UseCase): UcComponentMix {
  const r = uc.complexityScoring?.rubric;
  if (r) {
    // Each rubric factor maps to a primary role. Weights tuned so an
    // integration-heavy UC lands ~60% DE, a heavy-ML UC lands ~45% DS, and a
    // sub-minute streaming UC lands ~50/40 DE/Cloud.
    const deRaw =
      countBin(r.dataSourceCount, 1, 3, 5, 7) * 2.0 +     // data integration breadth
      countBin(r.systemCount, 1, 2, 4, 6) * 1.5 +         // upstream/downstream systems
      (r.streamingRequired ? 4 : 1) * 1.0;                // streaming pipeline build-out
    const dsRaw =
      (ML_SCORE_LOCAL[r.mlMaturity] || 1) * 3.0;          // ML/AI work
    const cloudRaw =
      (IT_OT_SCORE_LOCAL[r.itOtCrossings] || 1) * 1.5 +   // OT crossings, networking, security
      countBin(r.dbxCapabilityCount, 3, 5, 7, 9) * 1.0 +  // platform-product breadth
      (r.streamingRequired ? 4 : 1) * 0.5;                // streaming partly cloud-infra
    const total = deRaw + dsRaw + cloudRaw || 1;
    return {
      dataEng: +(deRaw / total).toFixed(3),
      dataSci: +(dsRaw / total).toFixed(3),
      cloudInfra: +(cloudRaw / total).toFixed(3),
    };
  }
  // Fallback heuristic for manual-complexity UCs without a rubric.
  const haystack = (uc.name + ' ' + (uc.description || '') + ' ' + (uc.tags || []).join(' ')).toLowerCase();
  const isML = /\b(ml|ai|llm|genai|predict|forecast|model|classif|segment(ation)?|nlp|agent|copilot|recommendation)\b/.test(haystack);
  const isStreaming = /\b(streaming|real[\s-]?time|sub[\s-]?minute|latency|event)\b/.test(haystack);
  const isPlatformy = /\b(catalog|governance|security|iam|identity|platform|infra|landing\s*zone)\b/.test(haystack);
  if (isML) return { dataEng: 0.35, dataSci: 0.45, cloudInfra: 0.20 };
  if (isStreaming) return { dataEng: 0.50, dataSci: 0.10, cloudInfra: 0.40 };
  if (isPlatformy) return { dataEng: 0.30, dataSci: 0.05, cloudInfra: 0.65 };
  return { dataEng: 0.60, dataSci: 0.15, cloudInfra: 0.25 };
}

/** Skill multiplier — how much MORE (or less) effort the customer spends on
 *  one cx-pt of work in this role given their stated capability. */
function skillEffortMultiplier(score: number): number {
  // Anchors:
  //   capability 5 → ×0.70 (this team ships fast in this role)
  //   capability 4 → ×0.85
  //   capability 3 → ×1.00 (model anchor)
  //   capability 2 → ×1.25
  //   capability 1 → ×1.55 (this team will struggle in this role)
  if (score >= 5) return 0.70;
  if (score >= 4) return 0.85;
  if (score >= 3) return 1.00;
  if (score >= 2) return 1.25;
  return 1.55;
}

/** Customer-specific cx-pt cost for a UC, factoring how well each of the
 *  customer's three delivery capabilities lines up with what this UC's work
 *  actually demands. Returns ≥ 1 cx-pt. */
export function customerEffortPoints(uc: UseCase, answers: AssessmentAnswers, baseCx: number): number {
  const mix = getUcComponentMix(uc);
  const c = answers.capabilities;
  const m =
    mix.dataEng * skillEffortMultiplier(c.dataEngineering ?? 3) +
    mix.dataSci * skillEffortMultiplier(c.dataScience ?? 3) +
    mix.cloudInfra * skillEffortMultiplier(c.cloudInfra ?? 3);
  return Math.max(1, +(baseCx * m).toFixed(2));
}

/** Display helper — describe the cost adjustment in one short clause. */
export function describeEffortAdjustment(uc: UseCase, answers: AssessmentAnswers, baseCx: number): string {
  const mix = getUcComponentMix(uc);
  const c = answers.capabilities;
  const adjusted = customerEffortPoints(uc, answers, baseCx);
  const delta = adjusted / baseCx;
  const dominant: 'dataEng' | 'dataSci' | 'cloudInfra' =
    mix.dataSci > mix.dataEng && mix.dataSci > mix.cloudInfra ? 'dataSci'
    : mix.cloudInfra > mix.dataEng ? 'cloudInfra'
    : 'dataEng';
  const roleLabel = dominant === 'dataEng' ? 'data engineering'
    : dominant === 'dataSci' ? 'data science'
    : 'cloud / platform';
  const roleScore = dominant === 'dataEng' ? (c.dataEngineering ?? 3)
    : dominant === 'dataSci' ? (c.dataScience ?? 3)
    : (c.cloudInfra ?? 3);
  if (Math.abs(delta - 1) < 0.05) {
    return `Effort matches the catalog estimate — ${Math.round(mix[dominant] * 100)}% ${roleLabel} (score ${roleScore}/5).`;
  }
  if (delta > 1.05) {
    return `+${Math.round((delta - 1) * 100)}% effort — ${Math.round(mix[dominant] * 100)}% ${roleLabel} work, team at ${roleScore}/5.`;
  }
  return `−${Math.round((1 - delta) * 100)}% effort — ${Math.round(mix[dominant] * 100)}% ${roleLabel} work, team at ${roleScore}/5.`;
}

export interface RoadmapUseCase {
  id: string;
  name: string;
  domain: string;
  category: string;
  phase: number;
  complexity: number;          // effective complexity (rubric-derived)
  timeToValue: string;
  annualValueLowMM: number;
  annualValueHighMM: number;
  readinessScore: number;
  unmetDependenciesAtPlacement: string[]; // ids — should be empty by construction
  reason: string;              // why placed here
  hasAccelerator: boolean;     // Databricks solution accelerator exists for this UC
  hasBrickbuilder: boolean;    // Databricks Brickbuilder solution exists
  hasPartner: boolean;         // SI / consulting partner asset exists
  isSiDelivered: boolean;      // user-flagged: delivered by SI partner, not in-house team
  /** Estimated SI fee for this UC if delivered by partner. Scales with complexity. */
  siCostMM: number;
  /** True when "Apply accelerators" was on AND this UC had an accelerator
   *  or brickbuilder available. Drives the visible "accelerated" badge on
   *  the UC card so the user can see what the toggle actually did. */
  acceleratorApplied: boolean;
  /** When accelerated, the original (pre-reduction) effective complexity.
   *  Useful for "was N, now M" UI annotations. */
  baseComplexity: number;
  /** Customer-specific in-house cx-pt cost for this UC. Differs from the
   *  flat catalog `complexity` when the UC's component mix (DE/DS/Cloud)
   *  doesn't match the customer's team strengths. Equal to `complexity`
   *  when SI-delivered (SI throughput is treated as flat). */
  customerEffortPoints: number;
  /** Component-mix breakdown for this UC — fraction of work attributed to
   *  data engineering / data science / cloud-infra. Sums to ~1.0. Drives
   *  the per-UC throughput adjustment + the tooltip explanation. */
  componentMix: { dataEng: number; dataSci: number; cloudInfra: number };
  /** Short natural-language explanation of why customerEffortPoints differs
   *  from complexity. Empty when no meaningful delta. */
  effortAdjustmentReason: string;
}

export interface RoadmapBucket {
  index: number;               // 0-based
  label: string;               // "H1 Yr 1", "H2 Yr 3"
  yearLabel: string;           // "Year 1", "Year 3"
  useCases: RoadmapUseCase[];
  cumulativeValueLowMM: number;
  cumulativeValueHighMM: number;
  themes: string[];            // top domains by count
}

export interface StrategicRoadmap {
  horizonYears: Horizon;
  buckets: RoadmapBucket[];
  totalAnnualValueLowMM: number;
  totalAnnualValueHighMM: number;
  unscheduledUseCaseIds: string[];
  scheduledCount: number;
  eligibleCount: number;
  generatedAt: string;
  // Capacity context — surfaced so UI can show the investment story.
  /** What a "typical" mid-maturity utility team delivers per half (admin-tuned). */
  configuredBaselineCapacityPerHalf: number;
  /** Maturity-adjusted baseline = configured × team maturity multiplier. */
  baselineCapacityPerHalf: number;
  /** Team maturity breakdown (drives the multiplier). */
  teamMaturity: TeamMaturityBreakdown;
  /** Extra capacity from $ investment (SI / partners / contractors). */
  extraCapacityPerHalf: number;
  investmentMPerYear: number;
  capacityCostPerPointM: number;
  /** Total effective capacity per half = baseline + extra. */
  totalCapacityPerHalf: number;
  /** Sum of SI fees across all UCs flagged isSiDelivered, over horizon. */
  siProgramCostTotalM: number;
  /** Count of UCs flagged for SI delivery. */
  siDeliveredCount: number;
  /** When set, this roadmap is scoped to a single Line of Business. */
  lobFilter: string | null;
  /** Dependencies on UCs OUTSIDE the LOB filter that the customer's other
   *  teams will need to deliver in parallel for this LOB roadmap to land
   *  on schedule. Only populated when lobFilter is set. */
  externalDependencies: { id: string; name: string; domain: string; dependedOnBy: string[] }[];
  /** Anchors that were applied to this run, with their resolved bucket index
   *  (-1 = before horizon, totalBuckets = after horizon). */
  resolvedAnchors: { anchor: ExternalAnchor; bucketIdx: number }[];
  /** Anchors whose constraint could not be satisfied — UCs that should have
   *  landed before the anchor date didn't fit, or had unmet deps that pushed
   *  them past it. */
  anchorViolations: AnchorViolation[];
  /** ISO yyyy-mm-dd that bucket 0 starts on. */
  startDate: string;
}
// (Removed earlier hard phase-window: it was pushing top-ranked phase-2/3
// UCs out of bucket 0 even when they were the customer's #1 readiness pick.
// The recommendation algorithm already encodes phase-preference via
// `phaseBonus` inside readinessScore — letting that drive ordering plus
// the dependency constraint produces a coherent sequence without arbitrary
// hard windows.)

export interface RoadmapOptions {
  /** Extra capacity per half-year on top of baseline (e.g. SI engagement). */
  extraCapacityPerHalf?: number;
  /** Override the capacity model (admin-configurable). */
  capacityModel?: CapacityModel;
  /** Use case IDs the user flagged as SI-delivered. Those UCs run on a parallel
   *  partner workstream — they don't consume in-house capacity, they're scheduled
   *  in the earliest bucket where their dependencies are met, and they cost a
   *  per-UC SI fee scaled by complexity. */
  siDeliveredUseCaseIds?: string[];
  /** Optional Line-of-Business filter (e.g. "Distribution"). When set, only
   *  UCs in that LOB enter the eligible pool — other LOBs' UCs become "external
   *  prerequisites" assumed-handled by the enterprise team. Used to produce
   *  per-LOB drill-down roadmaps for a director-level conversation. */
  lobFilter?: string | null;
  /** External date anchors that constrain the schedule (rate cases, regulatory
   *  deadlines, storm season prep, vendor EOL, board milestones, etc.).
   *  When set, the sequencer respects "must_complete_before" and "must_start_before"
   *  hardness levels. Anchor violations are reported as `anchorViolations[]` on
   *  the result so the UI can surface them. */
  anchors?: ExternalAnchor[];
  /** Bucket-zero start date (ISO yyyy-mm-dd). Used to translate anchor dates to
   *  bucket indexes. Defaults to today. */
  startDate?: string;
  /** When true, every UC with a linked accelerator is delivered faster
   *  (effective complexity is reduced by its `acceleratorTimeReductionPct`
   *  or the default below). This is the bulk "Apply Accelerators" toggle —
   *  replaces per-UC selection in the UI. */
  applyAccelerators?: boolean;
  /** Default fractional reduction applied to a UC's complexity when an
   *  accelerator is present and the UC doesn't carry its own override.
   *  Range 0-0.8; admin-configurable; defaults to 0.4 (40% faster). */
  defaultAcceleratorReductionPct?: number;
}

export type AnchorType =
  | 'rate_case'
  | 'regulatory_deadline'
  | 'storm_season'
  | 'seasonal_peak'
  | 'vendor_eol'
  | 'board_milestone'
  | 'other';

export type AnchorHardness =
  | 'must_complete_before'  // every constrained UC must finish by this date
  | 'must_start_before'     // every constrained UC must be in flight by this date
  | 'informational';         // shown on the timeline but does not constrain placement

export interface ExternalAnchor {
  id: string;                       // client-generated stable id
  label: string;                    // human-readable ("Rate case filing")
  type: AnchorType;
  date: string;                     // ISO yyyy-mm-dd
  hardness: AnchorHardness;
  /** When set, the constraint applies only to these UC ids. */
  ucIds?: string[];
  /** When set, the constraint applies to every UC whose `domain` matches. */
  domain?: string | null;
  /** Free-text rationale, surfaced as a tooltip / in the deck. */
  notes?: string;
}

export interface AnchorViolation {
  anchor: ExternalAnchor;
  reason: string;
  affectedUcIds: string[];
}

/** Per-UC SI fee. Anchored to typical lakehouse-implementation rates: a
 *  complexity-1 UC = ~$300k, complexity-3 = ~$0.9M, complexity-5 = ~$2M.
 *  Adjustable via the capacity model in admin config (capacityCostPerPointM). */
function siCostForUseCase(complexity: number, model: CapacityModel): number {
  // 1 cx-pt of in-house throughput per half costs `model.capacityCostPerPointM` ($M).
  // SI delivery of a complete cx-N UC takes ~N halves of dedicated capacity,
  // so SI fee ≈ N × model.capacityCostPerPointM. Round to 0.05M.
  const raw = complexity * model.capacityCostPerPointM;
  return Math.round(raw * 20) / 20;
}

export function buildStrategicRoadmap(
  answers: AssessmentAnswers,
  currentPhase: number,
  horizonYears: Horizon,
  assumptions?: BusinessAssumptions,
  opts: RoadmapOptions = {},
): StrategicRoadmap {
  const totalBuckets = horizonYears * 2; // half-year buckets
  const model = opts.capacityModel || DEFAULT_CAPACITY_MODEL;
  const startDate = opts.startDate || new Date().toISOString().slice(0, 10);

  // Translate an anchor date → bucket idx in [-1, totalBuckets]. -1 means the
  // date is already past; totalBuckets means it's beyond the horizon.
  const dateToBucketIdx = (iso: string): number => {
    const start = new Date(startDate + 'T00:00:00Z');
    const target = new Date(iso + 'T00:00:00Z');
    const monthsDiff =
      (target.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (target.getUTCMonth() - start.getUTCMonth());
    if (monthsDiff < 0) return -1;
    const bucket = Math.floor(monthsDiff / 6);
    return Math.min(totalBuckets, bucket);
  };

  const anchors = opts.anchors || [];
  const resolvedAnchors = anchors.map(a => ({ anchor: a, bucketIdx: dateToBucketIdx(a.date) }));
  const teamMaturity = deriveTeamMaturity(answers);
  // Baseline now only includes the program-level sponsorship multiplier.
  // Per-UC team-skill effects are applied per UC at placement time via
  // `customerEffortPoints` so a UC's component mix (DE/DS/Cloud) actually
  // shapes how much of THIS customer's capacity it consumes.
  const maturityAdjustedBaseline = +(model.baselineCapacityPerHalf * teamMaturity.sponsorshipMultiplier).toFixed(2);
  const extraCapacityPerHalf = Math.max(0, opts.extraCapacityPerHalf || 0);
  const totalCapacityPerHalf = maturityAdjustedBaseline + extraCapacityPerHalf;

  // 1. All scored recommendations (full list, not top 10).
  const completed = getCompletedUseCases(answers.currentUseCases.selectedUseCases);
  const allScored = computeRecommendations(answers, completed, currentPhase);
  const scoredById = new Map<string, RecommendedUseCase>();
  for (const r of allScored) scoredById.set(r.useCase.id, r);

  // 2. Eligible pool = matches utility, not completed, AND (if an LOB filter
  //    is set) belongs to that LOB. Cross-LOB dependencies are treated as
  //    "external prerequisites" — the dependency-resolution loop already
  //    auto-passes any dep that isn't in the eligible pool, which gives us
  //    the right semantics for a director-level drill-down.
  const utility = answers.profile.utilityType;
  const lobFilter = (opts.lobFilter || '').trim() || null;
  // Honor the same fine-tuning state as `computeRecommendations`: discarded +
  // out-of-scope UCs are excluded, operations-scope domains restrict the
  // catalog, industry / blend ids filter cross-pack noise, dependency edges
  // can be overridden, and bucket pins force placement.
  const refinements = answers.refinements || {};
  const hidden = new Set([
    ...(refinements.discardedUseCaseIds || []),
    ...(refinements.outOfScopeUseCaseIds || []),
  ]);
  const scope = answers.profile.operationsScope || [];
  // Back-compat: legacy assessments saved before the multi-industry refactor
  // have neither industryIds nor industryId set. Default those to ['pu'] so
  // non-P&U industry packs don't bleed into the roadmap. Matches the same
  // default in scoring.ts:getAssessmentIndustryIds.
  const profileIndustryIds: string[] = answers.profile.industryIds && answers.profile.industryIds.length > 0
    ? answers.profile.industryIds
    : (answers.profile.industryId ? [answers.profile.industryId] : ['pu']);
  const depOverrides = refinements.dependencyOverrides || {};
  const valueOverrides = refinements.valueOverrides || {};
  const bucketPins = refinements.bucketPins || {};

  const effectiveDeps = (uc: UseCase): string[] => {
    const override = depOverrides[uc.id];
    if (!override) return uc.dependencies || [];
    const removed = new Set(override.remove || []);
    const base = (uc.dependencies || []).filter(d => !removed.has(d));
    const added = (override.add || []).filter(d => !base.includes(d));
    return [...base, ...added];
  };

  const eligible = USE_CASES.filter(uc => {
    if (completed.has(uc.id)) return false;
    if (hidden.has(uc.id)) return false;
    if (!useCaseMatchesUtility(uc.utilityTypes, utility)) return false;
    if (lobFilter && uc.domain !== lobFilter) return false;
    if (scope.length > 0 && !scope.includes(uc.domain)) return false;
    if (profileIndustryIds && uc.industryId && !profileIndustryIds.includes(uc.industryId)) return false;
    return true;
  });

  // 3. Empty bucket scaffolding.
  const buckets: RoadmapBucket[] = Array.from({ length: totalBuckets }, (_, i) => ({
    index: i,
    label: `H${(i % 2) + 1} Yr ${Math.floor(i / 2) + 1}`,
    yearLabel: `Year ${Math.floor(i / 2) + 1}`,
    useCases: [],
    cumulativeValueLowMM: 0,
    cumulativeValueHighMM: 0,
    themes: [],
  }));

  // 3.5 Anchor constraints — for each UC, compute the latest bucket idx it can
  // land in. Default = totalBuckets-1 (anywhere in horizon). An anchor with
  // hardness=must_complete_before tightens this to its bucket idx. Multiple
  // anchors → take the min.
  const ucMaxBucket = new Map<string, number>();
  // Initialize with no constraint (=> last bucket).
  for (const uc of eligible) ucMaxBucket.set(uc.id, totalBuckets - 1);
  for (const { anchor, bucketIdx } of resolvedAnchors) {
    if (anchor.hardness !== 'must_complete_before' && anchor.hardness !== 'must_start_before') continue;
    if (bucketIdx < 0 || bucketIdx >= totalBuckets) continue;
    const targetIds = new Set<string>();
    if (anchor.ucIds && anchor.ucIds.length) {
      for (const id of anchor.ucIds) targetIds.add(id);
    }
    if (anchor.domain) {
      for (const uc of eligible) {
        if (uc.domain === anchor.domain) targetIds.add(uc.id);
      }
    }
    for (const id of targetIds) {
      const cur = ucMaxBucket.get(id);
      if (cur === undefined) continue;
      // must_complete_before: UC must finish IN bucketIdx or earlier.
      // must_start_before: same effect at bucket-granularity (we don't model
      // partial-bucket completion).
      ucMaxBucket.set(id, Math.min(cur, bucketIdx));
    }
  }

  // 4. Place use cases bucket-by-bucket.
  // SI-delivered UCs run on a parallel partner workstream and don't consume
  // in-house capacity. They're scheduled in the earliest bucket where their
  // dependencies are met. (We process them BEFORE in-house UCs in each pass
  // so deps lay down in the correct order.)
  const siSet = new Set(opts.siDeliveredUseCaseIds || []);
  const placedIds = new Set<string>(completed);
  const bucketBudgets = buckets.map(() => totalCapacityPerHalf);
  const remaining = new Set(eligible.map(u => u.id));
  let siProgramCostTotalM = 0;
  let siDeliveredCount = 0;

  const defaultAccelReduction = Math.max(0, Math.min(0.8,
    typeof opts.defaultAcceleratorReductionPct === 'number'
      ? opts.defaultAcceleratorReductionPct
      : 0.4
  ));
  const applyAccelerators = !!opts.applyAccelerators;

  const placeUseCase = (uc: UseCase, bucketIdx: number, isSi: boolean): void => {
    const baseCx = effectiveComplexity(uc, answers);
    const v = computeUseCaseValue(uc.id, assumptions || DEFAULT_ASSUMPTIONS, valueOverrides[uc.id]);
    const scored = scoredById.get(uc.id);
    const pa = uc.partnerAssets || {};
    const hasAccelerator = (pa.accelerator || []).length > 0;
    const hasBrickbuilder = (pa.brickbuilder || []).length > 0;
    const hasPartner = (pa.partner || []).length > 0;
    // Accelerator-driven complexity reduction: a UC with an accelerator + the
    // global "Apply Accelerators" toggle on gets a fractional time/complexity
    // cut. Per-UC override (`acceleratorTimeReductionPct`) beats the global
    // default. Clamp at 0.8 so even fully-templated work still consumes some
    // bucket capacity for integration + customer-side adaptation.
    // Both accelerators and brickbuilders give the customer ready-to-use
    // assets that cut implementation time. The toggle treats them as
    // equivalent so admins don't have to flip both.
    const hasReusableAsset = hasAccelerator || hasBrickbuilder;
    let cx = baseCx;
    let acceleratorApplied = false;
    if (applyAccelerators && hasReusableAsset) {
      const reduction = Math.max(0, Math.min(0.8,
        typeof uc.acceleratorTimeReductionPct === 'number'
          ? uc.acceleratorTimeReductionPct
          : defaultAccelReduction
      ));
      if (reduction > 0) {
        cx = Math.max(1, +(baseCx * (1 - reduction)).toFixed(2));
        acceleratorApplied = true;
      }
    }
    // Admin-set partner cost overrides the formula-derived fee per UC.
    const siCost = (typeof uc.partnerCostEstimateMM === 'number' && uc.partnerCostEstimateMM > 0)
      ? +uc.partnerCostEstimateMM.toFixed(2)
      : siCostForUseCase(cx, model);
    if (isSi) {
      siProgramCostTotalM += siCost;
      siDeliveredCount += 1;
    }
    // For in-house delivery, adjust the cx-pt cost by the customer's team
    // strength in the work this UC actually requires. SI delivery stays at
    // the flat `cx` (SI teams flex across roles, so no per-customer skew).
    const componentMix = getUcComponentMix(uc);
    const effortPoints = isSi ? cx : customerEffortPoints(uc, answers, cx);
    const adjustmentReason = isSi ? '' : describeEffortAdjustment(uc, answers, cx);
    buckets[bucketIdx].useCases.push({
      id: uc.id,
      name: uc.name,
      domain: uc.domain,
      category: uc.category || '',
      phase: uc.phase,
      complexity: cx,
      timeToValue: uc.timeToValue,
      annualValueLowMM: v.annualValueLowMM,
      annualValueHighMM: v.annualValueHighMM,
      readinessScore: scored?.readinessScore ?? 0,
      unmetDependenciesAtPlacement: [],
      reason: derivePlacementReason(uc, bucketIdx, totalBuckets, scored, placedIds, isSi, hasAccelerator, hasBrickbuilder),
      hasAccelerator,
      hasBrickbuilder,
      hasPartner,
      isSiDelivered: isSi,
      siCostMM: siCost,
      acceleratorApplied,
      baseComplexity: baseCx,
      customerEffortPoints: effortPoints,
      componentMix,
      effortAdjustmentReason: adjustmentReason,
    });
    placedIds.add(uc.id);
    remaining.delete(uc.id);
    if (!isSi) bucketBudgets[bucketIdx] -= effortPoints;
  };

  for (let b = 0; b < buckets.length; b++) {
    // Up to 3 placement passes per bucket so newly-placed UCs in this bucket
    // can satisfy dependents (still respects DAG order — same-bucket deps OK
    // only if the dependent is added after the dependency in this loop).
    for (let pass = 0; pass < 3; pass++) {
      let placedThisPass = 0;

      const baseCandidates = Array.from(remaining)
        .map(id => USE_CASES.find(u => u.id === id)!)
        .filter(uc => {
          const deps = effectiveDeps(uc);
          if (!deps.every(d => placedIds.has(d) || !eligible.find(e => e.id === d))) return false;
          // External anchor constraint: don't place a UC in a bucket later
          // than its anchor allows.
          const maxB = ucMaxBucket.get(uc.id);
          if (maxB !== undefined && b > maxB) return false;
          // Bucket pin constraint: if pinned to a bucket, only place there.
          const pin = bucketPins[uc.id];
          if (typeof pin === 'number' && pin !== b) return false;
          return true;
        });

      const sortFn = (a: UseCase, b2: UseCase) => {
        const ra = scoredById.get(a.id)?.readinessScore ?? 0;
        const rb = scoredById.get(b2.id)?.readinessScore ?? 0;
        if (rb !== ra) return rb - ra;
        if (a.phase !== b2.phase) return a.phase - b2.phase;
        return effectiveComplexity(a, answers) - effectiveComplexity(b2, answers);
      };

      // Pass A: SI-delivered first — no capacity check, only deps.
      const siCandidates = baseCandidates.filter(uc => siSet.has(uc.id)).sort(sortFn);
      for (const uc of siCandidates) {
        placeUseCase(uc, b, true);
        placedThisPass++;
      }

      // Pass B: in-house UCs, capacity-bounded.
      const inHouseCandidates = baseCandidates.filter(uc => !siSet.has(uc.id) && remaining.has(uc.id)).sort(sortFn);
      for (const uc of inHouseCandidates) {
        const cx = effectiveComplexity(uc, answers);
        if (bucketBudgets[b] >= cx) {
          placeUseCase(uc, b, false);
          placedThisPass++;
        }
      }
      if (placedThisPass === 0) break;
    }
  }

  // 5. Compute cumulative value + themes.
  let cumLow = 0;
  let cumHigh = 0;
  for (const bucket of buckets) {
    for (const uc of bucket.useCases) {
      cumLow += uc.annualValueLowMM;
      cumHigh += uc.annualValueHighMM;
    }
    bucket.cumulativeValueLowMM = +cumLow.toFixed(1);
    bucket.cumulativeValueHighMM = +cumHigh.toFixed(1);
    // Themes = top 2 domains by count.
    const counts = new Map<string, number>();
    for (const uc of bucket.useCases) counts.set(uc.domain, (counts.get(uc.domain) || 0) + 1);
    bucket.themes = Array.from(counts.entries())
      .sort((a, b2) => b2[1] - a[1])
      .slice(0, 2)
      .map(([d]) => d);
  }

  // Compute anchor violations — anchors whose constrained UCs didn't all
  // land before the deadline (either deferred beyond horizon, or scheduled
  // in a later bucket because deps pushed them past the constraint).
  const placedBucket = new Map<string, number>();
  for (let i = 0; i < buckets.length; i++) {
    for (const uc of buckets[i].useCases) placedBucket.set(uc.id, i);
  }
  const anchorViolations: AnchorViolation[] = [];
  for (const { anchor, bucketIdx } of resolvedAnchors) {
    if (anchor.hardness === 'informational') continue;
    if (bucketIdx < 0 || bucketIdx >= totalBuckets) continue;
    const targetIds = new Set<string>();
    if (anchor.ucIds?.length) for (const id of anchor.ucIds) targetIds.add(id);
    if (anchor.domain) for (const uc of eligible) if (uc.domain === anchor.domain) targetIds.add(uc.id);
    const violators: string[] = [];
    for (const id of targetIds) {
      const placed = placedBucket.get(id);
      if (placed === undefined) {
        // Wasn't scheduled within horizon at all.
        if (eligible.find(u => u.id === id)) violators.push(id);
      } else if (placed > bucketIdx) {
        violators.push(id);
      }
    }
    if (violators.length > 0) {
      anchorViolations.push({
        anchor,
        reason: `${violators.length} use case${violators.length === 1 ? '' : 's'} can't land before ${anchor.label} (${anchor.date}) at current capacity`,
        affectedUcIds: violators,
      });
    }
  }

  // Compute cross-LOB external dependencies — the prereqs this LOB's UCs
  // assume will be delivered by other lines of business / the enterprise team.
  // Only populated when a single LOB is selected.
  const externalDependencies: { id: string; name: string; domain: string; dependedOnBy: string[] }[] = [];
  if (lobFilter) {
    const externalById = new Map<string, { name: string; domain: string; dependedOnBy: Set<string> }>();
    const eligibleIds = new Set(eligible.map(u => u.id));
    for (const uc of eligible) {
      for (const depId of uc.dependencies || []) {
        if (eligibleIds.has(depId)) continue; // same-LOB dep — handled inline
        if (completed.has(depId)) continue;   // already done by customer
        const depUc = USE_CASES.find(u => u.id === depId);
        if (!depUc) continue;
        if (!externalById.has(depId)) {
          externalById.set(depId, { name: depUc.name, domain: depUc.domain, dependedOnBy: new Set() });
        }
        externalById.get(depId)!.dependedOnBy.add(uc.name);
      }
    }
    for (const [id, v] of externalById.entries()) {
      externalDependencies.push({ id, name: v.name, domain: v.domain, dependedOnBy: Array.from(v.dependedOnBy) });
    }
    externalDependencies.sort((a, b) => b.dependedOnBy.length - a.dependedOnBy.length);
  }

  return {
    horizonYears,
    buckets,
    totalAnnualValueLowMM: +cumLow.toFixed(1),
    totalAnnualValueHighMM: +cumHigh.toFixed(1),
    unscheduledUseCaseIds: Array.from(remaining),
    scheduledCount: placedIds.size - completed.size,
    eligibleCount: eligible.length,
    generatedAt: new Date().toISOString(),
    configuredBaselineCapacityPerHalf: model.baselineCapacityPerHalf,
    baselineCapacityPerHalf: maturityAdjustedBaseline,
    teamMaturity,
    extraCapacityPerHalf,
    investmentMPerYear: capacityToInvestment(extraCapacityPerHalf, model),
    capacityCostPerPointM: model.capacityCostPerPointM,
    totalCapacityPerHalf,
    siProgramCostTotalM: +siProgramCostTotalM.toFixed(2),
    siDeliveredCount,
    lobFilter,
    externalDependencies,
    resolvedAnchors,
    anchorViolations,
    startDate,
  };
}

/** Side-by-side comparison: baseline vs. invested. Surfaces the marginal
 *  ROI of additional spend in concrete terms (extra UCs shipped, cumulative
 *  $ uplift, time-to-value compression). */
export interface RoadmapComparison {
  baseline: StrategicRoadmap;
  invested: StrategicRoadmap;
  incrementalUseCases: number;
  incrementalAnnualValueLowMM: number;
  incrementalAnnualValueHighMM: number;
  incrementalInvestmentMPerYear: number;
  incrementalInvestmentTotalM: number; // over horizon
  /** Half-bucket index where invested first reaches the baseline's final
   *  cumulative value — i.e. how much earlier the same value is achieved. */
  bucketsAheadAtBaselineFinalValue: number | null;
  /** For every $1M invested over the horizon, $X of incremental annual
   *  run-rate value is unlocked. (Uses low-band figures conservatively.) */
  marginalValuePerInvestedDollar: number;
}

export function compareRoadmaps(
  baseline: StrategicRoadmap,
  invested: StrategicRoadmap,
): RoadmapComparison {
  const incUC = invested.scheduledCount - baseline.scheduledCount;
  const incLow = +(invested.totalAnnualValueLowMM - baseline.totalAnnualValueLowMM).toFixed(1);
  const incHigh = +(invested.totalAnnualValueHighMM - baseline.totalAnnualValueHighMM).toFixed(1);
  const incInvAnnual = +(invested.investmentMPerYear - baseline.investmentMPerYear).toFixed(2);
  const incInvTotal = +(incInvAnnual * invested.horizonYears).toFixed(2);

  // When does the invested track reach the baseline's final cumulative value?
  let bucketsAhead: number | null = null;
  const baselineFinal = baseline.totalAnnualValueLowMM;
  for (let i = 0; i < invested.buckets.length; i++) {
    if (invested.buckets[i].cumulativeValueLowMM >= baselineFinal) {
      bucketsAhead = (baseline.buckets.length - 1) - i;
      break;
    }
  }

  const marginalValuePerInvestedDollar = incInvTotal > 0
    ? +(incLow / incInvTotal).toFixed(2)
    : 0;

  return {
    baseline,
    invested,
    incrementalUseCases: incUC,
    incrementalAnnualValueLowMM: incLow,
    incrementalAnnualValueHighMM: incHigh,
    incrementalInvestmentMPerYear: incInvAnnual,
    incrementalInvestmentTotalM: incInvTotal,
    bucketsAheadAtBaselineFinalValue: bucketsAhead,
    marginalValuePerInvestedDollar,
  };
}

function derivePlacementReason(
  uc: UseCase,
  bucketIdx: number,
  totalBuckets: number,
  scored: RecommendedUseCase | undefined,
  placed: Set<string>,
  isSi: boolean,
  hasAccelerator: boolean,
  hasBrickbuilder: boolean,
): string {
  const deps = (uc.dependencies || []).filter(d => placed.has(d));
  const reasons: string[] = [];
  if (isSi) {
    reasons.push('SI-delivered — runs on partner workstream, parallel to in-house team');
  }
  if (bucketIdx === 0 && !isSi) {
    reasons.push('Quick win — prerequisites already in place');
  } else if (deps.length > 0) {
    reasons.push(`Unlocked by ${deps.length} preceding capabilit${deps.length === 1 ? 'y' : 'ies'}`);
  }
  if (scored && scored.priorityScore >= 20) reasons.push('Aligned with stated strategic priorities');
  if (hasBrickbuilder) reasons.push('Databricks Brickbuilder solution available');
  else if (hasAccelerator) reasons.push('Solution accelerator available');
  if (uc.phase === 3 && bucketIdx >= totalBuckets * 0.7) reasons.push('Phase 3 mature capability — sequenced after foundational work');
  if (reasons.length === 0) reasons.push('Builds toward future capabilities');
  return reasons.join('. ') + '.';
}
