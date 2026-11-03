// Pre-assessment worksheet spec — the wizard's Profile / Infrastructure /
// Capabilities questions flattened into rows the backend renders as Excel tabs
// (Use Cases + Data Sources are built server-side from the catalog).
//
// The spec is built from the SAME option sources the wizard steps render, so a
// customer-completed workbook maps 1:1 back onto AssessmentAnswers. Each row
// carries a stable `key`; the backend writes option labels into dropdowns and
// resolves them back to `value`s on upload, so labels can change between
// download and upload without breaking the round-trip.

import type {
  AssessmentAnswers, CompanyProfile, InfrastructureAnswers, UtilityType, CapabilityScores,
} from './questions';
import {
  UTILITY_TYPE_OPTIONS, GEOGRAPHY_OPTIONS, TERRITORY_SIZE_OPTIONS, FLEET_SIZE_OPTIONS_GEN,
  FLEET_SIZE_OPTIONS_NUCLEAR, sizeOptionsFor, sizeQuestionLabelFor, strategicPrioritiesFor,
  infrastructureQuestionsFor,
} from './questions';
import { DERIVED_QUESTIONS, deriveCapabilityScores } from './derivedCapability';
import type { IndustryMeta } from '../industries/types';

export type WorksheetSection = 'Profile' | 'Infrastructure' | 'Capabilities';

export interface WorksheetOption { value: string; label: string }

export interface WorksheetQuestion {
  section: WorksheetSection;
  /** Sub-heading within the tab (e.g. capability dimension). */
  group?: string;
  key: string;
  question: string;
  help?: string;
  /** text = free entry; single = dropdown; multi = one Yes/No row per option. */
  kind: 'text' | 'single' | 'multi';
  options?: WorksheetOption[];
  /** Pre-filled answer — a value (single/text) or list of values (multi). */
  current?: string | string[] | null;
}

/** Parsed upload: key → value (single/text) or value[] (multi). */
export type WorksheetAnswers = Record<string, string | string[]>;

const YNP: WorksheetOption[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'partial', label: 'Partial' },
  { value: 'no', label: 'No' },
];

const ALL_UTILITY_TYPES = UTILITY_TYPE_OPTIONS.map(o => o.value) as UtilityType[];

/** Size buckets. When the customer type is still unknown (template sent before
 *  the profile is filled), merge the territory / fleet wordings so one dropdown
 *  works for a T&D utility, a generator, or a nuclear operator. */
function sizeOptions(industry: IndustryMeta, legacy: boolean, t: UtilityType | null): WorksheetOption[] {
  if (!legacy) return (industry.territorySize || []).map(o => ({ value: o.id, label: o.label }));
  if (t) return sizeOptionsFor(t).map(o => ({ value: o.value, label: `${o.label} (${o.detail})` }));
  return TERRITORY_SIZE_OPTIONS.map((o, i) => ({
    value: o.value,
    label: `${o.label} (${o.detail} · ${FLEET_SIZE_OPTIONS_GEN[i].detail} · ${FLEET_SIZE_OPTIONS_NUCLEAR[i].detail})`,
  }));
}

