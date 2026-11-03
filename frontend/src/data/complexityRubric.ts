// Use case complexity rubric — turns structured inputs into a 1-5 score so
// new entries are scored consistently across many authors.
//
// Variant (b): each use case can either DERIVE its complexity from the rubric
// or carry a MANUAL OVERRIDE. The 107 existing entries keep their hand-typed
// numbers (mode = 'manual') until someone flips them to 'derived' in the editor.

import type { UseCase } from './useCases';

export type ItOtCrossings = 'none' | 'some' | 'heavy';
export type MlMaturity = 'none' | 'classical' | 'genai' | 'agentic';
export type RegulatoryExposure = 'none' | 'internal' | 'external';

export interface ComplexityRubric {
  // Counts — author bumps these when adding/removing inputs. Each maps to a
  // 1-5 sub-score via fixed thresholds.
  dataSourceCount: number;
  systemCount: number;
  prereqUseCaseCount: number;
  dbxCapabilityCount: number;

  // Categorical
  itOtCrossings: ItOtCrossings;
  mlMaturity: MlMaturity;
  regulatoryExposure: RegulatoryExposure;

  // Yes/no
  streamingRequired: boolean;
  customerFacing: boolean;
  fieldOpsChange: boolean;
}

export type ComplexityMode = 'derived' | 'manual';

export interface ComplexityScoring {
  /** 'derived' = use rubric. 'manual' = honor the hand-typed `complexity`. */
  mode: ComplexityMode;
  /** Always present so admin can flip mode without losing the rubric. */
  rubric: ComplexityRubric;
}

// ── Sub-score mappings ──────────────────────────────────────────────────────

// Map a count to 1-5 using thresholds tuned for the existing catalog.
function countToScore(n: number, thresholds: [number, number, number, number]): number {
  if (n <= thresholds[0]) return 1;
  if (n <= thresholds[1]) return 2;
  if (n <= thresholds[2]) return 3;
  if (n <= thresholds[3]) return 4;
  return 5;
}

const DATA_THRESHOLDS:    [number, number, number, number] = [1, 3, 5, 7];   // dataSourceCount
const SYSTEM_THRESHOLDS:  [number, number, number, number] = [1, 2, 4, 6];   // systemCount
const PREREQ_THRESHOLDS:  [number, number, number, number] = [0, 1, 2, 3];   // prereqUseCaseCount
const DBX_THRESHOLDS:     [number, number, number, number] = [3, 5, 7, 9];   // dbxCapabilityCount

const IT_OT_SCORE: Record<ItOtCrossings, number> = { none: 1, some: 3, heavy: 5 };
const ML_SCORE:    Record<MlMaturity, number>    = { none: 1, classical: 3, genai: 4, agentic: 5 };
const REG_SCORE:   Record<RegulatoryExposure, number> = { none: 1, internal: 3, external: 5 };

// Each line: [label, weight, sub-score func]. Weights sum to ~14 — chosen so
// breadth of integration dominates but ML / streaming / regulatory still move
// the needle. Tunable; effects show live in the editor.
export interface RubricFactor {
  key: keyof ComplexityRubric;
  label: string;
  weight: number;
  detail: (r: ComplexityRubric) => string;
  score: (r: ComplexityRubric) => number;
}

