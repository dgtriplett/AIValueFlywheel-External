// Assessment question definitions (4 steps: Profile → Infrastructure → Use Cases → Capabilities)

export type UtilityType =
  | 'electric'
  | 'gas'
  | 'electric_gas'
  | 'generation_only'
  | 'nuclear';
export type TerritorySize = 'small' | 'medium' | 'large' | 'very_large';
export type Geography = 'us' | 'canada' | 'europe' | 'australia' | 'other';
export type StrategicPriority =
  | 'reliability'
  | 'cost_reduction'
  | 'customer'
  | 'compliance'
  | 'revenue'
  | 'sustainability'
  | 'safety'
  | 'workforce';
export type YesNoPartial = 'yes' | 'no' | 'partial';

export interface CompanyProfile {
  companyName: string;
  /** Primary industry id selected for this assessment. For a single-pack
   *  assessment, this is just the pack id (e.g. "pu"). For a blended
   *  assessment, this is a synthetic id like "_blend:epc,pu,tl" and the
   *  authoritative pack list is in `industryIds`. */
  industryId?: string | null;
  /** Full list of pack ids in scope for the assessment. Set when the user
   *  picks a blend; equal to [industryId] for a single-pack assessment.
   *  Used by the scoring engine to filter use cases / data sources / etc. */
  industryIds?: string[] | null;
  utilityType: UtilityType | null;
  /** Fine-grained operations scope — the domains the customer actually
   *  operates in. Drawn from the active industry pack's `domains` list.
   *  Example: a network-only utility would tick Transmission +
   *  Distribution but not Generation, even though they're tagged
   *  electric_gas. When empty, no domain filter is applied (back-compat).
   *  Filters use cases by `uc.domain ∈ operationsScope` in scoring and
   *  every "visible UCs" path. Cross-cutting domains (Corporate Services,
   *  Regulatory) are always considered in scope when no scope is set, and
   *  remain selectable when scope is set. */
  operationsScope?: string[] | null;
  territorySize: TerritorySize | null;
  geography: Geography | null;
  strategicPriorities: StrategicPriority[];
}

export interface InfrastructureAnswers {
  cloudPlatform: YesNoPartial | null;
  scadaAccessible: YesNoPartial | null;
  sapIntegrated: YesNoPartial | null;
  dataCatalog: YesNoPartial | null;
  streamingPipelines: YesNoPartial | null;
  amiDeployed: YesNoPartial | null;
  gisIntegrated: YesNoPartial | null;
  mlModelsInProd: YesNoPartial | null;
  crossDomainData: YesNoPartial | null;
}

export interface CurrentUseCasesAnswers {
  selectedUseCases: string[];
  /** Data sources / datasets the customer has ingested or accessible — separate
   *  from use cases in production. Drives "data we have but aren't using" recs. */
  selectedDataSources?: string[];
}

/** Per-assessment post-submit fine-tuning. Lives on `AssessmentAnswers` so it
 *  persists when the SA saves / re-opens the assessment, and so the tactical
 *  recommendations + strategic roadmap stay consistent regardless of where the
 *  SA refined the UC. Every entry is reversible from the Refinements panel.
 *
 *  Distinction:
 *    - `discardedUseCaseIds`: not now, could revisit. Hidden from views but
 *      easy to restore.
 *    - `outOfScopeUseCaseIds`: structurally doesn't apply to this customer.
 *      Hidden from views AND from the discard list — surfaces in its own
 *      "Out of scope" tab. Use for "we'll never need this."
 */
