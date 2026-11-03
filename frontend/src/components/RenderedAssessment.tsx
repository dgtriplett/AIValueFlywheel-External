// Renders a submitted assessment the same way the customer saw it —
// used in the admin console for review + PDF export.

import React from 'react';
import type { AssessmentResults } from '../data/scoring';
import type { AssessmentAnswers } from '../data/questions';
import { PHASE_DESCRIPTIONS } from '../data/useCases';
import { MaturityScoreCard } from './MaturityScoreCard';
import { PersonalizedRoadmap } from './PersonalizedRoadmap';

interface Props {
  results: AssessmentResults;
  answers: AssessmentAnswers;
  customerName?: string;
  submittedAt?: string;
  submittedBy?: string;
}

export const RenderedAssessment: React.FC<Props> = ({
  results, answers, customerName, submittedAt, submittedBy,
}) => {
  const hasProfileCompany = answers?.profile?.companyName;
  return (
    <div className="space-y-6 print-root">
      {/* Meta banner */}
      <div className="card p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Meta label="Customer" value={customerName || hasProfileCompany || '(unspecified)'} />
          <Meta label="Submitted" value={submittedAt ? new Date(submittedAt).toLocaleString() : '—'} />
          <Meta label="By" value={submittedBy || '—'} />
          <Meta label="Phase" value={`${results.currentPhase} — ${results.phaseName}`} />
        </div>
      </div>

      {/* Phase description */}
      <div className="card p-5">
        <h4 className="text-xs font-semibold text-navy-400 uppercase tracking-wider mb-2">
          Current phase
        </h4>
        <p className="text-sm text-navy-300 leading-relaxed">
          {PHASE_DESCRIPTIONS[results.currentPhase]}
        </p>
      </div>

      {/* Mirror of the ResultsDashboard summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-3">
          <MaturityScoreCard results={results} />
        </div>
        <div className="lg:col-span-9">
          <PersonalizedRoadmap results={results} />
        </div>
      </div>

      {/* Answer summary — useful context for admins reviewing */}
      <div className="card p-6">
        <h4 className="text-xs font-semibold text-navy-400 uppercase tracking-wider mb-3">
          Submitted answers
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field k="Company" v={answers?.profile?.companyName || '—'} />
          <Field k="Utility type" v={answers?.profile?.utilityType || '—'} />
          <Field k="Territory size" v={answers?.profile?.territorySize || '—'} />
          <Field k="Geography" v={answers?.profile?.geography || '—'} />
          <Field k="Strategic priorities" v={(answers?.profile?.strategicPriorities || []).join(', ') || '—'} />
          <Field k="Use cases in production" v={`${(answers?.currentUseCases?.selectedUseCases || []).length} selected`} />
          <Field k="Capability input" v={answers?.capabilityMode?.mode === 'derived' ? 'Question-derived' : 'Self-reported'} />
          <Field k="Data Engineering" v={`${answers?.capabilities?.dataEngineering ?? '—'}/5`} />
          <Field k="Data Science / ML" v={`${answers?.capabilities?.dataScience ?? '—'}/5`} />
          <Field k="Cloud Infrastructure" v={`${answers?.capabilities?.cloudInfra ?? '—'}/5`} />
          <Field k="Executive Sponsorship" v={`${answers?.capabilities?.executiveSponsorship ?? '—'}/5`} />
        </div>
      </div>
    </div>
  );
};

const Meta: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-[11px] uppercase tracking-wider text-navy-400">{label}</div>
    <div className="text-heading">{value}</div>
  </div>
);

const Field: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <div className="flex gap-2">
    <span className="text-navy-400 flex-shrink-0">{k}:</span>
    <span className="text-heading">{v}</span>
  </div>
);