export const RUBRIC_FACTORS: RubricFactor[] = [
  {
    key: 'dataSourceCount',
    label: 'Data integration breadth',
    weight: 2,
    detail: r => `${r.dataSourceCount} distinct data sources to land + clean`,
    score: r => countToScore(r.dataSourceCount, DATA_THRESHOLDS),
  },
  {
    key: 'systemCount',
    label: 'Upstream / downstream systems',
    weight: 2,
    detail: r => `${r.systemCount} systems must be touched (SCADA, GIS, OMS, EAM, CIS, ERP, …)`,
    score: r => countToScore(r.systemCount, SYSTEM_THRESHOLDS),
  },
  {
    key: 'itOtCrossings',
    label: 'IT / OT crossings',
    weight: 2,
    detail: r => ({ none: 'No OT crossings', some: 'A few OT touchpoints', heavy: 'Heavy OT integration' })[r.itOtCrossings],
    score: r => IT_OT_SCORE[r.itOtCrossings],
  },
  {
    key: 'mlMaturity',
    label: 'ML / AI maturity required',
    weight: 2,
    detail: r => ({
      none: 'No ML required',
      classical: 'Classical ML / forecasting',
      genai: 'GenAI / LLM workflow',
      agentic: 'Agentic / autonomous workflow',
    })[r.mlMaturity],
    score: r => ML_SCORE[r.mlMaturity],
  },
  {
    key: 'streamingRequired',
    label: 'Streaming / low-latency demands',
    weight: 1.5,
    detail: r => r.streamingRequired ? 'Sub-minute latency required' : 'Batch / micro-batch acceptable',
    score: r => r.streamingRequired ? 4 : 1,
  },
  {
    key: 'prereqUseCaseCount',
    label: 'Use case dependency depth',
    weight: 1.5,
    detail: r => `${r.prereqUseCaseCount} prerequisite use case(s) must be live first`,
    score: r => countToScore(r.prereqUseCaseCount, PREREQ_THRESHOLDS),
  },
  {
    key: 'dbxCapabilityCount',
    label: 'Databricks capability breadth',
    weight: 1,
    detail: r => `${r.dbxCapabilityCount} Databricks products / features required`,
    score: r => countToScore(r.dbxCapabilityCount, DBX_THRESHOLDS),
  },
  {
    key: 'regulatoryExposure',
    label: 'Regulatory exposure',
    weight: 1.5,
    detail: r => ({
      none: 'No regulator dependency',
      internal: 'Internal compliance / audit',
      external: 'Filings to external regulator (FERC, NERC, PUC, …)',
    })[r.regulatoryExposure],
    score: r => REG_SCORE[r.regulatoryExposure],
  },
  {
    key: 'fieldOpsChange',
    label: 'Field-ops change & adoption',
    weight: 1.5,
    detail: r => r.fieldOpsChange ? 'Field workforce process changes' : 'Back-office only',
    score: r => r.fieldOpsChange ? 4 : 2,
  },
  {
    key: 'customerFacing',
    label: 'Customer-facing surface',
    weight: 1,
    detail: r => r.customerFacing ? 'Customer-visible outputs (UI, comms)' : 'Internal-only',
    score: r => r.customerFacing ? 3 : 1,
  },
];

const TOTAL_WEIGHT = RUBRIC_FACTORS.reduce((s, f) => s + f.weight, 0);

// ── Public API ──────────────────────────────────────────────────────────────

export function deriveComplexity(rubric: ComplexityRubric): number {
  const weighted = RUBRIC_FACTORS.reduce((s, f) => s + f.score(rubric) * f.weight, 0);
  const raw = weighted / TOTAL_WEIGHT;
  return Math.max(1, Math.min(5, Math.round(raw)));
}

export interface RubricBreakdownRow {
  key: string;
  label: string;
  subScore: number;
  weight: number;
  detail: string;
}

export function rubricBreakdown(rubric: ComplexityRubric): RubricBreakdownRow[] {
  return RUBRIC_FACTORS.map(f => ({
    key: f.key as string,
    label: f.label,
    subScore: f.score(rubric),
    weight: f.weight,
    detail: f.detail(rubric),
  }));
}

/** Natural-language "why this complexity score?" explainer. Rubric-driven —
 *  pulls the highest-weighted contributing factors and writes a 1-paragraph
 *  rationale. Used by the experimental Score Explainer feature. */