export interface RefinementAnswers {
  /** UC ids the SA has explicitly removed from this customer's view. They
   *  are excluded from scoring recommendations, the strategic roadmap, the
   *  roadmap explorer, the blend view, the data-strategy aggregation, and
   *  the PoC doc dropdown — everywhere a UC would normally surface. */
  discardedUseCaseIds?: string[];
  /** UC ids the SA has marked as "doesn't apply to this customer ever."
   *  Same filter behavior as discard but conceptually permanent — keeps the
   *  Discarded list focused on "not now" UCs. */
  outOfScopeUseCaseIds?: string[];
  /** UC ids forcibly promoted into the top-N recommendations regardless of
   *  readiness score. Pinned UCs land first in `computeRecommendations`,
   *  followed by the algorithm-ranked tail. */
  pinnedUseCaseIds?: string[];
  /** Manual bucket pinning for the strategic roadmap. ucId → bucket index
   *  (0-based, where each bucket is a half-year). The sequencer plans every
   *  other UC around the pin. Half-year index 0 = first H1, 1 = first H2,
   *  etc. */
  bucketPins?: Record<string, number>;
  /** Per-UC override of the Quantified Annual Value range. Wins over the
   *  catalog `valueModel` formula when set. */
  valueOverrides?: Record<string, { annualValueLowMM?: number; annualValueHighMM?: number }>;
  /** Per-UC free-text note from the SA. Surfaces in the UC detail card,
   *  the PoC doc, and the exec summary. */
  notes?: Record<string, string>;
  /** Per-UC dependency edge overrides. `add` adds an extra prerequisite UC
   *  to that UC; `remove` drops an existing edge from the catalog. Both
   *  flow through `buildStrategicRoadmap`'s dependency check. */
  dependencyOverrides?: Record<string, { add?: string[]; remove?: string[] }>;
}

/** Named what-if scenario — captures the full refinements blob plus the
 *  transient roadmap-control state (investment dial, SI selection,
 *  accelerator toggle, horizon). Switching to a scenario loads its snapshot
 *  into live state; saving a scenario writes the live state out. */
export interface AssessmentScenario {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  refinements?: RefinementAnswers;
  /** Optional roadmap-control snapshot. When undefined the scenario only
   *  carries refinements; the live dashboard keeps its current dial settings. */
  controls?: {
    horizon?: 3 | 5;
    investmentMPerYear?: number;
    siUcIds?: string[];
    applyAccelerators?: boolean;
  };
}

/** Per-customer overrides on the catalog complexity score for a use case.
 *  Keyed by use case id. Value is 1-5. */
export type ComplexityOverrides = Record<string, number>;

export interface CapabilityScores {
  dataEngineering: number;
  dataScience: number;
  cloudInfra: number;
  executiveSponsorship: number;
}

// "self"     → user self-rates each dimension 1-5 (original behavior)
// "derived"  → user answers proxy questions; we derive a 1-5 score per dimension
export type CapabilityMode = 'self' | 'derived';

export interface CapabilityAssessment {
  mode: CapabilityMode;
  /** Keyed by `${dimension}.${questionKey}` → answer value 1..5 */
  derivedAnswers: Record<string, number>;
}

export interface AssessmentAnswers {
  profile: CompanyProfile;
  infrastructure: InfrastructureAnswers;
  currentUseCases: CurrentUseCasesAnswers;
  capabilities: CapabilityScores;        // always computed; self mode = direct, derived = averaged
  capabilityMode: CapabilityAssessment;
  /** Per-use-case complexity overrides — SA tunes for customer-specific friction. */
  complexityOverrides?: ComplexityOverrides;
  /** Databricks capabilities that are blocked / limited for this customer
   *  (e.g., feature unavailable in their region, internal change-control on a
   *  product). Each blocker raises effective complexity for any use case whose
   *  databricksPrereqs include the listed capability. */
  databricksBlockers?: string[];
  /** Post-submit fine-tuning — discards, pins, notes, overrides, bucket pins. */
  refinements?: RefinementAnswers;
  /** Saved what-if scenarios. Each scenario is a named snapshot the SA can
   *  switch the live view to (or compare against). */
  scenarios?: AssessmentScenario[];
  /** When set, the dashboard renders the scenario's refinements + controls
   *  instead of the live ones. Null/undefined = base assessment. */
  activeScenarioId?: string | null;
}

export const INITIAL_ANSWERS: AssessmentAnswers = {
  profile: {
    companyName: '',
    industryId: null,
    utilityType: null,
    territorySize: null,
    geography: null,
    strategicPriorities: [],
  },
  infrastructure: {
    cloudPlatform: null,
    scadaAccessible: null,
    sapIntegrated: null,
    dataCatalog: null,
    streamingPipelines: null,
    amiDeployed: null,
    gisIntegrated: null,
    mlModelsInProd: null,
    crossDomainData: null,
  },
  currentUseCases: {
    selectedUseCases: [],
    selectedDataSources: [],
  },
  capabilities: {
    dataEngineering: 3,
    dataScience: 3,
    cloudInfra: 3,
    executiveSponsorship: 3,
  },
  capabilityMode: {
    // Always derived now — self-reported sliders were removed because users
    // are bad at scoring themselves on abstract 1-5 scales. Kept as a field
    // for backward compat with old saved assessments.
    mode: 'derived',
    derivedAnswers: {},
  },
  complexityOverrides: {},
  databricksBlockers: [],
};

