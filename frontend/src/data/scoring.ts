import { AssessmentAnswers, useCaseMatchesUtility } from './questions';
import { USE_CASES, UseCase, PHASE_NAMES, DOMAIN_NAMES } from './useCases';
import { dataSourcesMatchingUseCase } from './dataSources';
import { getHiddenSet, getPinnedSet } from './refinements';

export interface DimensionScores {
  dataInfra: number;       // 0-100
  operationalData: number; // 0-100
  analytics: number;       // 0-100
  ai: number;              // 0-100
  governance: number;      // 0-100
}

export interface RecommendedUseCase {
  useCase: UseCase;
  readinessScore: number;
  dependencyScore: number;
  priorityScore: number;
  capabilityScore: number;
  complexityScore: number;
  reasoning: string;
}

export interface PeerProfile {
  name: string;
  type: string;
  territory: string;
  phase: number;
  completedUseCases: string[];
  nextSteps: string[];
  insight: string;
  /** Industry the peer belongs to. Untagged rows are treated as P&U for
   *  backward compat. */
  industryId?: string;
}

export interface DomainProgress {
  domain: string;
  phase1Count: number;
  phase1Total: number;
  phase2Count: number;
  phase2Total: number;
  phase3Count: number;
  phase3Total: number;
}

export interface AssessmentResults {
  currentPhase: number;
  phaseName: string;
  overallScore: number;
  dimensionScores: DimensionScores;
  completedUseCases: string[];
  recommendations: RecommendedUseCase[];
  peerProfiles: PeerProfile[];
  phaseProgress: number; // % through current phase
  domainProgress: DomainProgress[];
}

// Strategic priority mapping — drives priority alignment scoring.
// (Replaces the old per-rank PRIORITY_USE_CASE_MAP; strategic priorities from the
// profile step are now the single source of truth for priority alignment.)
const STRATEGIC_UC_MAP: Record<string, string[]> = {
  reliability: [
    'p1_dist_outage_detection', 'p1_dist_flisr', 'p1_dist_predictive_maint', 'p1_dist_feeder_forecast',
    'p1_trans_predictive_maint', 'p1_trans_veg_management', 'p1_gen_predictive_maint', 'p1_gen_outage_prediction',
    'p2_dist_storm_prediction', 'p2_trans_grid_stability', 'p3_dist_self_healing',
  ],
  cost_reduction: [
    'p1_gen_fleet_analytics', 'p1_gen_fuel_hedging', 'p1_corp_spend_analytics', 'p1_corp_capital_analytics',
    'p1_trans_dynamic_line_rating',
    'p2_gen_portfolio_optimization', 'p2_dist_voltage_optimization', 'p2_corp_financial_close',
    'p3_corp_auto_procurement', 'p3_corp_self_optimizing',
  ],
  customer: [
    'p1_cust_segmentation', 'p1_cust_knowledge_agents', 'p1_cust_nba',
    'p2_cust_dynamic_pricing', 'p2_cust_proactive_outage', 'p2_cust_journey_orchestration',
    'p3_cust_ai_self_service', 'p3_cust_autonomous_cx',
  ],
  compliance: [
    'p1_reg_compliance_monitoring', 'p1_reg_rate_case', 'p1_corp_it_ot_security',
    'p2_gen_emission_compliance', 'p2_reg_decarbonization', 'p2_reg_climate_risk',
    'p3_reg_autonomous_compliance', 'p3_reg_enterprise_risk',
  ],
  revenue: [
    'p1_gen_demand_forecast', 'p1_gen_fuel_hedging', 'p1_cust_billing_anomaly',
    'p2_gen_renewable_storage', 'p2_gen_portfolio_optimization', 'p2_reg_siting_capacity',
    'p3_cust_behind_meter', 'p3_cust_grid_marketplace',
  ],
  sustainability: [
    'p2_gen_renewable_storage', 'p2_gen_emission_compliance', 'p2_cust_carbon_coach',
    'p2_reg_decarbonization', 'p2_reg_climate_risk',
    'p3_reg_living_irp',
  ],
  safety: [
    'p1_corp_safety_analytics', 'p1_corp_it_ot_security',
    'p2_dist_storm_prediction',
    'p3_dist_work_packages',
  ],
  workforce: [
    'p1_corp_workforce_planning', 'p1_corp_spend_analytics', 'p1_corp_capital_analytics',
    'p2_corp_knowledge_copilots', 'p2_corp_financial_close', 'p2_corp_document_processing',
    'p3_corp_talent_copilots', 'p3_corp_auto_procurement',
  ],
};

