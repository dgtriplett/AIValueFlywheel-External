/**
 * Industry pack — data-only contract that drives the industry-agnostic core.
 * The active pack is fetched from /api/industry at startup and exposed via
 * useActiveIndustry().
 */

export interface IndustryCustomerType {
  id: string;
  label: string;
}

export interface IndustryTerritorySize {
  id: string;
  label: string;
}

/** Assumption-field shape carried by an industry pack. Mirrors the runtime
 *  AssumptionField type (in `data/businessValue.ts`) — kept structural here
 *  so this types module doesn't depend on the data module. */
export interface IndustryAssumptionField {
  key: string;
  label: string;
  unit: string;
  defaultValue?: number;
  step: number;
  min: number;
  max: number;
  category: string;
  relevantFor?: string[];
}

export interface IndustryMeta {
  id: string;
  label: string;                    // e.g. "Power & Utilities"
  shortLabel: string;               // e.g. "P&U"
  description: string;
  tagline: string;
  tableSchemaSuffix?: string;       // hint for which schema/prefix is in use

  /** Domain names — used for grouping use cases, the blast-radius map, and
   *  the LOB drill-down dropdown. */
  domains: string[];

  /** Phase number → human label. */
  phases: Record<string, string>;
  phaseDescriptions?: Record<string, string>;

  /** Customer type options for the Profile step. */
  customerTypes: IndustryCustomerType[];

  /** Territory / footprint options + the question label. */
  territorySize: IndustryTerritorySize[];
  territorySizeQuestion: string;

  /** Optional fleet-size question (for industries where it applies). */
  fleetSizeOptions?: IndustryTerritorySize[];
  fleetSizeQuestion?: string;

  /** Industry-specific Quantified Annual Value assumption fields.
   *  When present, these REPLACE the legacy P&U built-ins for this industry
   *  (admin overrides + custom fields still layer on top via the global
   *  custom-field cache). When absent, the runtime falls back to the legacy
   *  P&U list — kept for backward compatibility with the original deploy. */
  assumptionFields?: IndustryAssumptionField[];
}