export const UTILITY_TYPE_OPTIONS = [
  { value: 'electric', label: 'Electric Utility', icon: 'Zap' },
  { value: 'gas', label: 'Gas Utility', icon: 'Flame' },
  { value: 'electric_gas', label: 'Electric & Gas', icon: 'Factory' },
  { value: 'generation_only', label: 'Generation Only (unregulated)', icon: 'Bolt' },
  { value: 'nuclear', label: 'Nuclear Operator', icon: 'Atom' },
] as const;

/** Customer types that operate retail customer relationships (drives whether
 *  to ask service-territory size, AMI, GIS, customer-program questions). */
export const HAS_RETAIL_CUSTOMERS: UtilityType[] = ['electric', 'gas', 'electric_gas'];

/** Customer types that operate generation assets (drives plant DCS / fuel /
 *  fleet-size questions). */
export const HAS_GENERATION: UtilityType[] = ['electric', 'electric_gas', 'generation_only', 'nuclear'];

/** Customer types that operate distribution / transmission grids. */
export const HAS_GRID: UtilityType[] = ['electric', 'gas', 'electric_gas'];

/** Used to filter use cases by utility type.
 *
 *  Filtering rules:
 *   - electric        → use cases tagged 'electric'
 *   - gas             → use cases tagged 'gas'
 *   - electric_gas    → combined utilities; sees electric, gas, and electric_gas tags
 *   - generation_only → unregulated power generators (e.g. an independent power producer); only
 *     sees use cases explicitly tagged 'generation_only' (Generation domain +
 *     Corporate Services + applicable Regulatory work). Distribution,
 *     transmission, and gas-distribution use cases are NOT visible.
 */
export function useCaseMatchesUtility(
  utilityTypes: string[] | undefined,
  selected: UtilityType | string | null | undefined
): boolean {
  if (!selected) return true;
  // Universal sentinels — non-P&U industry packs tag use cases with
  // `["all"]` to mean "applies to every customer type in this industry".
  // Treat that as a wildcard match regardless of `selected`.
  if (utilityTypes && (utilityTypes.includes('all') || utilityTypes.includes('*'))) {
    return true;
  }
  const RESTRICTED: UtilityType[] = ['generation_only', 'nuclear'];
  if (!utilityTypes || utilityTypes.length === 0) {
    // Untagged catalog rows default to visible for legacy/traditional utility
    // types but NOT for the restricted buckets (generation_only, nuclear)
    // — those must be opted into so a pure generator / nuclear operator
    // doesn't accidentally see distribution / customer / gas-pipeline work.
    return !RESTRICTED.includes(selected as UtilityType);
  }
  // Blended customer types are prefixed with their source pack id
  // (e.g. "dist_gen:fuel_cell_oem"). Strip the prefix before matching against
  // UC-level tags which are stored unprefixed.
  const rawSelected = typeof selected === 'string' && selected.includes(':')
    ? selected.split(':').slice(1).join(':')
    : selected;
  if (rawSelected === 'electric_gas') {
    return utilityTypes.some(t => t === 'electric' || t === 'gas' || t === 'electric_gas');
  }
  return utilityTypes.includes(rawSelected as string);
}

export const TERRITORY_SIZE_OPTIONS = [
  { value: 'small', label: 'Small', detail: '<500K customers' },
  { value: 'medium', label: 'Medium', detail: '500K - 2M customers' },
  { value: 'large', label: 'Large', detail: '2M - 5M customers' },
  { value: 'very_large', label: 'Very Large', detail: '5M+ customers' },
] as const;

/** For generation-only / nuclear customers (no retail customer count). The
 *  same TerritorySize bucket is reused so downstream value calculations stay
 *  consistent — but the labels/detail describe fleet scale instead. */
export const FLEET_SIZE_OPTIONS_GEN = [
  { value: 'small', label: 'Small', detail: '<1 GW operating capacity' },
  { value: 'medium', label: 'Medium', detail: '1 - 5 GW' },
  { value: 'large', label: 'Large', detail: '5 - 15 GW' },
  { value: 'very_large', label: 'Very Large', detail: '15+ GW (IPP-scale)' },
] as const;