const PEER_DATABASE: PeerProfile[] = [
  {
    name: 'Midwest IOU (2.1M customers)',
    type: 'Electric & Gas',
    territory: 'Large',
    phase: 1,
    completedUseCases: [
      'p1_dist_outage_detection', 'p1_dist_reliability_monitoring', 'p1_gen_demand_forecast',
      'p1_gen_fleet_analytics', 'p1_cust_segmentation', 'p1_corp_spend_analytics',
    ],
    nextSteps: ['p1_dist_flisr', 'p1_gen_predictive_maint', 'p1_cust_knowledge_agents'],
    insight: 'Started with AMI/SCADA integration and generation forecasting. Achieving 20% SAIDI improvement. Now building predictive maintenance and call center AI agents.',
  },
  {
    name: 'Southeast Electric Cooperative',
    type: 'Electric Only',
    territory: 'Small',
    phase: 1,
    completedUseCases: [
      'p1_dist_outage_detection', 'p1_dist_reliability_monitoring', 'p1_cust_segmentation',
    ],
    nextSteps: ['p1_dist_flisr', 'p1_cust_billing_anomaly', 'p1_corp_safety_analytics'],
    insight: 'Focused on distribution reliability as the first priority. AMI integration drove immediate SAIDI improvement. Now targeting revenue protection and safety analytics.',
  },
  {
    name: 'Western Generation & Trading Co.',
    type: 'Electric Only',
    territory: 'Medium',
    phase: 2,
    completedUseCases: [
      'p1_gen_demand_forecast', 'p1_gen_fleet_analytics', 'p1_gen_fuel_hedging', 'p1_gen_predictive_maint',
      'p1_reg_portfolio_risk', 'p1_reg_load_resource_planning',
      'p2_gen_emission_compliance', 'p2_gen_renewable_storage',
    ],
    nextSteps: ['p2_gen_digital_twin', 'p2_gen_portfolio_optimization', 'p2_reg_decarbonization'],
    insight: 'Generation-focused transformation drove $15M/yr in fuel and dispatch optimization. Now extending to digital twins and portfolio optimization.',
  },
  {
    name: 'Northeast Multi-Utility (3.4M customers)',
    type: 'Electric & Gas',
    territory: 'Large',
    phase: 2,
    completedUseCases: [
      'p1_dist_outage_detection', 'p1_dist_flisr', 'p1_dist_predictive_maint', 'p1_dist_feeder_forecast',
      'p1_dist_reliability_monitoring',
      'p1_cust_segmentation', 'p1_cust_knowledge_agents', 'p1_cust_nba',
      'p1_gen_demand_forecast', 'p1_gen_predictive_maint',
      'p1_trans_load_congestion', 'p1_trans_predictive_maint',
      'p2_dist_storm_prediction', 'p2_cust_proactive_outage',
    ],
    nextSteps: ['p2_dist_der_ev', 'p2_dist_hosting_capacity', 'p2_trans_grid_stability'],
    insight: 'Full Phase 1 across distribution and customer drove 28% storm restoration improvement and 15-point NPS gain. Now focused on DER integration and grid modernization.',
  },
  {
    name: 'Pacific Coast Utility',
    type: 'Electric & Gas',
    territory: 'Very Large',
    phase: 1,
    completedUseCases: [
      'p1_trans_veg_management', 'p1_trans_predictive_maint', 'p1_trans_asset_condition',
      'p1_dist_outage_detection', 'p1_dist_reliability_monitoring',
      'p1_cust_segmentation', 'p1_corp_safety_analytics', 'p1_corp_it_ot_security',
    ],
    nextSteps: ['p1_dist_feeder_forecast', 'p2_trans_veg_optimization', 'p2_trans_corridor_risk'],
    insight: 'Wildfire risk drove early investment in vegetation management and transmission asset analytics. Safety and cybersecurity also prioritized early due to regulatory pressure.',
  },
  {
    name: 'Australian Energy Retailer',
    type: 'Multi-Commodity',
    territory: 'Medium',
    phase: 1,
    completedUseCases: [
      'p1_cust_segmentation', 'p1_cust_knowledge_agents', 'p1_cust_nba', 'p1_cust_billing_anomaly',
      'p1_cust_payment_risk',
      'p1_gen_demand_forecast', 'p1_reg_portfolio_risk',
    ],
    nextSteps: ['p2_cust_dynamic_pricing', 'p2_cust_journey_orchestration', 'p1_gen_fleet_analytics'],
    insight: 'Customer-first strategy: full Phase 1 customer suite drove 18% churn reduction and $8M in revenue recovery. Energy trading analytics replaced 3 legacy systems.',
  },
  {
    name: 'European Transmission Operator',
    type: 'Electric Only',
    territory: 'Large',
    phase: 2,
    completedUseCases: [
      'p1_trans_load_congestion', 'p1_trans_dynamic_line_rating', 'p1_trans_predictive_maint',
      'p1_trans_veg_management', 'p1_trans_asset_condition',
      'p1_gen_demand_forecast', 'p1_gen_fleet_analytics',
      'p1_reg_load_resource_planning', 'p1_reg_compliance_monitoring',
      'p2_trans_grid_stability', 'p2_trans_planning_scenarios',
    ],
    nextSteps: ['p2_trans_corridor_risk', 'p2_reg_decarbonization', 'p2_gen_renewable_storage'],
    insight: 'Transmission-focused transformation with full Phase 1 complete. DLR achieved $75M in deferred capital. Now focused on grid stability analytics and decarbonization planning.',
  },
  {
    name: 'Southern Gas Distribution',
    type: 'Gas Only',
    territory: 'Medium',
    phase: 1,
    completedUseCases: [
      'p1_corp_spend_analytics', 'p1_corp_safety_analytics', 'p1_corp_workforce_planning',
      'p1_reg_compliance_monitoring',
    ],
    nextSteps: ['p1_dist_outage_detection', 'p1_cust_segmentation', 'p1_corp_capital_analytics'],
    insight: 'Started with corporate services and safety analytics as quick wins. Pipeline integrity and leak detection are top priorities as Phase 1 distribution analytics build out.',
  },
];

