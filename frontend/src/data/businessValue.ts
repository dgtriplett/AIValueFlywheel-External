/**
 * Business Value Calculation Engine
 *
 * Every dollar figure is derived from adjustable assumptions so a user can
 * override any input (e.g. labor rate, customer count) and see values
 * recalculate instantly.  Each use-case has a `compute` function that
 * returns an annual value range [low, high] plus a breakdown of components.
 */

// ── Base Assumptions ────────────────────────────────────────────────────────

export interface BusinessAssumptions {
  // Utility profile
  customerCount: number;           // total customers served
  annualRevenueMM: number;         // $M total annual revenue
  omBudgetMM: number;              // $M annual O&M budget
  generationFleetMW: number;       // MW of generation capacity
  tdLineMiles: number;             // miles of T&D lines
  transformerCount: number;        // distribution transformers

  // Labor & cost rates
  fieldCrewRate: number;           // $/hr loaded
  engineerRate: number;            // $/hr loaded
  dataScienceRate: number;         // $/hr loaded

  // Revenue & customer metrics
  avgResidentialRevenue: number;   // $/yr per residential customer
  avgCommercialRevenue: number;    // $/yr per commercial customer
  customerChurnPct: number;        // % annual churn

  // Grid & operations
  transformerReplaceCost: number;  // $ average replacement
  avgStormCostMM: number;          // $M per major storm event
  stormsPerYear: number;           // major storms per year
  saidiMinuteValueMM: number;      // $M per SAIDI minute across territory
  currentSAIDI: number;            // current SAIDI in minutes

  // Fuel & generation
  fuelCostPerMMBTU: number;        // $/MMBtu
  annualFuelSpendMM: number;       // $M annual fuel spend
  capacityPriceMWDay: number;      // $/MW-day in capacity market

  // Financial
  badDebtPct: number;              // % of revenue written off
  capitalBudgetMM: number;         // $M annual capital budget
  procurementSpendMM: number;      // $M annual procurement spend

  // Safety & workforce
  oshaIncidentCostK: number;       // $K total cost per recordable incident (direct + indirect)
  oshaRecordablesPerYear: number;  // recordable incidents per year
  avgReplacementCostK: number;     // $K to replace an experienced employee
  workforceSize: number;           // total headcount
  retirementEligiblePct: number;   // % eligible to retire in 5 years

  // Regulatory
  rateCasePrepCostMM: number;      // $M per rate case preparation
  regulatoryPenaltyRiskMM: number; // $M average penalty risk per year

  // Call center
  callsPerYear: number;            // annual inbound calls
  costPerCall: number;             // $ fully loaded per call

  // Scaling
  transmissionCapexMM: number;     // $M annual transmission capex
  distributionCapexMM: number;     // $M annual distribution capex

  // Index signature — admins can add custom assumption fields via the
  // Admin → Assumptions tab. Their keys land here at runtime; the rest of
  // the type-system surface stays narrow and discoverable.
  [customKey: string]: number;
}

export const DEFAULT_ASSUMPTIONS: BusinessAssumptions = {
  customerCount: 2_000_000,
  annualRevenueMM: 5_000,
  omBudgetMM: 2_000,
  generationFleetMW: 30_000,
  tdLineMiles: 100_000,
  transformerCount: 500_000,

  fieldCrewRate: 85,
  engineerRate: 125,
  dataScienceRate: 175,

  avgResidentialRevenue: 1_800,
  avgCommercialRevenue: 15_000,
  customerChurnPct: 2.5,

  transformerReplaceCost: 100_000,
  avgStormCostMM: 100,
  stormsPerYear: 3,
  saidiMinuteValueMM: 2,
  currentSAIDI: 120,

  fuelCostPerMMBTU: 4,
  annualFuelSpendMM: 500,
  capacityPriceMWDay: 150,

  badDebtPct: 2.0,
  capitalBudgetMM: 1_000,
  procurementSpendMM: 500,

  oshaIncidentCostK: 210,
  oshaRecordablesPerYear: 50,
  avgReplacementCostK: 100,
  workforceSize: 10_000,
  retirementEligiblePct: 40,

  rateCasePrepCostMM: 3,
  regulatoryPenaltyRiskMM: 5,

  callsPerYear: 10_000_000,
  costPerCall: 8,

  transmissionCapexMM: 400,
  distributionCapexMM: 600,
};

// ── Value Component ─────────────────────────────────────────────────────────

export interface ValueComponent {
  name: string;
  calculation: string;   // human-readable formula
  valueMM: number;       // $M annual value
}

export interface UseCaseValue {
  annualValueLowMM: number;   // $M low estimate
  annualValueHighMM: number;  // $M high estimate
  components: ValueComponent[];
  assumptions: string[];       // key assumptions called out
  roiMonths: number;           // estimated payback period
}

// ── Admin-editable structured value model ──────────────────────────────────
// Each use case can carry a `valueModel` with a list of components. Each
// component's annual $M value = `multiplier × Π(assumption[key])`. The low
// and high coefficients on the component scale that single value into a band.
// This is intentionally simple — admins set 4 numbers per component (mul,
// low, high) plus pick assumption keys from a dropdown — but it fits every
// existing hard-coded formula without losing precision.

export interface ValueModelComponent {
  /** Customer-facing name for this value driver (e.g. "Avoided forced outages"). */
  name: string;
  /** Optional plain-English formula display (e.g. "Annual fuel × 3%"). */
  calculationDisplay?: string;
  /** Constant multiplier baked into the formula. Encodes any % / units fold-in. */
  multiplier: number;
  /** Assumption keys whose current values are multiplied together. Empty = constant-only. */
  assumptionKeys: (keyof BusinessAssumptions)[];
  /** Low-band coefficient on the computed value. Default 0.6. */
  lowCoeff: number;
  /** High-band coefficient on the computed value. Default 1.4. */
  highCoeff: number;
}

export interface ValueModel {
  components: ValueModelComponent[];
  /** Estimated payback in months. Defaults to 12 if absent. */
  roiMonths?: number;
  /** One-line list of human-readable assumption notes, surfaced under
   *  "Key Assumptions" on the detail card. */
  assumptionNotes?: string[];
}

