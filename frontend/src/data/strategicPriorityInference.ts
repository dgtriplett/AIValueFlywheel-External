/**
 * Strategic-priority inference for use cases.
 *
 * The Executive Summary tab rolls recommended UCs up by the strategic
 * priorities the customer declared in their profile (reliability,
 * cost_reduction, customer, compliance, revenue, sustainability, safety,
 * workforce). Mappings come from three sources, unioned:
 *
 *   1. **Explicit** — `uc.strategicPriorities` on the catalog row. Hand-tagged
 *      and authoritative. Empty on most seed UCs today.
 *   2. **Curated** — `STRATEGIC_UC_MAP` in ExecutiveSummaryTab.tsx. Original
 *      P&U-specific hand-curated mapping. Stays as ground truth for those UCs.
 *   3. **Inferred** — this module. Keyword match over `name`, `description`,
 *      `domain`, and `tags` to assign a default set of priorities. Runs over
 *      every UC, including non-P&U industry packs, so the rollup never has
 *      cross-industry coverage gaps.
 *
 * Inference is intentionally generous: a UC about predictive maintenance gets
 * BOTH `reliability` (asset uptime) AND `cost_reduction` (avoided OPEX). That
 * matches how an SA would actually pitch it to a customer.
 */
import type { UseCase } from './useCases';

/** Keyword sets per priority. Matched case-insensitively against the UC's
 *  name + description + tags + domain. Word boundaries are loose — we use
 *  substring match because keywords like "outage" should match "outage
 *  detection" and "proactive outage comms" equally. */
const KEYWORDS: Record<string, string[]> = {
  reliability: [
    'outage', 'restoration', 'flisr', 'fault', 'predictive maintenance',
    'predictive maint', 'reliability', 'uptime', 'downtime', 'asset health',
    'equipment failure', 'storm', 'vegetation', 'line rating', 'self-healing',
    'self healing', 'feeder forecast', 'grid stability', 'grid reliability',
    'transformer health', 'pipeline integrity', 'methane',
    // generic ops keywords that imply reliability in mfg / industrial
    'preventive', 'condition monitoring', 'mtbf', 'oee', 'yield', 'defect',
    'quality control', 'inspection',
  ],
  cost_reduction: [
    'cost', 'spend', 'opex', 'capital analytics', 'procurement', 'optimization',
    'fleet analytics', 'financial close', 'automation', 'fuel hedging',
    'voltage optimization', 'efficiency', 'productivity', 'consolidation',
    'rationalization', 'auto procurement', 'self-optimizing', 'lean',
    'inventory optimization', 'logistics', 'route optimization', 'energy efficiency',
    'workforce productivity',
    // back-office finance / working-capital plays
    'working capital', 'cash flow', 'ap/ar', 'accounts payable',
    'accounts receivable', 'days sales outstanding', 'dso', 'days payable',
    'invoice processing', 'aging dashboard', 'aging analysis',
  ],
  customer: [
    // Multi-word phrases first — high-precision. Single-word 'customer' is
    // intentionally NOT in the list: it fires on back-office UCs that just
    // mention customers in passing (e.g. AP/AR working-capital dashboards).
    'customer journey', 'customer experience', 'customer satisfaction',
    'customer service', 'customer self', 'customer engagement',
    'customer-facing', 'customer facing', 'customer success', 'customer 360',
    'customer support',
    // Standalones — narrow enough on their own that the false-positive rate
    // is low across realistic UC catalogs.
    'segmentation', 'nps', 'next best action', 'next-best action',
    'knowledge agent', 'self-service', 'self service', 'proactive outage',
    'dynamic pricing', 'concierge', 'churn', 'retention', 'personalization',
    'recommendation engine', 'satisfaction', 'cx dashboard', 'cx platform',
    'journey orchestration',
  ],
  compliance: [
    'compliance', 'regulatory', 'rate case', 'audit', 'esg', 'climate risk',
    'governance', 'reporting', 'kyc', 'aml', 'pci', 'gdpr', 'hipaa', 'sox',
    'data lineage', 'data quality', 'data governance', 'lineage', 'attestation',
    'autonomous compliance', 'enterprise risk',
  ],
  revenue: [
    'demand forecast', 'fuel hedging', 'billing anomaly', 'pricing', 'monetization',
    'marketplace', 'ancillary', 'grid services', 'behind-the-meter', 'behind the meter',
    'renewable storage', 'portfolio optimization', 'trading', 'new product', 'cross-sell',
    'cross sell', 'upsell', 'forecast accuracy', 'revenue', 'pricing optimization',
    'monetiz', 'siting capacity', 'capacity siting',
  ],
  sustainability: [
    'decarbonization', 'decarbonisation', 'emission', 'carbon', 'renewable', 'methane',
    'climate', 'sustainability', 'esg', 'living irp', 'carbon coach', 'scope 1',
    'scope 2', 'scope 3', 'net zero', 'net-zero', 'green',
  ],
  safety: [
    'safety', 'hazard', 'trir', 'incident', 'worker safety', 'work safety',
    'workplace safety', 'security', 'it/ot security', 'it-ot security',
    'physical security', 'asset protection', 'osha', 'phmsa',
  ],
  workforce: [
    'workforce', 'talent', 'knowledge', 'copilot', 'document processing',
    'productivity', 'agent', 'training', 'onboarding', 'crew', 'work package',
    'work order', 'dispatch', 'staffing',
  ],
};

/** Word list compiled once per session. */
const KEYWORD_LIST: Array<[string, RegExp]> = Object.entries(KEYWORDS).flatMap(
  ([priority, words]) => words.map(w => [priority, new RegExp(escapeRegex(w), 'i')] as [string, RegExp])
);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Return the union of priorities inferred from a UC's text. May be empty if
 *  nothing matches — caller falls back to the curated map (which itself may
 *  be empty for that UC, in which case the UC just doesn't roll up). */
export function inferStrategicPriorities(uc: UseCase): string[] {
  const haystack = [
    uc.name,
    uc.description || '',
    uc.domain || '',
    (uc.tags || []).join(' '),
  ].join(' ​ '); // zero-width separator so adjacent fields can't form spurious matches

  const matched = new Set<string>();
  for (const [priority, re] of KEYWORD_LIST) {
    if (matched.has(priority)) continue;
    if (re.test(haystack)) matched.add(priority);
  }
  return Array.from(matched);
}

/** Build a `priority → Set<ucId>` index over the entire catalog by unioning
 *  explicit + curated + inferred sources. Memoized at the call site if perf
 *  matters; the inner work is cheap enough that we re-run on every
 *  ExecutiveSummaryTab render currently. */
export function buildPriorityIndex(
  catalog: UseCase[],
  curated: Record<string, string[]>,
): Record<string, Set<string>> {
  const index: Record<string, Set<string>> = {};
  const addEntry = (priority: string, ucId: string) => {
    if (!index[priority]) index[priority] = new Set();
    index[priority].add(ucId);
  };

  // 1. Curated hand-mapping (P&U, original) — authoritative for those UCs.
  for (const [priority, ucIds] of Object.entries(curated)) {
    for (const id of ucIds) addEntry(priority, id);
  }

  for (const uc of catalog) {
    // 2. Explicit field on the catalog row — authoritative.
    for (const p of (uc.strategicPriorities || [])) addEntry(p, uc.id);

    // 3. Inferred from text. Adds priorities the curated map didn't capture
    //    AND backfills every non-P&U UC so cross-industry rollups work too.
    for (const p of inferStrategicPriorities(uc)) addEntry(p, uc.id);
  }
  return index;
}