export function getCompletedUseCases(selectedIds: string[]): Set<string> {
  return new Set(selectedIds);
}

/** True when a use case belongs to one of the assessment's selected industries.
 *  Untagged rows (legacy P&U seeds before the multi-industry refactor) are
 *  treated as part of every industry so old assessments don't break.
 *
 *  Accepts a single id, an array of ids (blend), or null/[] meaning no filter. */
function matchesIndustry(uc: UseCase, industry: string | string[] | null | undefined): boolean {
  if (!industry || (Array.isArray(industry) && industry.length === 0)) return true;
  if (!uc.industryId) return true;
  if (typeof industry === 'string') return uc.industryId === industry;
  return industry.includes(uc.industryId);
}

/** Resolve the active industry id-set for an assessment. Prefers the explicit
 *  blend list when set, else falls back to the single industryId. Legacy
 *  assessments saved before the multi-industry refactor have NEITHER field
 *  set — default those to ['pu'] since that's what the catalog shipped as
 *  before the rebrand. Without this back-compat default, those assessments
 *  pull UCs from every industry pack into recs and the roadmap. */
function getAssessmentIndustryIds(answers: AssessmentAnswers): string[] | null {
  const ids = answers.profile.industryIds;
  if (Array.isArray(ids) && ids.length > 0) return ids;
  const single = answers.profile.industryId;
  if (single) return [single];
  return ['pu'];
}

/** True when the UC's domain is in the customer's declared operations
 *  scope. Empty scope = pass-through (back-compat). */