export function explainComplexity(rubric: ComplexityRubric, displayedComplexity: number): string {
  const rows = rubricBreakdown(rubric);
  const contributions = rows
    .map(r => ({ ...r, contribution: r.subScore * r.weight }))
    .sort((a, b) => b.contribution - a.contribution);

  const top = contributions.slice(0, 3);
  const topPhrases = top.map(r => `${r.label.toLowerCase()} (${r.subScore}/5)`);
  const topClause =
    topPhrases.length === 3
      ? `${topPhrases[0]}, ${topPhrases[1]}, and ${topPhrases[2]}`
      : topPhrases.join(' and ');

  // Spotlight the most-driving detail line (highest contribution row).
  const spotlight = top[0];

  // Friction signals to call out where they apply.
  const callouts: string[] = [];
  if (rubric.mlMaturity === 'agentic') {
    callouts.push('autonomous / closed-loop control increases delivery risk + safety review needs');
  } else if (rubric.mlMaturity === 'genai') {
    callouts.push('GenAI workload requires evaluation + guardrails');
  } else if (rubric.mlMaturity === 'classical') {
    callouts.push('predictive ML adds MLOps overhead — feature engineering, monitoring, drift checks');
  }
  if (rubric.streamingRequired) {
    callouts.push('end-to-end latency requirements drive streaming / Spark Declarative Pipelines work');
  }
  if (rubric.itOtCrossings === 'heavy') {
    callouts.push('heavy IT/OT integration is the typical schedule risk on this kind of use case');
  }
  if (rubric.regulatoryExposure === 'external') {
    callouts.push('external regulator filing exposure adds review checkpoints');
  }

  const calloutLine = callouts.length ? ` ${callouts.join('; ')}.` : '';
  const lowFriction = contributions.filter(r => r.subScore <= 2).slice(0, 2);
  const lowLine = lowFriction.length
    ? ` On the easier side: ${lowFriction.map(r => r.label.toLowerCase()).join(' and ')} are low-friction here.`
    : '';

  return (
    `Complexity ${displayedComplexity}/5 is driven primarily by ${topClause}. ` +
    `${spotlight.detail}.${calloutLine}${lowLine}`
  );
}

/** Default rubric values — used as a starting point when an admin first opens
 *  the rubric for a use case that doesn't have one yet. We seed counts from
 *  whatever's already on the use case so the author isn't starting from zero. */
export function defaultRubricFromUseCase(uc: Pick<
  UseCase,
  'dataRequirements' | 'systemPrerequisites' | 'dependencies' | 'databricksPrereqs' | 'tags' | 'description' | 'name' | 'phase'
>): ComplexityRubric {
  const tags = (uc.tags || []).join(' ').toLowerCase();
  const text = `${tags} ${uc.name?.toLowerCase() || ''} ${uc.description?.toLowerCase() || ''}`;

  const hasAny = (kws: string[]) => kws.some(k => text.includes(k));

  let mlMaturity: MlMaturity = 'none';
  if (hasAny(['agent', 'autonomous', 'self-learning', 'agentic'])) mlMaturity = 'agentic';
  else if (hasAny(['llm', 'rag', 'genai', 'generative', 'co-pilot', 'copilot'])) mlMaturity = 'genai';
  else if (hasAny(['ml', 'machine learning', 'predictive', 'forecast', 'anomaly', 'optimization', 'twin'])) mlMaturity = 'classical';

  const streaming = hasAny(['streaming', 'real-time', 'real time', 'near-real', 'scada', 'ami', 'last-gasp']);

  let itOt: ItOtCrossings = 'none';
  if (hasAny(['scada', 'iot', 'ot ', 'historian', 'pi system', 'osi pi'])) itOt = 'heavy';
  else if (hasAny(['ami', 'meter', 'sensor', 'gis'])) itOt = 'some';

  let regulatory: RegulatoryExposure = 'none';
  if (hasAny(['ferc', 'nerc', 'puc', 'rate case', 'filings', 'regulator'])) regulatory = 'external';
  else if (hasAny(['compliance', 'audit', 'esg'])) regulatory = 'internal';

  const customerFacing = hasAny(['customer', 'self-service', 'billing', 'portal', 'engagement', 'marketplace']);
  const fieldOpsChange = hasAny(['outage', 'crew', 'work order', 'field', 'restoration', 'patrol', 'inspection', 'dispatch']);

  return {
    dataSourceCount: (uc.dataRequirements || []).length,
    systemCount: (uc.systemPrerequisites || []).length,
    prereqUseCaseCount: (uc.dependencies || []).length,
    dbxCapabilityCount: (uc.databricksPrereqs || []).length,
    itOtCrossings: itOt,
    mlMaturity,
    regulatoryExposure: regulatory,
    streamingRequired: streaming,
    customerFacing,
    fieldOpsChange,
  };
}