/** Evaluate a single component against the current assumptions to a $M value. */
export function evaluateValueComponent(
  c: ValueModelComponent,
  a: BusinessAssumptions,
): number {
  let v = c.multiplier;
  for (const key of c.assumptionKeys) {
    const x = a[key];
    if (typeof x === 'number') v *= x;
  }
  return v;
}

/** Compute UseCaseValue from a structured valueModel. */
export function computeFromValueModel(
  m: ValueModel,
  a: BusinessAssumptions,
): UseCaseValue {
  let lo = 0;
  let hi = 0;
  const components: ValueComponent[] = [];
  for (const c of m.components) {
    const raw = evaluateValueComponent(c, a);
    const cLow = raw * c.lowCoeff;
    const cHigh = raw * c.highCoeff;
    lo += cLow;
    hi += cHigh;
    components.push({
      name: c.name,
      calculation: c.calculationDisplay
        || `${c.multiplier} × ${c.assumptionKeys.join(' × ')} (band ${c.lowCoeff}–${c.highCoeff})`,
      valueMM: +((cLow + cHigh) / 2).toFixed(1),
    });
  }
  return {
    annualValueLowMM: +lo.toFixed(1),
    annualValueHighMM: +hi.toFixed(1),
    components,
    assumptions: m.assumptionNotes && m.assumptionNotes.length
      ? m.assumptionNotes
      : m.components.map(c => c.calculationDisplay || c.name),
    roiMonths: m.roiMonths ?? 12,
  };
}

// ── Per-Use-Case Value Functions ────────────────────────────────────────────

type ValueFn = (a: BusinessAssumptions) => UseCaseValue;