function matchesOperationsScope(uc: UseCase, scope: string[] | null | undefined): boolean {
  if (!scope || scope.length === 0) return true;
  return scope.includes(uc.domain);
}

function applicableUseCases(answers: AssessmentAnswers): UseCase[] {
  const utility = answers.profile.utilityType;
  const industryIds = getAssessmentIndustryIds(answers);
  const scope = answers.profile.operationsScope ?? null;
  // Hidden = discarded ∪ out-of-scope. Both filter views identically here;
  // the distinction lives in the Refinements panel UX, not in scoring.
  const hidden = getHiddenSet(answers);
  return USE_CASES.filter(uc =>
    !hidden.has(uc.id) &&
    matchesIndustry(uc, industryIds) &&
    useCaseMatchesUtility(uc.utilityTypes, utility) &&
    matchesOperationsScope(uc, scope)
  );
}

function computeDimensionScores(answers: AssessmentAnswers, completed: Set<string>): DimensionScores {
  const ynpScore = (v: string | null): number =>
    v === 'yes' ? 100 : v === 'partial' ? 50 : 0;

  const relevant = applicableUseCases(answers);

  // Data Infrastructure — foundation readiness
  const dataInfra = Math.round(
    (ynpScore(answers.infrastructure.cloudPlatform) * 0.3 +
     ynpScore(answers.infrastructure.streamingPipelines) * 0.2 +
     (answers.capabilities.cloudInfra / 5) * 100 * 0.3 +
     ynpScore(answers.infrastructure.dataCatalog) * 0.2)
  );

  // Operational Data — SCADA, SAP, streaming readiness
  const operationalData = Math.round(
    (ynpScore(answers.infrastructure.scadaAccessible) * 0.3 +
     ynpScore(answers.infrastructure.sapIntegrated) * 0.3 +
     ynpScore(answers.infrastructure.streamingPipelines) * 0.2 +
     ynpScore(answers.infrastructure.cloudPlatform) * 0.2)
  );

  // Analytics — Phase 1 use case completion + team capability
  const phase1Ucs = relevant.filter(uc => uc.phase === 1);
  const phase1Complete = phase1Ucs.filter(uc => completed.has(uc.id)).length;
  const analytics = Math.round(
    (phase1Complete / Math.max(phase1Ucs.length, 1) * 100 * 0.5 +
     (answers.capabilities.dataScience / 5) * 100 * 0.25 +
     (answers.capabilities.dataEngineering / 5) * 100 * 0.25)
  );

  // AI/ML — Phase 2-3 use case completion + capabilities
  const advancedUcs = relevant.filter(uc => uc.phase >= 2);
  const advancedComplete = advancedUcs.filter(uc => completed.has(uc.id)).length;
  const ai = Math.round(
    (advancedComplete / Math.max(advancedUcs.length, 1) * 100 * 0.5 +
     (answers.capabilities.dataScience / 5) * 100 * 0.3 +
     (answers.capabilities.executiveSponsorship / 5) * 100 * 0.2)
  );

  // Governance
  const governance = Math.round(
    (ynpScore(answers.infrastructure.dataCatalog) * 0.4 +
     (answers.capabilities.executiveSponsorship / 5) * 100 * 0.3 +
     ynpScore(answers.infrastructure.cloudPlatform) * 0.15 +
     (completed.has('p1_reg_compliance_monitoring') ? 100 : 0) * 0.15)
  );

  return { dataInfra, operationalData, analytics, ai, governance };
}