export function buildWorksheetSpec(answers: AssessmentAnswers, industry: IndustryMeta): WorksheetQuestion[] {
  const p = answers.profile;
  const t = p.utilityType;
  const packCustomerTypes = industry.customerTypes || [];
  const legacyPU = industry.id === 'pu' && packCustomerTypes.length === 0;
  const legacySize = industry.id === 'pu' && (industry.territorySize || []).length === 0;
  const qs: WorksheetQuestion[] = [];

  // ── Profile ────────────────────────────────────────────────────────────
  qs.push({ section: 'Profile', key: 'profile.companyName', kind: 'text',
            question: 'Company name', current: p.companyName || null });
  qs.push({
    section: 'Profile', key: 'profile.utilityType', kind: 'single',
    question: industry.id === 'pu' ? 'What type of utility are you?' : 'What type of organization are you?',
    options: legacyPU
      ? UTILITY_TYPE_OPTIONS.map(o => ({ value: o.value, label: o.label }))
      : packCustomerTypes.map(o => ({ value: o.id, label: o.label })),
    current: t,
  });
  if (industry.domains && industry.domains.length > 1) {
    qs.push({
      section: 'Profile', key: 'profile.operationsScope', kind: 'multi',
      question: 'Which parts of the business do you operate?',
      help: 'Mark Yes for every domain you operate. Leave all No to consider the full catalog.',
      options: industry.domains.map(d => ({ value: d, label: d })),
      current: p.operationsScope && p.operationsScope.length > 0 ? p.operationsScope : null,
    });
  }
  const sizeLabel = legacySize
    ? (t ? sizeQuestionLabelFor(t) : { label: 'Service territory / fleet size', help: 'Customer count for T&D utilities; operating capacity or reactor count for generators' })
    : { label: industry.territorySizeQuestion || 'What is your scale?', help: '' };
  qs.push({
    section: 'Profile', key: 'profile.territorySize', kind: 'single',
    question: sizeLabel.label, help: sizeLabel.help || undefined,
    options: sizeOptions(industry, legacySize, t),
    current: p.territorySize,
  });
  qs.push({
    section: 'Profile', key: 'profile.geography', kind: 'single', question: 'Primary geography',
    options: GEOGRAPHY_OPTIONS.map(o => ({ value: o.value, label: o.label })), current: p.geography,
  });
  const packPriorities = (industry as any).strategicPriorities as { id: string; label: string }[] | undefined;
  qs.push({
    section: 'Profile', key: 'profile.strategicPriorities', kind: 'multi',
    question: 'Strategic priorities', help: 'Mark Yes for everything that is relevant.',
    options: packPriorities && packPriorities.length > 0
      ? packPriorities.map(o => ({ value: o.id, label: o.label }))
      // Unknown customer type → the full list; the wizard prunes incompatible ones on import.
      : strategicPrioritiesFor(t).map(o => ({ value: o.value, label: o.label })),
    current: p.strategicPriorities.length > 0 ? p.strategicPriorities : null,
  });

  // ── Infrastructure ─────────────────────────────────────────────────────
  for (const q of infrastructureQuestionsFor(t)) {
    const scope = !t && q.relevantFor && q.relevantFor.length < ALL_UTILITY_TYPES.length
      ? ' (T&D / retail utilities only — leave blank otherwise)' : '';
    qs.push({
      section: 'Infrastructure', key: `infrastructure.${q.key}`, kind: 'single',
      question: q.question + scope, help: q.helpText, options: YNP,
      current: answers.infrastructure[q.key],
    });
  }

  // ── Capabilities (derived proxy questions) ─────────────────────────────
  for (const dim of DERIVED_QUESTIONS) {
    for (const q of dim.questions) {
      const k = `${dim.key}.${q.key}`;
      const cur = answers.capabilityMode.derivedAnswers[k];
      qs.push({
        section: 'Capabilities', group: dim.label, key: `capability.${k}`, kind: 'single',
        question: q.question, help: q.helpText,
        options: q.options.map(o => ({ value: String(o.value), label: o.label })),
        current: cur != null ? String(cur) : null,
      });
    }
  }
  return qs;
}

/** Fold parsed worksheet answers into the wizard state. Blank answers leave the
 *  existing value alone, so re-importing a partial sheet never erases work. */
export function applyWorksheetAnswers(
  answers: AssessmentAnswers,
  parsed: WorksheetAnswers,
  industry: IndustryMeta,
): { next: AssessmentAnswers; applied: number } {
  let applied = 0;
  const str = (k: string) => {
    const v = parsed[k];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const list = (k: string) => (Array.isArray(parsed[k]) ? (parsed[k] as string[]) : null);

  const profile: CompanyProfile = { ...answers.profile };
  const name = str('profile.companyName');
  if (name) { profile.companyName = name; applied++; }
  const ut = str('profile.utilityType');
  if (ut) { profile.utilityType = ut as UtilityType; applied++; }
  const scope = list('profile.operationsScope');
  if (scope && scope.length > 0) {
    // All domains ticked == no filter (matches StepProfile's fold-back).
    profile.operationsScope = scope.length >= (industry.domains || []).length ? [] : scope;
    applied++;
  }
  const size = str('profile.territorySize');
  if (size) { profile.territorySize = size as CompanyProfile['territorySize']; applied++; }
  const geo = str('profile.geography');
  if (geo) { profile.geography = geo as CompanyProfile['geography']; applied++; }
  const pri = list('profile.strategicPriorities');
  if (pri && pri.length > 0) {
    const valid = industry.id === 'pu' && !((industry as any).strategicPriorities?.length)
      ? new Set<string>(strategicPrioritiesFor(profile.utilityType).map(o => o.value))
      : null;
    profile.strategicPriorities = pri.filter(v => !valid || valid.has(v)) as CompanyProfile['strategicPriorities'];
    applied++;
  }

  const infrastructure: InfrastructureAnswers = { ...answers.infrastructure };
  for (const k of Object.keys(infrastructure) as (keyof InfrastructureAnswers)[]) {
    const v = str(`infrastructure.${k}`);
    if (v === 'yes' || v === 'no' || v === 'partial') { infrastructure[k] = v; applied++; }
  }

  const derivedAnswers = { ...answers.capabilityMode.derivedAnswers };
  for (const dim of DERIVED_QUESTIONS) {
    for (const q of dim.questions) {
      const k = `${dim.key}.${q.key}`;
      const n = Number(str(`capability.${k}`));
      if (Number.isInteger(n) && n >= 1 && n <= 5) { derivedAnswers[k] = n; applied++; }
    }
  }
  const capabilities: CapabilityScores = deriveCapabilityScores(derivedAnswers);

  return {
    next: {
      ...answers,
      profile,
      infrastructure,
      capabilities,
      capabilityMode: { ...answers.capabilityMode, mode: 'derived', derivedAnswers },
    },
    applied,
  };
}