const VALUE_FUNCTIONS: Record<string, ValueFn> = {

  // ═══ PHASE 1 — GENERATION ═══

  p1_gen_demand_forecast: (a) => {
    const dispatchSavings = a.annualFuelSpendMM * 0.03;
    const replacementPower = a.generationFleetMW * a.capacityPriceMWDay * 365 / 1e6 * 0.005;
    return {
      annualValueLowMM: +(dispatchSavings * 0.6 + replacementPower * 0.5).toFixed(1),
      annualValueHighMM: +(dispatchSavings * 1.2 + replacementPower * 1.5).toFixed(1),
      components: [
        { name: 'Dispatch optimization from better forecasts', calculation: `${a.annualFuelSpendMM}M fuel × 3% improvement`, valueMM: +dispatchSavings.toFixed(1) },
        { name: 'Reduced replacement power purchases', calculation: `${a.generationFleetMW} MW × $${a.capacityPriceMWDay}/MW-day × 0.5% reduction`, valueMM: +replacementPower.toFixed(1) },
      ],
      assumptions: ['3% fuel efficiency from improved dispatch', '0.5% reduction in replacement power needs'],
      roiMonths: 6,
    };
  },

  p1_gen_predictive_maint: (a) => {
    const avoidedOutages = a.generationFleetMW / 5000 * 2.5; // ~$2.5M per avoided outage per 5GW
    const omReduction = a.omBudgetMM * 0.15 * 0.05; // 15% of gen O&M × 5% reduction
    return {
      annualValueLowMM: +(avoidedOutages * 0.5 + omReduction * 0.7).toFixed(1),
      annualValueHighMM: +(avoidedOutages * 1.5 + omReduction * 1.3).toFixed(1),
      components: [
        { name: 'Avoided unplanned generation outages', calculation: `${(a.generationFleetMW/1000).toFixed(0)} GW fleet × ~$2.5M per avoided outage per 5GW`, valueMM: +avoidedOutages.toFixed(1) },
        { name: 'O&M cost reduction (condition-based maintenance)', calculation: `15% of $${a.omBudgetMM}M O&M (gen share) × 5% reduction`, valueMM: +omReduction.toFixed(1) },
      ],
      assumptions: ['15% of total O&M allocated to generation', '5% O&M reduction from condition-based maintenance', 'Avg $5-15M replacement power cost per forced outage avoided'],
      roiMonths: 10,
    };
  },

  p1_gen_fleet_analytics: (a) => {
    const heatRate = a.annualFuelSpendMM * 0.02;
    const capacityFactor = a.generationFleetMW * a.capacityPriceMWDay * 365 / 1e6 * 0.01;
    return {
      annualValueLowMM: +(heatRate * 0.6 + capacityFactor * 0.5).toFixed(1),
      annualValueHighMM: +(heatRate * 1.4 + capacityFactor * 1.5).toFixed(1),
      components: [
        { name: 'Fleet heat rate improvement', calculation: `$${a.annualFuelSpendMM}M fuel × 2% efficiency gain`, valueMM: +heatRate.toFixed(1) },
        { name: 'Capacity factor improvement', calculation: `${a.generationFleetMW} MW × $${a.capacityPriceMWDay}/MW-day × 1% improvement`, valueMM: +capacityFactor.toFixed(1) },
      ],
      assumptions: ['2% fleet-wide heat rate improvement', '1% capacity factor improvement through benchmarking'],
      roiMonths: 6,
    };
  },

  p1_gen_outage_prediction: (a) => {
    const val = a.generationFleetMW / 5000 * 5; // $5M per 5GW from avoided forced outages
    return {
      annualValueLowMM: +(val * 0.6).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Avoided replacement power from predicted outages', calculation: `${(a.generationFleetMW/1000).toFixed(0)} GW × ~$5M per 5GW from proactive scheduling`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['30% reduction in forced outage rate', '$5-15M replacement power cost per major outage'],
      roiMonths: 8,
    };
  },

  p1_gen_fuel_hedging: (a) => {
    const val = a.annualFuelSpendMM * 0.04;
    return {
      annualValueLowMM: +(val * 0.5).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Fuel cost reduction through optimized hedging', calculation: `$${a.annualFuelSpendMM}M annual fuel × 4% optimization`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['4% improvement in fuel procurement & hedging effectiveness'],
      roiMonths: 5,
    };
  },

  // ═══ PHASE 1 — TRANSMISSION ═══

  p1_trans_load_congestion: (a) => {
    const val = a.transmissionCapexMM * 0.05;
    return {
      annualValueLowMM: +(val * 0.6).toFixed(1),
      annualValueHighMM: +(val * 2).toFixed(1),
      components: [
        { name: 'Congestion cost avoidance & utilization improvement', calculation: `$${a.transmissionCapexMM}M trans capex × 5% deferral/optimization`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['5% improvement in transmission utilization reducing congestion costs'],
      roiMonths: 6,
    };
  },

  p1_trans_dynamic_line_rating: (a) => {
    const val = a.transmissionCapexMM * 0.15;
    return {
      annualValueLowMM: +(val * 0.5).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Deferred transmission capital through DLR', calculation: `$${a.transmissionCapexMM}M trans capex × 15% deferral`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['10-30% capacity increase on DLR-enabled lines', '15% of transmission capex deferrable'],
      roiMonths: 8,
    };
  },

  p1_trans_predictive_maint: (a) => {
    const avoided = a.transmissionCapexMM * 0.03;
    const omSave = a.omBudgetMM * 0.10 * 0.05;
    return {
      annualValueLowMM: +(avoided * 0.5 + omSave * 0.6).toFixed(1),
      annualValueHighMM: +(avoided * 1.5 + omSave * 1.5).toFixed(1),
      components: [
        { name: 'Avoided major transmission equipment failures', calculation: `$${a.transmissionCapexMM}M capex × 3% failure avoidance`, valueMM: +avoided.toFixed(1) },
        { name: 'Transmission O&M reduction', calculation: `10% of $${a.omBudgetMM}M O&M (trans share) × 5%`, valueMM: +omSave.toFixed(1) },
      ],
      assumptions: ['10% of O&M budget allocated to transmission', '5% O&M reduction from predictive maintenance'],
      roiMonths: 10,
    };
  },

  p1_trans_veg_management: (a) => {
    const val = a.omBudgetMM * 0.04 * 0.20; // 4% of O&M is veg mgmt, 20% savings
    return {
      annualValueLowMM: +(val * 0.6).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Optimized vegetation management spending', calculation: `4% of $${a.omBudgetMM}M O&M (veg budget) × 20% efficiency`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['4% of total O&M is vegetation management', '20% efficiency gain through risk-based prioritization'],
      roiMonths: 8,
    };
  },

  p1_trans_asset_condition: (a) => {
    const val = a.transmissionCapexMM * 0.04;
    return {
      annualValueLowMM: +(val * 0.5).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Risk-informed capital allocation improvement', calculation: `$${a.transmissionCapexMM}M trans capex × 4% better allocation`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['4% improvement in capital allocation through data-driven asset health scoring'],
      roiMonths: 6,
    };
  },

  // ═══ PHASE 1 — DISTRIBUTION ═══

  p1_dist_outage_detection: (a) => {
    const saidi = a.saidiMinuteValueMM * a.currentSAIDI * 0.20;
    return {
      annualValueLowMM: +(saidi * 0.5).toFixed(1),
      annualValueHighMM: +(saidi * 1.2).toFixed(1),
      components: [
        { name: 'SAIDI improvement value', calculation: `$${a.saidiMinuteValueMM}M/min × ${a.currentSAIDI} min SAIDI × 20% improvement`, valueMM: +saidi.toFixed(1) },
      ],
      assumptions: ['20% SAIDI improvement from faster outage detection', `Current SAIDI: ${a.currentSAIDI} minutes`],
      roiMonths: 5,
    };
  },

  p1_dist_flisr: (a) => {
    const val = a.saidiMinuteValueMM * 12; // 12 minutes SAIDI reduction per fault
    return {
      annualValueLowMM: +(val * 0.5).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'SAIDI reduction from faster fault isolation', calculation: `$${a.saidiMinuteValueMM}M/SAIDI min × 12 min improvement`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['12 minute average SAIDI improvement per fault event'],
      roiMonths: 6,
    };
  },

  p1_dist_predictive_maint: (a) => {
    const failures = a.transformerCount * 0.005 * a.transformerReplaceCost / 1e6 * 0.30;
    const omSave = a.omBudgetMM * 0.20 * 0.05;
    return {
      annualValueLowMM: +(failures * 0.5 + omSave * 0.6).toFixed(1),
      annualValueHighMM: +(failures * 1.5 + omSave * 1.5).toFixed(1),
      components: [
        { name: 'Avoided distribution equipment failures', calculation: `${a.transformerCount.toLocaleString()} transformers × 0.5% fail rate × $${(a.transformerReplaceCost/1000).toFixed(0)}K × 30% reduction`, valueMM: +failures.toFixed(1) },
        { name: 'Distribution O&M reduction', calculation: `20% of $${a.omBudgetMM}M O&M (dist share) × 5%`, valueMM: +omSave.toFixed(1) },
      ],
      assumptions: ['0.5% annual transformer failure rate', '30% of failures preventable with predictive maintenance', '20% of O&M budget allocated to distribution'],
      roiMonths: 10,
    };
  },

  p1_dist_feeder_forecast: (a) => {
    const val = a.distributionCapexMM * 0.05;
    return {
      annualValueLowMM: +(val * 0.5).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Distribution capital planning optimization', calculation: `$${a.distributionCapexMM}M dist capex × 5% better allocation`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['5% improvement in distribution capital planning through feeder-level forecasting'],
      roiMonths: 6,
    };
  },

  p1_dist_reliability_monitoring: (a) => {
    const val = a.regulatoryPenaltyRiskMM * 0.4;
    return {
      annualValueLowMM: +(val * 0.5).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Regulatory penalty avoidance & compliance', calculation: `$${a.regulatoryPenaltyRiskMM}M penalty risk × 40% reduction`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['40% reduction in regulatory penalty risk through real-time monitoring'],
      roiMonths: 4,
    };
  },

  // ═══ PHASE 1 — CUSTOMER ═══

  p1_cust_segmentation: (a) => {
    const enrollment = a.customerCount * 0.01 * a.avgResidentialRevenue * 0.05 / 1e6;
    return {
      annualValueLowMM: +(enrollment * 0.5).toFixed(1),
      annualValueHighMM: +(enrollment * 2).toFixed(1),
      components: [
        { name: 'Improved program targeting & enrollment', calculation: `${(a.customerCount/1e6).toFixed(1)}M customers × 1% better enrollment × $${a.avgResidentialRevenue} × 5% margin`, valueMM: +enrollment.toFixed(1) },
      ],
      assumptions: ['1% enrollment improvement from better segmentation', '5% margin on incremental program enrollment'],
      roiMonths: 4,
    };
  },

  p1_cust_knowledge_agents: (a) => {
    const aht = a.callsPerYear * a.costPerCall * 0.20 / 1e6;
    return {
      annualValueLowMM: +(aht * 0.5).toFixed(1),
      annualValueHighMM: +(aht * 1.2).toFixed(1),
      components: [
        { name: 'Call handle time reduction', calculation: `${(a.callsPerYear/1e6).toFixed(0)}M calls × $${a.costPerCall}/call × 20% AHT reduction`, valueMM: +aht.toFixed(1) },
      ],
      assumptions: ['20% average handle time reduction with AI knowledge agent'],
      roiMonths: 4,
    };
  },

  p1_cust_nba: (a) => {
    const churn = a.customerCount * (a.customerChurnPct / 100) * 0.15 * a.avgResidentialRevenue / 1e6;
    return {
      annualValueLowMM: +(churn * 0.5).toFixed(1),
      annualValueHighMM: +(churn * 1.5).toFixed(1),
      components: [
        { name: 'Churn reduction & program enrollment', calculation: `${(a.customerCount/1e6).toFixed(1)}M × ${a.customerChurnPct}% churn × 15% reduction × $${a.avgResidentialRevenue}/yr`, valueMM: +churn.toFixed(1) },
      ],
      assumptions: ['15% reduction in voluntary churn through personalized next-best-action'],
      roiMonths: 6,
    };
  },

  p1_cust_billing_anomaly: (a) => {
    const val = a.annualRevenueMM * 0.6 * 0.02 * 0.50; // 60% residential × 2% exposure × 50% recovery
    return {
      annualValueLowMM: +(val * 0.5).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Revenue recovery from theft & billing anomalies', calculation: `$${a.annualRevenueMM}M rev × 60% residential × 2% exposure × 50% recovery rate`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['2% of residential revenue at risk from theft/errors', '50% recovery improvement from ML detection'],
      roiMonths: 5,
    };
  },

  p1_cust_payment_risk: (a) => {
    const val = a.annualRevenueMM * (a.badDebtPct / 100) * 0.25;
    return {
      annualValueLowMM: +(val * 0.5).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Bad debt reduction', calculation: `$${a.annualRevenueMM}M rev × ${a.badDebtPct}% bad debt × 25% reduction`, valueMM: +val.toFixed(1) },
      ],
      assumptions: [`Current bad debt rate: ${a.badDebtPct}%`, '25% reduction through predictive collections optimization'],
      roiMonths: 4,
    };
  },

  // ═══ PHASE 1 — REGULATORY ═══

  p1_reg_load_resource_planning: (a) => {
    const val = a.capitalBudgetMM * 0.02;
    return {
      annualValueLowMM: +(val * 0.5).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Improved capital investment decisions', calculation: `$${a.capitalBudgetMM}M capital × 2% better allocation`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['2% improvement in capital allocation through analytics-driven IRP'],
      roiMonths: 8,
    };
  },

  p1_reg_rate_case: (a) => {
    const val = a.rateCasePrepCostMM * 0.30;
    return {
      annualValueLowMM: +(val * 0.5).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Rate case preparation cost reduction', calculation: `$${a.rateCasePrepCostMM}M per rate case × 30% efficiency`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['30% reduction in rate case preparation costs', `Rate case cost: $${a.rateCasePrepCostMM}M`],
      roiMonths: 6,
    };
  },

  p1_reg_policy_simulation: (a) => {
    const val = a.capitalBudgetMM * 0.03;
    return {
      annualValueLowMM: +(val * 0.4).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Strategic planning value from scenario modeling', calculation: `$${a.capitalBudgetMM}M capital × 3% optimization through scenario analysis`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['3% capital budget optimization from better regulatory scenario analysis'],
      roiMonths: 10,
    };
  },

  p1_reg_portfolio_risk: (a) => {
    const val = a.annualFuelSpendMM * 0.02;
    return {
      annualValueLowMM: +(val * 0.5).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Risk-adjusted portfolio margin improvement', calculation: `$${a.annualFuelSpendMM}M portfolio × 2% risk-adjusted improvement`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['2% improvement in risk-adjusted portfolio returns'],
      roiMonths: 6,
    };
  },

  p1_reg_compliance_monitoring: (a) => {
    const val = a.regulatoryPenaltyRiskMM * 0.30;
    return {
      annualValueLowMM: +(val * 0.5).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Compliance cost reduction & penalty avoidance', calculation: `$${a.regulatoryPenaltyRiskMM}M penalty risk × 30% reduction`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['30% reduction in compliance risk through automated monitoring'],
      roiMonths: 4,
    };
  },

  // ═══ PHASE 1 — CORPORATE ═══

  p1_corp_spend_analytics: (a) => {
    const val = a.procurementSpendMM * 0.03;
    return {
      annualValueLowMM: +(val * 0.5).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Procurement savings', calculation: `$${a.procurementSpendMM}M spend × 3% savings`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['3% procurement savings through spend analytics and maverick spend identification'],
      roiMonths: 4,
    };
  },

  p1_corp_capital_analytics: (a) => {
    const val = a.capitalBudgetMM * 0.02;
    return {
      annualValueLowMM: +(val * 0.5).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Capital efficiency improvement', calculation: `$${a.capitalBudgetMM}M capital × 2% efficiency gain`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['2% improvement in capital project on-time/on-budget delivery'],
      roiMonths: 6,
    };
  },

  p1_corp_workforce_planning: (a) => {
    const attrition = a.workforceSize * (a.retirementEligiblePct / 100) * 0.10 * a.avgReplacementCostK / 1e3;
    return {
      annualValueLowMM: +(attrition * 0.5).toFixed(1),
      annualValueHighMM: +(attrition * 1.5).toFixed(1),
      components: [
        { name: 'Reduced hiring costs & knowledge retention', calculation: `${a.workforceSize.toLocaleString()} employees × ${a.retirementEligiblePct}% retiring × 10% preventable × $${a.avgReplacementCostK}K`, valueMM: +attrition.toFixed(1) },
      ],
      assumptions: ['10% of attrition preventable through proactive workforce planning', `Replacement cost: $${a.avgReplacementCostK}K per employee`],
      roiMonths: 6,
    };
  },

  p1_corp_safety_analytics: (a) => {
    const val = a.oshaRecordablesPerYear * 0.25 * a.oshaIncidentCostK / 1e3;
    return {
      annualValueLowMM: +(val * 0.5).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Injury reduction & insurance savings', calculation: `${a.oshaRecordablesPerYear} incidents/yr × 25% reduction × $${a.oshaIncidentCostK}K/incident`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['25% reduction in OSHA recordable incidents', `Total cost per incident: $${a.oshaIncidentCostK}K (direct + indirect)`],
      roiMonths: 6,
    };
  },

  p1_corp_it_ot_security: (a) => {
    const val = a.regulatoryPenaltyRiskMM * 0.5 + a.annualRevenueMM * 0.001;
    return {
      annualValueLowMM: +(val * 0.4).toFixed(1),
      annualValueHighMM: +(val * 1.5).toFixed(1),
      components: [
        { name: 'Cybersecurity risk reduction', calculation: `$${a.regulatoryPenaltyRiskMM}M penalty risk × 50% + $${a.annualRevenueMM}M rev × 0.1% breach risk`, valueMM: +val.toFixed(1) },
      ],
      assumptions: ['50% reduction in NERC CIP penalty risk', '0.1% revenue at risk from cyber breach'],
      roiMonths: 8,
    };
  },
};

// ── Generic Fallback for use cases without specific formulas ─────────────

/** Deterministic [0, 1) hash from a UC id — used to spread the generic-value
 *  estimate across same-shape UCs so two phase-1 / complexity-3 UCs don't
 *  end up at identical $M values just because neither has a hand-typed
 *  formula. */
function _stableHash01(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return (Math.abs(h) % 1000) / 1000;
}

function genericValue(a: BusinessAssumptions, phase: number, complexity: number, ucId?: string): UseCaseValue {
  // Phase 2 and 3 UCs generally build on Phase 1 and unlock more value.
  const phaseMultiplier = phase === 1 ? 1 : phase === 2 ? 1.5 : 2.5;
  // Complexity scales the value envelope — higher-complexity work typically
  // unlocks more value (more systems integrated, more decisions automated).
  // Anchor: cx3 ≈ legacy 1.0×; cx1 → 0.6×; cx5 → 1.4×.
  const cxMultiplier = 0.4 + complexity * 0.2;
  // Stable per-UC jitter so two UCs with the same phase + complexity still
  // show different $ numbers in the slide deck and on the dashboard.
  // ±15% spread, deterministic per id.
  const jitter = ucId ? (0.85 + _stableHash01(ucId) * 0.30) : 1.0;
  const base = a.omBudgetMM * 0.002 * phaseMultiplier * cxMultiplier * jitter;
  return {
    annualValueLowMM: +(base * 0.5).toFixed(1),
    annualValueHighMM: +(base * 2).toFixed(1),
    components: [
      {
        name: 'Estimated operational value',
        calculation: `${(a.omBudgetMM * 0.002).toFixed(2)}M base × ${phaseMultiplier.toFixed(1)} (phase) × ${cxMultiplier.toFixed(2)} (complexity ${complexity}/5)`,
        valueMM: +base.toFixed(1),
      },
    ],
    assumptions: [
      'Coarse generic estimate — accurate for relative ranking; refine with a UC-specific formula for higher fidelity.',
    ],
    roiMonths: phase === 1 ? 6 : phase === 2 ? 12 : 18,
  };
}

// Add Phase 2 and 3 formulas for key use cases

// Phase 2 highlights
VALUE_FUNCTIONS.p2_gen_digital_twin = (a) => {
  const val = a.annualFuelSpendMM * 0.03 + a.omBudgetMM * 0.15 * 0.03;
  return {
    annualValueLowMM: +(val * 0.5).toFixed(1), annualValueHighMM: +(val * 1.5).toFixed(1),
    components: [
      { name: 'Optimized dispatch & reduced downtime via digital twin', calculation: `$${a.annualFuelSpendMM}M fuel × 3% + gen O&M × 3%`, valueMM: +val.toFixed(1) },
    ],
    assumptions: ['3% additional dispatch optimization beyond Phase 1', '3% O&M reduction from simulation-based maintenance'],
    roiMonths: 14,
  };
};

VALUE_FUNCTIONS.p2_dist_storm_prediction = (a) => {
  const val = a.avgStormCostMM * a.stormsPerYear * 0.20;
  return {
    annualValueLowMM: +(val * 0.5).toFixed(1), annualValueHighMM: +(val * 1.5).toFixed(1),
    components: [
      { name: 'Storm restoration cost reduction', calculation: `$${a.avgStormCostMM}M/storm × ${a.stormsPerYear} storms/yr × 20% reduction`, valueMM: +val.toFixed(1) },
    ],
    assumptions: ['20% storm restoration cost reduction from predictive staging', `${a.stormsPerYear} major storms per year at $${a.avgStormCostMM}M avg cost`],
    roiMonths: 6,
  };
};

VALUE_FUNCTIONS.p2_dist_der_ev = (a) => {
  const val = a.distributionCapexMM * 0.10;
  return {
    annualValueLowMM: +(val * 0.5).toFixed(1), annualValueHighMM: +(val * 1.5).toFixed(1),
    components: [
      { name: 'Deferred distribution infrastructure from DER/EV management', calculation: `$${a.distributionCapexMM}M dist capex × 10% deferral`, valueMM: +val.toFixed(1) },
    ],
    assumptions: ['10% of distribution capital deferrable through active DER/EV management'],
    roiMonths: 12,
  };
};

VALUE_FUNCTIONS.p2_cust_dynamic_pricing = (a) => {
  const val = a.annualRevenueMM * 0.005;
  return {
    annualValueLowMM: +(val * 0.5).toFixed(1), annualValueHighMM: +(val * 1.5).toFixed(1),
    components: [
      { name: 'Revenue optimization from dynamic pricing', calculation: `$${a.annualRevenueMM}M revenue × 0.5% optimization`, valueMM: +val.toFixed(1) },
    ],
    assumptions: ['0.5% revenue optimization through personalized rate design and demand response'],
    roiMonths: 12,
  };
};

// Phase 3 highlights
VALUE_FUNCTIONS.p3_dist_self_healing = (a) => {
  const val = a.saidiMinuteValueMM * a.currentSAIDI * 0.60;
  return {
    annualValueLowMM: +(val * 0.3).toFixed(1), annualValueHighMM: +(val * 0.8).toFixed(1),
    components: [
      { name: 'Near-zero sustained outage value', calculation: `$${a.saidiMinuteValueMM}M/min × ${a.currentSAIDI} SAIDI × 60% elimination`, valueMM: +val.toFixed(1) },
    ],
    assumptions: ['60% SAIDI elimination from self-healing network automation'],
    roiMonths: 24,
  };
};

VALUE_FUNCTIONS.p3_cust_ai_self_service = (a) => {
  const val = a.callsPerYear * a.costPerCall * 0.50 / 1e6;
  return {
    annualValueLowMM: +(val * 0.5).toFixed(1), annualValueHighMM: +(val * 1.0).toFixed(1),
    components: [
      { name: 'Contact center cost reduction from AI self-service', calculation: `${(a.callsPerYear/1e6).toFixed(0)}M calls × $${a.costPerCall}/call × 50% deflection`, valueMM: +val.toFixed(1) },
    ],
    assumptions: ['50% of inbound contacts resolved by autonomous AI agent'],
    roiMonths: 14,
  };
};

VALUE_FUNCTIONS.p3_gen_zero_unplanned = (a) => {
  const val = a.generationFleetMW / 1000 * 10;
  return {
    annualValueLowMM: +(val * 0.4).toFixed(1), annualValueHighMM: +(val * 1.2).toFixed(1),
    components: [
      { name: 'Eliminated forced outage costs across fleet', calculation: `${(a.generationFleetMW/1000).toFixed(0)} GW × ~$10M/GW from zero forced outages`, valueMM: +val.toFixed(1) },
    ],
    assumptions: ['Near-zero forced outages across generation fleet', '$10M/GW annual value from eliminated replacement power'],
    roiMonths: 30,
  };
};

// ── Public API ──────────────────────────────────────────────────────────────

import { USE_CASES } from './useCases';

export function computeUseCaseValue(
  useCaseId: string,
  assumptions: BusinessAssumptions,
  /** Per-UC override from `answers.refinements.valueOverrides`. When set,
   *  wins over the catalog valueModel + hardcoded function. Either side of
   *  the range may be omitted — the missing side falls back to the
   *  catalog-derived value. */
  override?: { annualValueLowMM?: number; annualValueHighMM?: number } | null,
): UseCaseValue {
  // Compute the base first so override can fall back per-field.
  const uc = USE_CASES.find(u => u.id === useCaseId);
  let base: UseCaseValue;
  if (uc?.valueModel && uc.valueModel.components?.length > 0) {
    base = computeFromValueModel(uc.valueModel, assumptions);
  } else {
    const fn = VALUE_FUNCTIONS[useCaseId];
    if (fn) base = fn(assumptions);
    else {
      const phase = uc?.phase ?? 1;
      const complexity = uc?.complexity ?? 3;
      base = genericValue(assumptions, phase, complexity, useCaseId);
    }
  }

  if (!override) return base;
  return {
    ...base,
    annualValueLowMM: typeof override.annualValueLowMM === 'number'
      ? override.annualValueLowMM
      : base.annualValueLowMM,
    annualValueHighMM: typeof override.annualValueHighMM === 'number'
      ? override.annualValueHighMM
      : base.annualValueHighMM,
  };
}

export function computeTotalPortfolioValue(
  useCaseIds: string[],
  assumptions: BusinessAssumptions
): { totalLowMM: number; totalHighMM: number } {
  let totalLow = 0;
  let totalHigh = 0;
  for (const id of useCaseIds) {
    const v = computeUseCaseValue(id, assumptions);
    totalLow += v.annualValueLowMM;
    totalHigh += v.annualValueHighMM;
  }
  return { totalLowMM: +totalLow.toFixed(1), totalHighMM: +totalHigh.toFixed(1) };
}

/** Editable assumption metadata for UI rendering. The catalog is layered:
 *  built-in fields (in this file) form the base, and admin overrides /
 *  custom fields stored in the database compose on top. Both flow through
 *  the same UI surface. */
export interface AssumptionField {
  key: string;
  label: string;
  unit: string;
  step: number;
  min: number;
  max: number;
  category: string;
  /** If set, only show in the Assumptions panel when the customer's utility
   *  type matches one of these. Omit to always show. */
  relevantFor?: ('electric' | 'gas' | 'electric_gas' | 'generation_only' | 'nuclear')[];
  /** Set on admin-added fields whose key does NOT match a built-in. */
  isCustom?: boolean;
  /** Set when an admin override is layered on top of a built-in field. */
  isOverridden?: boolean;
  /** Default value used to seed a fresh assumptions object. Built-in fields
   *  carry their default in DEFAULT_ASSUMPTIONS; custom / override rows
   *  carry it on the field record itself. */
  defaultValue?: number;
}

const HAS_RETAIL: AssumptionField['relevantFor'] = ['electric', 'gas', 'electric_gas'];
const HAS_GRID: AssumptionField['relevantFor'] = ['electric', 'gas', 'electric_gas'];
const HAS_GEN: AssumptionField['relevantFor'] = ['electric', 'electric_gas', 'generation_only', 'nuclear'];

export const ASSUMPTION_FIELDS: AssumptionField[] = [
  // Utility profile
  { key: 'customerCount', label: 'Total Customers', unit: '', step: 100_000, min: 50_000, max: 10_000_000, category: 'Utility Profile', relevantFor: HAS_RETAIL },
  { key: 'annualRevenueMM', label: 'Annual Revenue', unit: '$M', step: 100, min: 100, max: 20_000, category: 'Utility Profile' },
  { key: 'omBudgetMM', label: 'O&M Budget', unit: '$M', step: 50, min: 50, max: 10_000, category: 'Utility Profile' },
  { key: 'generationFleetMW', label: 'Generation Fleet', unit: 'MW', step: 1_000, min: 0, max: 100_000, category: 'Utility Profile', relevantFor: HAS_GEN },
  { key: 'tdLineMiles', label: 'T&D Line Miles', unit: 'mi', step: 5_000, min: 1_000, max: 500_000, category: 'Utility Profile', relevantFor: HAS_GRID },
  { key: 'transformerCount', label: 'Distribution Transformers', unit: '', step: 50_000, min: 10_000, max: 2_000_000, category: 'Utility Profile', relevantFor: HAS_GRID },
  // Labor rates — apply universally
  { key: 'fieldCrewRate', label: 'Field Crew Loaded Rate', unit: '$/hr', step: 5, min: 40, max: 200, category: 'Labor Rates' },
  { key: 'engineerRate', label: 'Engineer Loaded Rate', unit: '$/hr', step: 5, min: 60, max: 300, category: 'Labor Rates' },
  { key: 'dataScienceRate', label: 'Data Science Loaded Rate', unit: '$/hr', step: 5, min: 80, max: 350, category: 'Labor Rates' },
  // Customer — only retail utilities
  { key: 'avgResidentialRevenue', label: 'Avg Residential Revenue', unit: '$/yr', step: 100, min: 500, max: 5_000, category: 'Customer Metrics', relevantFor: HAS_RETAIL },
  { key: 'customerChurnPct', label: 'Annual Churn Rate', unit: '%', step: 0.5, min: 0.5, max: 10, category: 'Customer Metrics', relevantFor: HAS_RETAIL },
  { key: 'badDebtPct', label: 'Bad Debt Rate', unit: '%', step: 0.25, min: 0.25, max: 5, category: 'Customer Metrics', relevantFor: HAS_RETAIL },
  { key: 'callsPerYear', label: 'Annual Calls', unit: '', step: 500_000, min: 100_000, max: 50_000_000, category: 'Customer Metrics', relevantFor: HAS_RETAIL },
  { key: 'costPerCall', label: 'Cost per Call', unit: '$', step: 1, min: 3, max: 25, category: 'Customer Metrics', relevantFor: HAS_RETAIL },
  // Grid & operations — only utilities running a grid
  { key: 'saidiMinuteValueMM', label: 'SAIDI Minute Value', unit: '$M/min', step: 0.5, min: 0.5, max: 10, category: 'Grid Operations', relevantFor: HAS_GRID },
  { key: 'currentSAIDI', label: 'Current SAIDI', unit: 'min', step: 10, min: 30, max: 500, category: 'Grid Operations', relevantFor: HAS_GRID },
  { key: 'avgStormCostMM', label: 'Avg Major Storm Cost', unit: '$M', step: 10, min: 10, max: 500, category: 'Grid Operations', relevantFor: HAS_GRID },
  { key: 'stormsPerYear', label: 'Major Storms/Year', unit: '', step: 1, min: 0, max: 15, category: 'Grid Operations', relevantFor: HAS_GRID },
  { key: 'transformerReplaceCost', label: 'Avg Transformer Replace Cost', unit: '$', step: 10_000, min: 10_000, max: 1_000_000, category: 'Grid Operations', relevantFor: HAS_GRID },
  // Generation & fuel — only generation operators
  { key: 'annualFuelSpendMM', label: 'Annual Fuel Spend', unit: '$M', step: 25, min: 0, max: 3_000, category: 'Generation', relevantFor: HAS_GEN },
  { key: 'fuelCostPerMMBTU', label: 'Fuel Cost', unit: '$/MMBtu', step: 0.5, min: 1, max: 15, category: 'Generation', relevantFor: HAS_GEN },
  { key: 'capacityPriceMWDay', label: 'Capacity Price', unit: '$/MW-day', step: 25, min: 25, max: 500, category: 'Generation', relevantFor: HAS_GEN },
  // Financial
  { key: 'capitalBudgetMM', label: 'Annual Capital Budget', unit: '$M', step: 50, min: 50, max: 5_000, category: 'Financial' },
  { key: 'procurementSpendMM', label: 'Annual Procurement Spend', unit: '$M', step: 25, min: 25, max: 3_000, category: 'Financial' },
  { key: 'transmissionCapexMM', label: 'Transmission Capex', unit: '$M', step: 25, min: 25, max: 2_000, category: 'Financial', relevantFor: HAS_GRID },
  { key: 'distributionCapexMM', label: 'Distribution Capex', unit: '$M', step: 25, min: 25, max: 3_000, category: 'Financial', relevantFor: HAS_GRID },
  // Safety & workforce — universal (all utility types have crews)
  { key: 'oshaIncidentCostK', label: 'Cost per OSHA Incident', unit: '$K', step: 10, min: 50, max: 500, category: 'Safety & Workforce' },
  { key: 'oshaRecordablesPerYear', label: 'Recordable Incidents / Year', unit: '', step: 5, min: 5, max: 200, category: 'Safety & Workforce' },
  { key: 'workforceSize', label: 'Total Headcount', unit: '', step: 500, min: 500, max: 50_000, category: 'Safety & Workforce' },
  { key: 'retirementEligiblePct', label: 'Retirement Eligible', unit: '%', step: 5, min: 10, max: 70, category: 'Safety & Workforce' },
  { key: 'avgReplacementCostK', label: 'Employee Replacement Cost', unit: '$K', step: 10, min: 25, max: 300, category: 'Safety & Workforce' },
  // Regulatory — universal
  { key: 'rateCasePrepCostMM', label: 'Rate Case Prep Cost', unit: '$M', step: 0.5, min: 0.5, max: 10, category: 'Regulatory', relevantFor: HAS_RETAIL },
  { key: 'regulatoryPenaltyRiskMM', label: 'Regulatory Penalty Risk', unit: '$M/yr', step: 1, min: 1, max: 25, category: 'Regulatory' },
];

/** Filter the assumption fields to those relevant for a given utility type.
 *  Returns all fields if no type is set. */
export function assumptionFieldsFor(
  utilityType: 'electric' | 'gas' | 'electric_gas' | 'generation_only' | 'nuclear' | null | undefined,
  fields: AssumptionField[] = ASSUMPTION_FIELDS,
): AssumptionField[] {
  if (!utilityType) return fields;
  return fields.filter(f => !f.relevantFor || (f.relevantFor as string[]).includes(utilityType));
}

/** Resolve the base assumption-field list for a given industry. Industry
 *  packs that declare their own `assumptionFields` (e.g. Transportation &
 *  Logistics, Manufacturing) replace the legacy P&U list entirely — those
 *  packs have their own categories ("Profile", "Operations", "Warehouse")
 *  that don't make sense to mix with "Utility Profile" / "Grid Operations".
 *  Packs without declared fields fall back to ASSUMPTION_FIELDS so existing
 *  P&U deploys keep working unchanged. */
export function assumptionFieldsForIndustry(
  industry: { assumptionFields?: IndustryAssumptionField[] | null } | null | undefined,
): AssumptionField[] {
  const packFields = industry?.assumptionFields;
  if (!packFields || packFields.length === 0) return ASSUMPTION_FIELDS;
  return packFields.map(f => ({
    key: f.key,
    label: f.label,
    unit: f.unit,
    step: f.step,
    min: f.min,
    max: f.max,
    category: f.category,
    defaultValue: f.defaultValue,
    relevantFor: f.relevantFor as AssumptionField['relevantFor'],
  }));
}

// Re-export the industry pack's typed shape so call sites don't need a
// separate import.
import type { IndustryAssumptionField } from '../industries/types';
export type { IndustryAssumptionField };

// ── Custom assumption fields — admin-managed catalog ───────────────────────
// Module-level cache so any component can reach the merged catalog without
// threading props. App.tsx hydrates this once at startup via setCustomAssumptionFields().

let _customFields: AssumptionField[] = [];
const _customFieldListeners: Set<() => void> = new Set();

/** Replace the cached admin-managed catalog (called once at app boot, and
 *  again when an admin saves a change). The list contains BOTH overrides
 *  for built-in fields (matching key) AND pure custom fields (new keys).
 *  We don't classify here — `getAllAssumptionFields()` does the merge. */
export function setCustomAssumptionFields(fields: AssumptionField[]): void {
  _customFields = [...fields];
  for (const fn of _customFieldListeners) {
    try { fn(); } catch { /* swallow */ }
  }
}

export function getCustomAssumptionFields(): AssumptionField[] {
  return _customFields;
}

/** Subscribe to custom-field changes. Returns an unsubscribe function. */
export function subscribeCustomAssumptionFields(fn: () => void): () => void {
  _customFieldListeners.add(fn);
  return () => _customFieldListeners.delete(fn);
}

/** Built-in keys, materialized once for fast lookup in the merge. */
const _builtInKeys = new Set(ASSUMPTION_FIELDS.map(f => f.key));

/** Combined catalog: built-in fields with admin overrides composed on top,
 *  plus pure-custom fields whose keys don't match a built-in. Order:
 *    1. Built-ins (in declaration order) with overrides applied
 *    2. Pure custom fields (admin-added, no built-in counterpart)
 *  Use this for any UI that picks an assumption key. */
export function getAllAssumptionFields(): AssumptionField[] {
  const overrideByKey = new Map<string, AssumptionField>();
  for (const f of _customFields) overrideByKey.set(f.key, f);

  const merged: AssumptionField[] = [];
  for (const builtIn of ASSUMPTION_FIELDS) {
    const ovr = overrideByKey.get(builtIn.key);
    if (ovr) {
      // Admin override — composed on top of the built-in. Override fields
      // win except where they're empty/null.
      merged.push({
        ...builtIn,
        ...ovr,
        relevantFor: ovr.relevantFor && ovr.relevantFor.length > 0 ? ovr.relevantFor : builtIn.relevantFor,
        isCustom: false,
        isOverridden: true,
      });
      overrideByKey.delete(builtIn.key);
    } else {
      merged.push(builtIn);
    }
  }
  // Anything left in the override map = pure custom field.
  for (const [, f] of overrideByKey) {
    merged.push({ ...f, isCustom: true, isOverridden: false });
  }
  return merged;
}

/** True iff the key matches a built-in field. */
export function isBuiltInAssumptionKey(key: string): boolean {
  return _builtInKeys.has(key);
}

/** Build the initial assumptions object — built-in defaults plus custom
 *  + industry-pack field defaults. Customer-side code uses this to seed
 *  wizard state. When `industry` is provided, its pack's `assumptionFields`
 *  defaults are layered in (overriding the legacy P&U built-ins for fields
 *  the pack defines), and the pack acts as the base for industries that
 *  don't share P&U's keys. */
export function buildDefaultAssumptions(
  industry?: { assumptionFields?: IndustryAssumptionField[] | null } | null,
): BusinessAssumptions {
  const out: BusinessAssumptions = { ...DEFAULT_ASSUMPTIONS };
  // Industry-pack defaults — apply before custom so admin custom overrides
  // can still win.
  const packFields = industry?.assumptionFields || [];
  for (const f of packFields) {
    if (typeof f.defaultValue === 'number') {
      out[f.key] = f.defaultValue;
    }
  }
  for (const f of _customFields) {
    if (typeof out[f.key] !== 'number' && typeof f.defaultValue === 'number') {
      out[f.key] = f.defaultValue;
    }
  }
  return out;
}