function determinePhase(answers: AssessmentAnswers, completed: Set<string>): { phase: number; progress: number } {
  const infra = answers.infrastructure;
  const hasCloudPlatform = infra.cloudPlatform === 'yes' || infra.cloudPlatform === 'partial';
  const hasGovernance = infra.dataCatalog === 'yes' || infra.dataCatalog === 'partial';
  const hasSCADA = infra.scadaAccessible === 'yes' || infra.scadaAccessible === 'partial';
  const hasStreaming = infra.streamingPipelines === 'yes' || infra.streamingPipelines === 'partial';

  // Count use cases by phase — scoped to the user's utility type
  const relevant = applicableUseCases(answers);
  const phase1Ucs = relevant.filter(uc => uc.phase === 1);
  const phase2Ucs = relevant.filter(uc => uc.phase === 2);
  const phase3Ucs = relevant.filter(uc => uc.phase === 3);

  const p1Complete = phase1Ucs.filter(uc => completed.has(uc.id)).length;
  const p2Complete = phase2Ucs.filter(uc => completed.has(uc.id)).length;
  const p3Complete = phase3Ucs.filter(uc => completed.has(uc.id)).length;

  const p1Pct = p1Complete / Math.max(phase1Ucs.length, 1);
  const p2Pct = p2Complete / Math.max(phase2Ucs.length, 1);
  const p3Pct = p3Complete / Math.max(phase3Ucs.length, 1);

  const hasFoundation = hasCloudPlatform && (hasGovernance || hasSCADA);

  // Phase 3: Significant Phase 2 completion + some Phase 3 use cases
  if (p2Pct >= 0.3 && p3Complete >= 2) {
    return { phase: 3, progress: Math.round(30 + p3Pct * 70) };
  }

  // Phase 2: Significant Phase 1 completion + some Phase 2 use cases
  if (p1Pct >= 0.3 && p2Complete >= 2) {
    return { phase: 2, progress: Math.round(20 + p2Pct * 80) };
  }

  // Phase 1: Has foundation and some Phase 1 use cases
  if (hasFoundation && p1Complete >= 2) {
    return { phase: 1, progress: Math.round(20 + p1Pct * 80) };
  }

  // Early Phase 1 or Pre-Foundation
  if (hasFoundation || p1Complete >= 1) {
    let p0Score = 0;
    if (hasCloudPlatform) p0Score += 30;
    if (hasGovernance) p0Score += 20;
    if (hasSCADA) p0Score += 20;
    if (hasStreaming) p0Score += 15;
    p0Score += p1Complete * 5;
    return { phase: 1, progress: Math.min(20, p0Score) };
  }

  // Pre-Foundation
  let preScore = 0;
  if (infra.cloudPlatform === 'partial') preScore += 15;
  if (infra.dataCatalog === 'partial') preScore += 10;
  if (infra.scadaAccessible === 'partial') preScore += 10;
  return { phase: 0, progress: preScore };
}

function computeDomainProgress(
  completed: Set<string>,
  industryIds: string[] | string | null | undefined,
): DomainProgress[] {
  return DOMAIN_NAMES.map(domain => {
    const domainUcs = USE_CASES.filter(uc =>
      uc.domain === domain && matchesIndustry(uc, industryIds)
    );
    const p1 = domainUcs.filter(uc => uc.phase === 1);
    const p2 = domainUcs.filter(uc => uc.phase === 2);
    const p3 = domainUcs.filter(uc => uc.phase === 3);
    return {
      domain,
      phase1Count: p1.filter(uc => completed.has(uc.id)).length,
      phase1Total: p1.length,
      phase2Count: p2.filter(uc => completed.has(uc.id)).length,
      phase2Total: p2.length,
      phase3Count: p3.filter(uc => completed.has(uc.id)).length,
      phase3Total: p3.length,
    };
  });
}

/** Returns the effective complexity for a use case under the customer's tuning.
 *    1. Per-customer override wins outright if set.
 *    2. Otherwise: catalog default + 1 per Databricks blocker overlapping the
 *       use case's databricksPrereqs (capped at 5).
 */
export function effectiveComplexity(uc: UseCase, answers: AssessmentAnswers): number {
  const o = answers.complexityOverrides?.[uc.id];
  if (typeof o === 'number' && o >= 1 && o <= 5) return o;
  const blockers = answers.databricksBlockers || [];
  if (blockers.length === 0) return uc.complexity;
  const prereqs = uc.databricksPrereqs || [];
  const blockerSet = new Set(blockers);
  const matched = prereqs.filter((p) => blockerSet.has(p)).length;
  return Math.min(5, uc.complexity + matched);
}