export const FLEET_SIZE_OPTIONS_NUCLEAR = [
  { value: 'small', label: 'Single-unit', detail: '1 operating reactor' },
  { value: 'medium', label: 'Small fleet', detail: '2 - 4 reactors' },
  { value: 'large', label: 'Mid fleet', detail: '5 - 10 reactors' },
  { value: 'very_large', label: 'Large fleet', detail: '10+ reactors (top-tier operator)' },
] as const;

/** Returns the right size-bucket option set for the selected utility type. */
export function sizeOptionsFor(t: UtilityType | null | undefined) {
  if (t === 'nuclear') return FLEET_SIZE_OPTIONS_NUCLEAR;
  if (t === 'generation_only') return FLEET_SIZE_OPTIONS_GEN;
  return TERRITORY_SIZE_OPTIONS;
}

export function sizeQuestionLabelFor(t: UtilityType | null | undefined): { label: string; help: string } {
  if (t === 'nuclear') return { label: 'Fleet size', help: 'Number of operating reactors' };
  if (t === 'generation_only') return { label: 'Fleet size', help: 'Total operating generation capacity' };
  return { label: 'Service Territory Size', help: 'Approximate customer count' };
}

export const GEOGRAPHY_OPTIONS = [
  { value: 'us', label: 'United States' },
  { value: 'canada', label: 'Canada' },
  { value: 'europe', label: 'Europe' },
  { value: 'australia', label: 'Australia / Pacific' },
  { value: 'other', label: 'Other' },
] as const;

export const STRATEGIC_PRIORITY_OPTIONS = [
  { value: 'reliability', label: 'Grid Reliability', description: 'Reduce SAIDI/SAIFI and improve storm response' },
  { value: 'cost_reduction', label: 'Cost Reduction', description: 'Optimize O&M spending and infrastructure costs' },
  { value: 'customer', label: 'Customer Satisfaction', description: 'Improve NPS and digital customer experience' },
  { value: 'compliance', label: 'Regulatory Compliance', description: 'NERC CIP, FERC, ESG reporting requirements' },
  { value: 'revenue', label: 'Revenue Growth', description: 'Trading optimization, new programs, DER monetization' },
  { value: 'sustainability', label: 'Sustainability', description: 'Renewable integration, carbon reduction, ESG goals' },
  { value: 'safety', label: 'Worker & Public Safety', description: 'OSHA compliance, field safety, incident prevention, public safety risk' },
  { value: 'workforce', label: 'Workforce & Backoffice Efficiency', description: 'Finance, HR, procurement, marketing — enterprise operations' },
] as const;

/** Map an account's stored company profile (the New-account modal saves a mix of
 *  value + human-label forms) onto the wizard's value-form CompanyProfile, so a
 *  complete-profile account never re-enters it. Matches by value OR label; territory
 *  is matched by leading word since the modal stores ranged labels like "Large (2M–5M)". */
export function normalizeProfileFromAccount(a: {
  name?: string | null; utility_type?: string | null; territory_size?: string | null;
  geography?: string | null; strategic_priorities?: string[] | null;
}): Partial<CompanyProfile> {
  const byValOrLabel = (opts: readonly { value: string; label: string }[], raw?: string | null) => {
    if (!raw) return undefined;
    const r = String(raw).trim().toLowerCase();
    return opts.find((o) => o.value.toLowerCase() === r || o.label.toLowerCase() === r)?.value;
  };
  const territory = (() => {
    const r = String(a.territory_size || '').trim().toLowerCase();
    if (!r) return undefined;
    if (r.startsWith('very')) return 'very_large';
    if (r.startsWith('large')) return 'large';
    if (r.startsWith('medium') || r.startsWith('small fleet')) return 'medium';
    if (r.startsWith('small') || r.startsWith('single')) return 'small';
    return undefined;
  })();
  const priorities = (a.strategic_priorities || [])
    .map((p) => byValOrLabel(STRATEGIC_PRIORITY_OPTIONS, p))
    .filter((x): x is string => !!x);
  return {
    companyName: a.name || undefined,
    utilityType: byValOrLabel(UTILITY_TYPE_OPTIONS, a.utility_type) as UtilityType | undefined,
    territorySize: territory as TerritorySize | undefined,
    geography: byValOrLabel(GEOGRAPHY_OPTIONS, a.geography) as Geography | undefined,
    strategicPriorities: priorities as StrategicPriority[],
  };
}

