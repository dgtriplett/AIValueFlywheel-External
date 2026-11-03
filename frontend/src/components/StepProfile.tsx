import React from 'react';
import { clsx } from 'clsx';
import {
  Zap, Flame, Factory, Droplets, Building2, Globe, Check, HelpCircle,
  Bolt, Atom, Truck, Train, Ship, Plane, Package, Boxes, Warehouse, Compass,
} from 'lucide-react';
import type { CompanyProfile, StrategicPriority } from '../data/questions';
import {
  UTILITY_TYPE_OPTIONS,
  GEOGRAPHY_OPTIONS,
  sizeOptionsFor,
  sizeQuestionLabelFor,
  strategicPrioritiesFor,
} from '../data/questions';
import { Tooltip } from './Tooltip';
import {
  useActiveIndustry, useIndustries, useActiveIndustryIds,
  setActiveIndustryId, setActiveIndustryIds, isBlendActive,
} from '../industries/active';
import { IndustryBlendPicker } from './IndustryBlendPicker';
import { useBlendPresets } from '../industries/presets';

interface StepProfileProps {
  data: CompanyProfile;
  onChange: (data: CompanyProfile) => void;
}

const ICONS: Record<string, React.ReactNode> = {
  Zap: <Zap className="w-5 h-5" />,
  Flame: <Flame className="w-5 h-5" />,
  Factory: <Factory className="w-5 h-5" />,
  Droplets: <Droplets className="w-5 h-5" />,
  Building2: <Building2 className="w-5 h-5" />,
  Bolt: <Bolt className="w-5 h-5" />,
  Atom: <Atom className="w-5 h-5" />,
  Truck: <Truck className="w-5 h-5" />,
  Train: <Train className="w-5 h-5" />,
  Ship: <Ship className="w-5 h-5" />,
  Plane: <Plane className="w-5 h-5" />,
  Package: <Package className="w-5 h-5" />,
  Boxes: <Boxes className="w-5 h-5" />,
  Warehouse: <Warehouse className="w-5 h-5" />,
  Compass: <Compass className="w-5 h-5" />,
};

// Default icon mapping when the pack doesn't supply one for a customer type.
function iconForCustomerType(id: string): React.ReactNode {
  if (id.includes('truck')) return ICONS.Truck;
  if (id.includes('rail')) return ICONS.Train;
  if (id.includes('ocean') || id.includes('shipping')) return ICONS.Ship;
  if (id.includes('air')) return ICONS.Plane;
  if (id.includes('parcel') || id.includes('last_mile')) return ICONS.Package;
  if (id.includes('warehouse')) return ICONS.Warehouse;
  if (id.includes('multi') || id.includes('broker') || id.includes('forwarder')) return ICONS.Compass;
  if (id === 'electric' || id === 'electric_gas') return ICONS.Zap;
  if (id === 'gas') return ICONS.Flame;
  if (id === 'generation_only') return ICONS.Factory;
  if (id === 'nuclear') return ICONS.Atom;
  return ICONS.Building2;
}