/** Names of prereqs currently blocked for this UC — for UI badges. */
export function blockedPrereqs(uc: UseCase, answers: AssessmentAnswers): string[] {
  const set = new Set(answers.databricksBlockers || []);
  return (uc.databricksPrereqs || []).filter((p) => set.has(p));
}

export function computeRecommendations(
  answers: AssessmentAnswers,
  completed: Set<string>,
  currentPhase: number
): RecommendedUseCase[] {
  const utility = answers.profile.utilityType;
  const industryIds = getAssessmentIndustryIds(answers);
  const scope = answers.profile.operationsScope ?? null;
  const hidden = getHiddenSet(answers);
  const uncompleted = USE_CASES.filter(
    uc => !completed.has(uc.id)
      && !hidden.has(uc.id)
      && matchesIndustry(uc, industryIds)
      && useCaseMatchesUtility(uc.utilityTypes, utility)
      && matchesOperationsScope(uc, scope)
  );

  const scored: RecommendedUseCase[] = uncompleted.map(uc => {
    // Dependency score (40 pts max)
    const depsMet = uc.dependencies.filter(d => completed.has(d)).length;
    const depsTotal = uc.dependencies.length;
    const dependencyScore = depsTotal === 0 ? 40 : Math.round((depsMet / depsTotal) * 40);

    // Priority alignment score (30 pts max) — driven entirely by strategic priorities
    // from the profile step. Each matched strategic priority contributes 10 pts.
    const strategicPriorities = answers.profile.strategicPriorities || [];
    let priorityScore = 0;
    for (const sp of strategicPriorities) {
      if (STRATEGIC_UC_MAP[sp]?.includes(uc.id)) {
        priorityScore += 10;
      }
    }
    priorityScore = Math.min(30, priorityScore);

    // Capability score (20 pts max)
    const avgCapability = (
      answers.capabilities.dataEngineering +
      answers.capabilities.dataScience +
      answers.capabilities.cloudInfra +
      answers.capabilities.executiveSponsorship
    ) / 4;
    const capabilityScore = Math.round(
      effectiveComplexity(uc, answers) <= Math.ceil(avgCapability) ? 20 :
      effectiveComplexity(uc, answers) <= avgCapability + 2 ? 12 :
      5
    );

    // Complexity accessibility score (10 pts max)
    const complexityScore = Math.round(((6 - effectiveComplexity(uc, answers)) / 5) * 10);

    // Phase proximity bonus — prefer use cases near or at current phase
    const phaseDiff = Math.abs(uc.phase - Math.max(1, currentPhase));
    const phaseBonus = phaseDiff === 0 ? 5 : phaseDiff === 1 ? 2 : 0;

    // "Data we already have" bonus — strong signal when underlying data is
    // already ingested. Up to 10 pts based on how many requirements are covered.
    const selectedDS = answers.currentUseCases.selectedDataSources || [];
    const matchedDS = dataSourcesMatchingUseCase(uc.dataRequirements || [], selectedDS);
    const dataReadyBonus = Math.min(10, matchedDS.length * 3);

    const readinessScore = Math.min(100,
      dependencyScore + priorityScore + capabilityScore + complexityScore + phaseBonus + dataReadyBonus);

    // Generate reasoning
    const reasons: string[] = [];
    if (dependencyScore >= 35) reasons.push('All prerequisites are met');
    else if (dependencyScore >= 20) reasons.push('Most prerequisites are in place');
    if (priorityScore >= 20) reasons.push('Strong alignment with your strategic priorities');
    if (effectiveComplexity(uc, answers) <= 3 && avgCapability >= 3) reasons.push('Good fit for your team capabilities');
    if (dataReadyBonus >= 6) reasons.push(`Underlying data already ingested (${matchedDS.length} matching sources)`);
    else if (dataReadyBonus >= 3) reasons.push('Some required data is already available');
    if (reasons.length === 0) reasons.push('Builds toward future capabilities');

    return {
      useCase: uc,
      readinessScore,
      dependencyScore,
      priorityScore,
      capabilityScore,
      complexityScore,
      reasoning: reasons.join('. ') + '.',
    } as RecommendedUseCase;
  });

  // Promote pinned UCs to the top of the recommendation list regardless of
  // their readiness score, then sort the unpinned tail by score. Pinned UCs
  // preserve their relative order from the pin list so the SA can curate the
  // top-N explicitly.
  const pinned = getPinnedSet(answers);
  if (pinned.size === 0) {
    return scored.sort((a, b) => b.readinessScore - a.readinessScore);
  }
  const pinnedIdsInOrder = answers.refinements?.pinnedUseCaseIds || [];
  const pinnedScored = pinnedIdsInOrder
    .map(id => scored.find(r => r.useCase.id === id))
    .filter((r): r is RecommendedUseCase => !!r);
  const tail = scored
    .filter(r => !pinned.has(r.useCase.id))
    .sort((a, b) => b.readinessScore - a.readinessScore);
  return [...pinnedScored, ...tail];
}