/** Filter strategic priorities per utility type — drop options that have no
 *  relevance (e.g. SAIDI/SAIFI doesn't apply to a pure generator; retail
 *  customer satisfaction doesn't apply to gen-only / nuclear). */
export function strategicPrioritiesFor(t: UtilityType | null | undefined) {
  if (!t) return STRATEGIC_PRIORITY_OPTIONS;
  if (t === 'generation_only' || t === 'nuclear') {
    // Pure generators / nuclear operators: no retail customers, no
    // distribution grid → drop reliability (SAIDI/SAIFI) and customer.
    // Override compliance copy to be FERC/NRC-led.
    return STRATEGIC_PRIORITY_OPTIONS.filter(
      o => o.value !== 'reliability' && o.value !== 'customer'
    ).map(o => {
      if (o.value === 'compliance') {
        return {
          ...o,
          description: t === 'nuclear'
            ? 'NRC compliance (10 CFR 50.59 / 50.65 Maintenance Rule), INPO performance, FERC reporting'
            : 'FERC, NERC CIP, ESG reporting requirements',
        };
      }
      if (o.value === 'safety') {
        return {
          ...o,
          description: t === 'nuclear'
            ? 'Reactor safety culture, ALARA radiation protection, OSHA, INPO incident reduction'
            : 'OSHA compliance, field safety, incident prevention, plant safety culture',
        };
      }
      return o;
    });
  }
  if (t === 'gas') {
    // Gas distribution: keep most, but rename reliability to fit gas context.
    return STRATEGIC_PRIORITY_OPTIONS.map(o =>
      o.value === 'reliability'
        ? { ...o, label: 'System Integrity', description: 'Pipeline integrity, leak reduction, DIMP/TIMP compliance' }
        : o,
    );
  }
  return STRATEGIC_PRIORITY_OPTIONS;
}

/** Each infra question has an optional `relevantFor` predicate. If the
 *  selected utility type is excluded, the question is hidden in the wizard
 *  AND its answer is not required to advance the step. */
export interface InfrastructureQuestion {
  key: keyof InfrastructureAnswers;
  question: string;
  helpText: string;
  /** If set, only show when the selected utility type matches one of these.
   *  Omit to show for all types. */
  relevantFor?: UtilityType[];
  /** Optional per-type wording override. Falls back to `question`/`helpText`. */
  overrides?: Partial<Record<UtilityType, { question?: string; helpText?: string }>>;
}