export const StepProfile: React.FC<StepProfileProps> = ({ data, onChange }) => {
  const industry = useActiveIndustry();
  const industries = useIndustries();
  const showIndustryPicker = industries.length > 1;

  // Use the pack's customer types when available — that's the industry-
  // agnostic surface. Falls back to the legacy P&U options when the pack
  // doesn't have customerTypes (e.g. older deploys).
  const packCustomerTypes = industry.customerTypes || [];
  const useLegacyPU = industry.id === 'pu' && packCustomerTypes.length === 0;

  const activeIds = useActiveIndustryIds();
  const blendPresets = useBlendPresets();
  const [showBlendPicker, setShowBlendPicker] = React.useState(false);
  const blendActive = isBlendActive();

  const switchIndustry = (id: string) => {
    setActiveIndustryId(id);
    // Reset industry-specific fields when industry changes — customer type
    // options, strategic priorities, operations-scope domains, etc. are all
    // different per industry.
    onChange({
      ...data,
      industryId: id,
      industryIds: [id],
      utilityType: null,
      territorySize: null,
      strategicPriorities: [],
      operationsScope: [],
    });
  };

  const applyBlend = (ids: string[]) => {
    if (ids.length === 1) {
      switchIndustry(ids[0]);
      return;
    }
    setActiveIndustryIds(ids);
    const sortedIds = [...ids].sort();
    onChange({
      ...data,
      industryId: `_blend:${sortedIds.join(',')}`,
      industryIds: ids,
      utilityType: null,
      territorySize: null,
      strategicPriorities: [],
      operationsScope: [],
    });
  };

  // Auto-set industryId / industryIds to active when there's only one (first render).
  React.useEffect(() => {
    if (!data.industryId && industry.id) {
      onChange({ ...data, industryId: industry.id, industryIds: [...activeIds] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [industry.id]);

  return (
    <div className="space-y-10 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-heading mb-2">Company Profile</h2>
        <p className="text-slate-400">
          Tell us about your {industry.id === 'pu' ? 'utility' : 'operation'} so we can tailor the assessment.
        </p>
      </div>

      {/* Industry picker — only renders when this workspace has multiple
          industries enabled. Single-industry deploys auto-pick. */}
      {showIndustryPicker && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="block text-sm font-medium text-slate-300">Industry</label>
            <button
              type="button"
              onClick={() => setShowBlendPicker(true)}
              className="text-xs px-2.5 py-1 rounded-full border border-electric/40 text-electric hover:bg-electric/10 inline-flex items-center gap-1.5"
              title="Compose use cases + domains from multiple industry packs"
            >
              {blendActive
                ? `Custom blend (${activeIds.length} packs) — change`
                : 'Or build a custom blend'}
            </button>
          </div>
          {blendActive ? (
            <div className="p-4 rounded-xl border-2 border-electric bg-electric/10">
              <div className="text-sm font-semibold text-electric mb-1">{industry.label}</div>
              <div className="text-[11px] text-navy-300">
                Use cases, domains, and assumptions are unioned across the selected packs.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {industries.map(ind => (
                <button
                  key={ind.id}
                  onClick={() => switchIndustry(ind.id)}
                  className={clsx(
                    'flex flex-col items-start gap-1 p-4 rounded-xl border-2 text-left transition-all duration-200',
                    industry.id === ind.id
                      ? 'border-electric bg-electric/10'
                      : 'border-navy-600 bg-navy-800 hover:border-navy-500'
                  )}
                >
                  <span className={clsx('text-sm font-bold',
                    industry.id === ind.id ? 'text-electric' : 'text-slate-200')}>{ind.label}</span>
                  {ind.shortLabel && ind.shortLabel !== ind.label && (
                    <span className="text-[10px] uppercase tracking-wider text-navy-400">{ind.shortLabel}</span>
                  )}
                  {ind.tagline && (
                    <span className="text-[11px] text-slate-400 mt-0.5">{ind.tagline}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-navy-400 mt-2">
            Switching industry resets the customer-type, scale, and priority selections below.
          </p>
        </div>
      )}

      {showBlendPicker && (
        <IndustryBlendPicker
          industries={industries}
          activeIds={[...activeIds]}
          presets={blendPresets}
          onApply={applyBlend}
          onClose={() => setShowBlendPicker(false)}
        />
      )}

      {/* Company Name */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
          Company / {industry.id === 'pu' ? 'utility' : 'organization'} name
          <Tooltip content="Used to identify this assessment in the admin catalog. Keep it consistent across re-assessments so trends are trackable.">
            <HelpCircle className="w-3.5 h-3.5 text-navy-400" />
          </Tooltip>
        </label>
        <input
          type="text"
          className="input-field max-w-xl"
          placeholder={industry.id === 'pu' ? 'e.g., Example Power & Light' : 'e.g., Example Corp'}
          value={data.companyName}
          onChange={(e) => onChange({ ...data, companyName: e.target.value })}
        />
      </div>

      {/* Customer / utility type */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-4">
          {industry.id === 'pu'
            ? 'What type of utility are you?'
            : industry.id === 'tl'
              ? 'What kind of operation are you?'
              : 'What kind of organization are you?'}
        </label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(useLegacyPU ? UTILITY_TYPE_OPTIONS.map(o => ({ id: o.value, label: o.label, icon: o.icon })) : packCustomerTypes).map((opt: any) => (
            <button
              key={opt.id ?? opt.value}
              onClick={() => {
                const next = (opt.id ?? opt.value) as any;
                // For P&U, prune incompatible priorities. For other industries,
                // priorities aren't restricted by customer type yet — admins
                // can refine later if needed.
                let cleanedPriorities = data.strategicPriorities;
                if (industry.id === 'pu') {
                  const validPriorities = strategicPrioritiesFor(next).map(p => p.value);
                  cleanedPriorities = data.strategicPriorities.filter(
                    p => validPriorities.includes(p as any),
                  );
                }
                onChange({
                  ...data,
                  utilityType: next,
                  strategicPriorities: cleanedPriorities,
                });
              }}
              className={clsx(
                'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200',
                data.utilityType === (opt.id ?? opt.value)
                  ? 'border-electric bg-electric/10 text-electric'
                  : 'border-navy-600 bg-navy-800 text-slate-400 hover:border-navy-500 hover:text-slate-300'
              )}
            >
              {opt.icon ? ICONS[opt.icon] : iconForCustomerType(opt.id ?? opt.value)}
              <span className="text-sm font-medium text-center">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Operations Scope — the customer's actual lines of business as a
          subset of the industry's domains. Without this filter, a
          network-only utility (e.g. a T&D + gas-distribution company, no
          generation) would receive generation use cases purely because they
          picked "Electric & Gas". With it, only UCs in the checked domains
          flow through to recommendations + the roadmap. Empty = no filter
          (back-compat for assessments that don't care). */}
      {industry.domains && industry.domains.length > 1 && (
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Which parts of the business do you operate?
          </label>
          <p className="text-xs text-slate-500 mb-4">
            Pick every domain this customer actually operates. Leave all unchecked to consider
            the full {industry.shortLabel || industry.label} catalog.
            <span className="ml-1 text-navy-400 italic">
              Example: a T&D + gas-distribution utility should uncheck Generation so we don't
              recommend generation-side use cases.
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {industry.domains.map((domain) => {
              const isAll = !data.operationsScope || data.operationsScope.length === 0;
              const checked = isAll || (data.operationsScope || []).includes(domain);
              return (
                <button
                  key={domain}
                  type="button"
                  onClick={() => {
                    const cur = data.operationsScope && data.operationsScope.length > 0
                      ? [...data.operationsScope]
                      : [...industry.domains]; // start from "all checked" when transitioning out of empty
                    const idx = cur.indexOf(domain);
                    if (idx >= 0) cur.splice(idx, 1);
                    else cur.push(domain);
                    // If the user re-checked every domain, fold back to "no filter".
                    const next = cur.length === industry.domains.length ? [] : cur;
                    onChange({ ...data, operationsScope: next });
                  }}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-colors inline-flex items-center gap-1.5',
                    checked
                      ? 'border-electric bg-electric/10 text-electric'
                      : 'border-navy-600 bg-navy-800 text-slate-400 hover:text-heading hover:border-navy-500'
                  )}
                >
                  {checked ? <Check className="w-3 h-3" /> : null}
                  {domain}
                </button>
              );
            })}
            {data.operationsScope && data.operationsScope.length > 0 && (
              <button
                type="button"
                onClick={() => onChange({ ...data, operationsScope: [] })}
                className="px-3 py-1.5 rounded-full text-xs font-medium border-2 border-navy-700 bg-transparent text-navy-400 hover:text-heading hover:border-navy-500"
                title="Clear the filter — consider every domain"
              >
                Reset (all)
              </button>
            )}
          </div>
          {data.operationsScope && data.operationsScope.length > 0 && (
            <div className="mt-2 text-[11px] text-warning-300">
              Recommendations + roadmap scoped to {data.operationsScope.length} of {industry.domains.length} domains.
            </div>
          )}
        </div>
      )}

      {/* Territory / Fleet Size — label + bucket options come from the pack
          when set, otherwise from the legacy P&U logic. */}
      {(() => {
        const packTerritory = industry.territorySize || [];
        const useLegacy = industry.id === 'pu' && packTerritory.length === 0;
        const sizeOpts = useLegacy
          ? sizeOptionsFor(data.utilityType).map(o => ({ id: o.value, label: o.label, detail: o.detail }))
          : packTerritory;
        const labelText = useLegacy
          ? sizeQuestionLabelFor(data.utilityType).label
          : (industry.territorySizeQuestion || 'What is your scale?');
        const helpText = useLegacy ? sizeQuestionLabelFor(data.utilityType).help : '';
        return (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">{labelText}</label>
            {helpText && <p className="text-xs text-slate-500 mb-4">{helpText}</p>}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {sizeOpts.map((opt: any) => (
                <button
                  key={opt.id ?? opt.value}
                  onClick={() => onChange({ ...data, territorySize: (opt.id ?? opt.value) as any })}
                  className={clsx(
                    'flex flex-col items-center gap-1 p-4 rounded-xl border-2 transition-all duration-200',
                    data.territorySize === (opt.id ?? opt.value)
                      ? 'border-electric bg-electric/10 text-electric'
                      : 'border-navy-600 bg-navy-800 text-slate-400 hover:border-navy-500 hover:text-slate-300'
                  )}
                >
                  <span className="text-sm font-semibold text-center">{opt.label}</span>
                  {opt.detail && <span className="text-xs opacity-70">{opt.detail}</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Geography */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-4">Primary geography</label>
        <div className="flex flex-wrap gap-3">
          {GEOGRAPHY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => onChange({ ...data, geography: opt.value })}
              className={clsx(
                'flex items-center gap-2 px-5 py-3 rounded-xl border-2 transition-all duration-200',
                data.geography === opt.value
                  ? 'border-electric bg-electric/10 text-electric'
                  : 'border-navy-600 bg-navy-800 text-slate-400 hover:border-navy-500 hover:text-slate-300'
              )}
            >
              <Globe className="w-4 h-4" />
              <span className="text-sm font-medium">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Strategic Priorities - multi-select */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1">
          Strategic priorities <span className="text-slate-500 font-normal">(select all that apply)</span>
        </label>
        <p className="text-xs text-slate-500 mb-4">Most organizations have multiple priorities — select everything that's relevant.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(() => {
            // Pack-supplied priorities take precedence (e.g. T&L). Fall back
            // to the legacy P&U-utility-type-aware list when the pack doesn't
            // supply one.
            const packPriorities = (industry as any).strategicPriorities as { id: string; label: string; description?: string }[] | undefined;
            const opts = packPriorities && packPriorities.length > 0
              ? packPriorities.map(p => ({ value: p.id, label: p.label, description: p.description || '' }))
              : strategicPrioritiesFor(data.utilityType).map(p => ({ value: p.value, label: p.label, description: (p as any).description || '' }));
            return opts;
          })().map(opt => {
            const selected = data.strategicPriorities.includes(opt.value as StrategicPriority);
            return (
              <button
                key={opt.value}
                onClick={() => {
                  const current = data.strategicPriorities;
                  const next = selected
                    ? current.filter(p => p !== opt.value)
                    : [...current, opt.value as StrategicPriority];
                  onChange({ ...data, strategicPriorities: next });
                }}
                className={clsx(
                  'flex items-start gap-3 p-4 rounded-xl border-2 transition-all duration-200 text-left',
                  selected
                    ? 'border-electric bg-electric/10'
                    : 'border-navy-600 bg-navy-800 hover:border-navy-500'
                )}
              >
                <div className={clsx(
                  'flex-shrink-0 w-5 h-5 mt-0.5 rounded border-2 flex items-center justify-center transition-colors',
                  selected ? 'bg-electric border-electric' : 'border-slate-500'
                )}>
                  {selected && <Check className="w-3 h-3 text-navy-900" strokeWidth={3} />}
                </div>
                <div>
                  <span className={clsx(
                    'text-sm font-semibold block',
                    selected ? 'text-electric' : 'text-slate-300'
                  )}>
                    {opt.label}
                  </span>
                  <span className="text-xs text-slate-500 mt-1 block">{opt.description}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
