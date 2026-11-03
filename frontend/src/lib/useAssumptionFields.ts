import { useEffect, useMemo, useState } from 'react';
import {
  getAllAssumptionFields,
  subscribeCustomAssumptionFields,
  ASSUMPTION_FIELDS,
  type AssumptionField,
} from '../data/businessValue';
import { useIndustries } from '../industries/active';

/**
 * React hook returning the merged assumption-field catalog (built-in +
 * admin-added custom fields). Re-renders the consuming component whenever
 * the cached custom-field list changes (e.g. admin saves a new field).
 */
export function useAssumptionFields(): AssumptionField[] {
  const [, force] = useState(0);
  useEffect(() => subscribeCustomAssumptionFields(() => force(n => n + 1)), []);
  return getAllAssumptionFields();
}

export interface IndustryAssumptionFieldRow extends AssumptionField {
  /** Industry id this row was sourced from. 'global' = legacy P&U built-in
   *  (or admin-added custom field that isn't tied to any pack). */
  sourceIndustryId: string;
  sourceIndustryLabel: string;
}

/**
 * Hook for the admin "all-industries" view of assumption fields. Walks every
 * loaded industry pack, collects its `assumptionFields`, and tags each row
 * with its source industry. Adds the legacy P&U built-ins (when not already
 * provided by an industry pack) plus every admin-added custom field, both
 * tagged as 'global'.
 *
 * Re-renders when either the industry list or the custom-field cache changes.
 */
export function useAllIndustryAssumptionFields(): IndustryAssumptionFieldRow[] {
  const industries = useIndustries();
  const [, force] = useState(0);
  useEffect(() => subscribeCustomAssumptionFields(() => force(n => n + 1)), []);

  const customAndOverrides = getAllAssumptionFields();

  return useMemo(() => {
    const rows: IndustryAssumptionFieldRow[] = [];

    // Industry-pack fields, tagged with source.
    const seenKeys = new Set<string>();
    for (const ind of industries) {
      const packFields = ind.assumptionFields || [];
      for (const f of packFields) {
        rows.push({
          key: f.key,
          label: f.label,
          unit: f.unit,
          step: f.step,
          min: f.min,
          max: f.max,
          category: f.category,
          defaultValue: f.defaultValue,
          relevantFor: f.relevantFor as AssumptionField['relevantFor'],
          sourceIndustryId: ind.id,
          sourceIndustryLabel: ind.shortLabel || ind.label || ind.id,
        });
        seenKeys.add(`${ind.id}:${f.key}`);
      }
    }

    // Legacy P&U built-ins. Only include if the P&U pack doesn't already
    // declare them (otherwise we'd double-list). Tagged as 'pu' if the pack
    // exists, or 'global' as fallback.
    const puIndustry = industries.find(i => i.id === 'pu');
    const puPackHasFields = !!(puIndustry?.assumptionFields && puIndustry.assumptionFields.length > 0);
    if (!puPackHasFields) {
      for (const f of ASSUMPTION_FIELDS) {
        rows.push({
          ...f,
          sourceIndustryId: puIndustry ? 'pu' : 'global',
          sourceIndustryLabel: puIndustry ? (puIndustry.shortLabel || puIndustry.label) : 'Global',
        });
      }
    }

    // Admin-added custom fields (no built-in counterpart) — apply globally.
    for (const f of customAndOverrides) {
      if (f.isCustom) {
        rows.push({
          ...f,
          sourceIndustryId: 'global',
          sourceIndustryLabel: 'Custom (all industries)',
        });
      }
    }

    return rows;
  }, [industries, customAndOverrides]);
}