function selectPeers(answers: AssessmentAnswers, currentPhase: number): PeerProfile[] {
  const industryIds = getAssessmentIndustryIds(answers);
  const candidates = PEER_DATABASE.filter(p => {
    // Industry match — untagged peer rows default to P&U so legacy data still
    // compares against P&U assessments. For blends, a peer is in scope if its
    // industry overlaps any of the blend ids. Non-P&U industries get an empty
    // list until peers are added (peer comparison is best-effort).
    const peerIndustry = p.industryId || 'pu';
    if (industryIds && !industryIds.includes(peerIndustry)) return false;
    return Math.abs(p.phase - currentPhase) <= 1;
  });

  const scored = candidates.map(p => {
    let score = 0;
    if (p.phase === currentPhase) score += 3;
    if (p.phase === currentPhase + 1) score += 2;

    const typeMap: Record<string, string[]> = {
      electric: ['Electric Only'],
      gas: ['Gas Only'],
      electric_gas: ['Electric & Gas'],
      water: ['Water'],
      multi: ['Multi-Commodity'],
    };
    const userType = answers.profile.utilityType ? typeMap[answers.profile.utilityType] || [] : [];
    if (userType.includes(p.type)) score += 2;

    const sizeMap: Record<string, string[]> = {
      small: ['Small'],
      medium: ['Medium'],
      large: ['Large'],
      very_large: ['Very Large'],
    };
    const userSize = answers.profile.territorySize ? sizeMap[answers.profile.territorySize] || [] : [];
    if (userSize.includes(p.territory)) score += 1;

    return { profile: p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map(s => s.profile);
}

export function assessMaturity(answers: AssessmentAnswers): AssessmentResults {
  const completed = getCompletedUseCases(answers.currentUseCases.selectedUseCases);

  // Infer completions from infrastructure answers
  // (Infrastructure answers can imply foundational data capabilities)
  // We don't auto-add use cases here — the user explicitly selects what they have

  const { phase, progress } = determinePhase(answers, completed);
  const dimensionScores = computeDimensionScores(answers, completed);
  const industryIds = getAssessmentIndustryIds(answers);
  const recommendations = computeRecommendations(answers, completed, phase);
  const peerProfiles = selectPeers(answers, phase);
  const domainProgress = computeDomainProgress(completed, industryIds);

  const overallScore = Math.round(
    (dimensionScores.dataInfra +
     dimensionScores.operationalData +
     dimensionScores.analytics +
     dimensionScores.ai +
     dimensionScores.governance) / 5
  );

  return {
    currentPhase: phase,
    phaseName: PHASE_NAMES[phase],
    overallScore,
    dimensionScores,
    completedUseCases: Array.from(completed),
    recommendations: recommendations.slice(0, 10),
    peerProfiles,
    phaseProgress: Math.round(progress),
    domainProgress,
  };
}

export function encodeAssessmentToUrl(answers: AssessmentAnswers): string {
  const encoded = btoa(JSON.stringify(answers));
  return `${window.location.origin}${window.location.pathname}?assessment=${encoded}`;
}

export function decodeAssessmentFromUrl(): AssessmentAnswers | null {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get('assessment');
  if (!encoded) return null;
  try {
    return JSON.parse(atob(encoded));
  } catch {
    return null;
  }
}