export const INFRASTRUCTURE_QUESTIONS: InfrastructureQuestion[] = [
  {
    key: 'cloudPlatform',
    question: 'Do you have a cloud data platform or data warehouse?',
    helpText: 'Examples: Databricks, Snowflake, AWS Redshift, Azure Synapse, GCP BigQuery',
  },
  {
    key: 'scadaAccessible',
    question: 'Is your SCADA / operational data accessible for analytics?',
    helpText: 'Can data engineers query SCADA / OT data, or is it locked in historian appliances?',
    overrides: {
      nuclear: {
        question: 'Is your plant historian (PI System / OSI PI) data accessible for analytics?',
        helpText: 'Can data engineers query reactor instrumentation, balance-of-plant DCS, and historian tags outside the OT zone?',
      },
      generation_only: {
        question: 'Is your plant DCS / historian data accessible for analytics?',
        helpText: 'Can data engineers query plant control system telemetry (vibration, fuel, output, emissions), or is it locked behind the OT firewall?',
      },
    },
  },
  {
    key: 'sapIntegrated',
    question: 'Is your SAP / ERP data integrated into your analytics platform?',
    helpText: 'Work orders, asset master, billing, and financial data available for analysis',
    overrides: {
      nuclear: {
        question: 'Is your EAM (Maximo / Asset Suite) and ERP data integrated into analytics?',
        helpText: 'Work orders, asset master, parts inventory, and outage planning data available for analysis',
      },
      generation_only: {
        question: 'Is your EAM and ERP data integrated into analytics?',
        helpText: 'Work orders, asset master, parts inventory, financial data available for analysis',
      },
    },
  },
  {
    key: 'dataCatalog',
    question: 'Do you have a data catalog or governance layer?',
    helpText: 'Centralized metadata management, access control, and data lineage tracking',
  },
  {
    key: 'streamingPipelines',
    question: 'Are data pipelines real-time / streaming or batch-only?',
    helpText: 'Yes = streaming/real-time, Partial = some streaming, No = batch-only',
  },
  {
    key: 'amiDeployed',
    question: 'Is AMI (smart meter) data available for analytics?',
    helpText: 'Interval reads (15-min or hourly), last-gasp events, voltage data from smart meters like Itron, L+G, Sensus',
    relevantFor: ['electric', 'gas', 'electric_gas'],
  },
  {
    key: 'gisIntegrated',
    question: 'Is your GIS network model integrated into analytics?',
    helpText: 'ESRI ArcGIS / Smallworld data available for customer-to-transformer mapping, circuit tracing, and spatial analysis',
    relevantFor: ['electric', 'gas', 'electric_gas'],
  },
  {
    key: 'mlModelsInProd',
    question: 'Do you have ML models running in production today?',
    helpText: 'Any predictive or prescriptive models deployed and actively scoring — not just prototypes or notebooks',
  },
  {
    key: 'crossDomainData',
    question: 'Can you combine data across business domains (e.g., ops + customer + finance)?',
    helpText: 'Cross-domain joins are possible — e.g., linking outage events to customer impact to financial cost in one query',
    overrides: {
      nuclear: {
        question: 'Can you combine data across plant, EAM, and regulatory domains?',
        helpText: 'Cross-domain joins are possible — e.g., linking SSC condition to maintenance history to NRC inspection findings',
      },
      generation_only: {
        question: 'Can you combine data across plant operations, EAM, and finance?',
        helpText: 'Cross-domain joins are possible — e.g., linking forced-outage events to maintenance history to plant P&L impact',
      },
    },
  },
];

/** Returns the questions visible for a given utility type, with per-type
 *  wording resolved. Hidden questions don't gate step advancement. */
export function infrastructureQuestionsFor(t: UtilityType | null | undefined): InfrastructureQuestion[] {
  return INFRASTRUCTURE_QUESTIONS
    .filter(q => !q.relevantFor || (t && q.relevantFor.includes(t)) || !t)
    .map(q => {
      if (!t || !q.overrides) return q;
      const o = q.overrides[t];
      if (!o) return q;
      return {
        ...q,
        question: o.question || q.question,
        helpText: o.helpText || q.helpText,
      };
    });
}

// Use case checklist — derived from the full catalog so utilityTypes flow through.
export interface UseCaseOption {
  id: string;
  label: string;
  phase: number;
  domain: string;
  utilityTypes?: string[];
  /** Source industry id — used to filter the checklist down to whatever
   *  industry / blend is active so users only see UCs relevant to them. */
  industryId?: string;
}

// Derived from the full USE_CASES catalog so utilityTypes stays in sync.
// (The big hand-maintained list was replaced in the gas-support refactor.)
import { USE_CASES } from './useCases';

export const CURRENT_USE_CASE_OPTIONS: UseCaseOption[] = USE_CASES.map(uc => ({
  id: uc.id,
  label: uc.name,
  phase: uc.phase,
  domain: uc.domain,
  utilityTypes: uc.utilityTypes,
  industryId: uc.industryId,
}));

export const CAPABILITY_ITEMS = [
  {
    key: 'dataEngineering' as const,
    label: 'Data Engineering Team Maturity',
    levels: ['Minimal / outsourced', 'Small team, basic ETL', 'Established team', 'Strong team, modern stack', 'Elite, platform engineering'],
  },
  {
    key: 'dataScience' as const,
    label: 'Data Science / ML Capability',
    levels: ['No capability', 'Exploring / learning', 'Small team, some models', 'Mature practice', 'In-house ML platform team'],
  },
  {
    key: 'cloudInfra' as const,
    label: 'Cloud Infrastructure Maturity',
    levels: ['All on-premises', 'Starting cloud migration', 'Hybrid cloud', 'Mostly cloud', 'Cloud-native'],
  },
  {
    key: 'executiveSponsorship' as const,
    label: 'Executive Sponsorship for Data/AI',
    levels: ['Low awareness', 'Some interest', 'Active champion', 'C-level priority', 'Board-level mandate'],
  },
];
