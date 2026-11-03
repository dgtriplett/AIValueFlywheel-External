/**
 * UserGuideModal — short, scrollable explainer for the assessment + roadmap
 * tool. Surfaced from the landing page so a new user can self-orient without
 * having to read commit history. Content lives here (not in a CMS) because
 * it stays in lockstep with the actual code paths it describes.
 */
import React, { useEffect } from 'react';
import {
  X, BookOpen, Compass, Layers, BarChart3, Map, Sparkles, Wrench, Rocket,
  ShieldAlert, Target,
} from 'lucide-react';

interface UserGuideModalProps {
  onClose: () => void;
}

export const UserGuideModal: React.FC<UserGuideModalProps> = ({ onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="User guide"
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-navy-500 bg-navy-800 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-navy-600 sticky top-0 bg-navy-800 z-10">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-electric/15 border border-electric/30 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-electric" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-heading">How this assessment works</h2>
              <p className="text-xs text-navy-400 mt-0.5">
                A 4-step wizard produces a maturity score, a personalized roadmap, and a
                3-5 year strategic plan. Takes about 5-10 minutes.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-heading" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 text-sm text-slate-300 leading-relaxed">
          <Section icon={<Compass className="w-4 h-4 text-electric" />} title="The 4-step wizard">
            <ol className="list-decimal pl-5 space-y-2 mt-2">
              <li>
                <span className="text-heading font-medium">Profile</span> — pick the industry (or build a
                custom blend), your organization type, geographic scale, and the strategic priorities
                you are investing behind.
              </li>
              <li>
                <span className="text-heading font-medium">Infrastructure</span> — yes / no / partial
                answers about your current data + AI foundation (cloud, lakehouse,
                streaming, ML in production, governance, etc.).
              </li>
              <li>
                <span className="text-heading font-medium">What's already in production</span> — check
                every use case that's live today + every dataset you have accessible. Skip
                ahead with the pre-assessment worksheet upload.
              </li>
              <li>
                <span className="text-heading font-medium">Capability assessment</span> — answer a few
                proxy questions per dimension; the tool infers a 1-5 score for Data Engineering,
                Data Science, Cloud, and Executive Sponsorship. No more "rate yourself 1-5" —
                people are bad at that.
              </li>
            </ol>
          </Section>

          <Section icon={<Layers className="w-4 h-4 text-electric" />} title="Industry packs + custom blends">
            <p className="mt-2">
              Each industry pack (P&amp;U, T&amp;L, EPC, Distributed Generation, Manufacturing —
              Auto / Industrials / High Tech / Semiconductors) is a curated catalog of:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-1.5">
              <li>Domains (e.g. Generation, Plant Operations, Fleet Operations)</li>
              <li>Customer types (e.g. Electric Only, FTL Carrier, Fuel Cell OEM)</li>
              <li>Strategic priorities (e.g. reliability, on-time, project margin)</li>
              <li>Data sources + infrastructure questions specific to the vertical</li>
              <li>Quantified-Annual-Value assumption fields with realistic defaults</li>
              <li>Industry-grounded use cases (the catalog) across 3 phases</li>
            </ul>
            <p className="mt-2">
              If your organization spans multiple verticals (for example, a utility that also
              builds renewables), open the <strong className="text-heading">"Custom blend"</strong> button
              on the industry picker and check 2+ packs. The composite unions domains, organization
              types, strategic priorities, data sources, infrastructure questions, assumption fields,
              and the full use-case catalog.
            </p>
          </Section>

          <Section icon={<BarChart3 className="w-4 h-4 text-electric" />} title="The results dashboard">
            <p className="mt-2">After submit you get:</p>
            <ul className="list-disc pl-5 space-y-1 mt-1.5">
              <li><strong className="text-heading">Overall maturity score</strong> (0-100) across 5 dimensions</li>
              <li><strong className="text-heading">Current phase</strong> (Pre-Foundation, Phase 1-3) with progress %</li>
              <li><strong className="text-heading">Top-10 recommended next use cases</strong>, ranked by readiness, dependencies, priority fit, capability fit, and complexity</li>
              
              <li><strong className="text-heading">Per-domain progress</strong> — how many UCs are live in each domain per phase</li>
              <li><strong className="text-heading">Personalized roadmap</strong> — the recommendations laid out as next-90-days / next-6-months</li>
            </ul>
          </Section>

          <Section icon={<Map className="w-4 h-4 text-electric" />} title="The strategic roadmap">
            <p className="mt-2">
              The roadmap places every relevant use case into half-year time buckets, respecting:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-1.5">
              <li>Dependencies (a UC can't ship before its prerequisites)</li>
              <li>Bucket capacity (a complexity budget per half-year)</li>
              <li>Strategic priorities + business value</li>
              <li>External anchors (rate cases, regulatory deadlines, storm season, vendor EOLs)</li>
            </ul>
            <p className="mt-2">
              Toggle <strong className="text-heading">SI partners</strong> to mark UCs delivered by a system
              integrator — those run on a parallel workstream and cost a per-UC fee. Toggle
              <strong className="text-heading"> Apply Accelerators</strong> to assume every UC with a
              Databricks accelerator gets a 40% time reduction (configurable per UC in admin).
            </p>
          </Section>

          <Section icon={<Sparkles className="w-4 h-4 text-electric" />} title="Blast radius vs grid">
            <p className="mt-2">
              The roadmap view has two layouts:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-1.5">
              <li>
                <strong className="text-heading">Grid</strong> — domains × phases. Best for talking
                through dependencies + sequencing with a line-of-business leader.
              </li>
              <li>
                <strong className="text-heading">Blast Radius</strong> — polar layout where rings = time
                horizon and wedges = domain (single industry) or pack (blend). Best for an executive-level conversation about scope + sequencing.
              </li>
            </ul>
            <p className="mt-2">
              Click any UC to lock its dependency chain — prerequisites, dependents, and shared-data
              cousins highlight while everything else dims.
            </p>
          </Section>

          <Section icon={<Wrench className="w-4 h-4 text-electric" />} title="Value Assumptions">
            <p className="mt-2">
              The Quantified Annual Value figure on each use case is driven by industry-specific
              assumption fields (annual revenue, fleet size, fab capacity, etc.). Open
              <strong className="text-heading"> Value Assumptions</strong> on the roadmap to tune them
              to your organization — all $-figures update instantly. Defaults come from
              the active industry pack (or the blend's first pack), and admins can override per-field
              in <em>Admin → Assumption Fields</em>.
            </p>
          </Section>

          <Section icon={<ShieldAlert className="w-4 h-4 text-electric" />} title="Admin console">
            <p className="mt-2">
              Open the <strong className="text-heading">Admin</strong> link in the header (admin users
              only) to manage:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-1.5">
              <li>Admin allowlist</li>
              <li>Industries (pack edit + custom blend presets)</li>
              <li>Use cases (full editor — value model, complexity, accelerator strength)</li>
              <li>Reusable assets and accelerators linked to use cases (artifacts)</li>
              <li>Assumption fields per industry</li>
              <li>Feature flags + settings</li>
              <li>Business units and all submitted assessments</li>
              <li>Trends across your business units</li>
            </ul>
          </Section>

          <Section icon={<Target className="w-4 h-4 text-electric" />} title="Running an assessment">
            <p className="mt-2">
              Run the wizard as a working session with the people who own each area — data
              platform, operations, the business lines — rather than filling it in alone. The
              discussion behind each answer is where gaps and disagreements surface. Submit at the
              end and use the Results and Roadmap as the shared plan.
            </p>
            <p className="mt-2">
              Tip: send stakeholders the pre-assessment worksheet first (Step 1 has a
              "Download worksheet / Upload completed" panel). It covers every step — profile,
              infrastructure, use cases, data sources, and capabilities. Upload the completed file to
              pre-fill the wizard, then spend the session reviewing answers instead of entering them.
            </p>
          </Section>
          <Section icon={<Rocket className="w-4 h-4 text-electric" />} title="From plan to operation">
            <p className="mt-2">
              <strong className="text-heading">Promote to Operate</strong> turns the assessment into a
              working portfolio for a business unit: track each use case's status and realized value,
              see which ones are data-blocked, model what landing a data source would unlock, and
              add your own use cases with <strong className="text-heading">＋ Add use case</strong> —
              an agent maps them to your data, dependencies, and value model for you to review.
              Everything is stored in your workspace (Lakebase or Unity Catalog) and stays there.
            </p>
          </Section>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-navy-600 bg-navy-800 sticky bottom-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-electric hover:bg-electric-400 text-heading"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({
  icon, title, children,
}) => (
  <section>
    <div className="flex items-center gap-2 mb-1">
      {icon}
      <h3 className="text-sm font-semibold text-heading">{title}</h3>
    </div>
    <div className="ml-6 text-slate-300">{children}</div>
  </section>
);
