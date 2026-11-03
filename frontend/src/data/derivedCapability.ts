// Derived capability questionnaire — proxy questions that infer a 1-5 score
// per capability dimension without asking users to self-rate.
//
// Each question has 5 answer options scored 1..5. The dimension score is the
// rounded average across answered questions (default 3 if unanswered).

import type { CapabilityScores } from './questions';

export type CapabilityDimensionKey = keyof CapabilityScores;

export interface DerivedOption {
  value: number;       // 1..5 — the score this option contributes
  label: string;
}

export interface DerivedQuestion {
  key: string;         // unique within dimension
  question: string;
  helpText?: string;
  options: DerivedOption[];
}

export interface DerivedDimension {
  key: CapabilityDimensionKey;
  label: string;
  description: string;
  questions: DerivedQuestion[];
}

export const DERIVED_QUESTIONS: DerivedDimension[] = [
  {
    key: 'dataEngineering',
    label: 'Data Engineering',
    description: 'How modern and mature your pipelines, orchestration, and data delivery practices are.',
    questions: [
      {
        key: 'team_size',
        question: 'How many full-time data engineers do you have?',
        options: [
          { value: 1, label: '0 — outsourced or none' },
          { value: 2, label: '1–3' },
          { value: 3, label: '4–10' },
          { value: 4, label: '11–30' },
          { value: 5, label: '30+' },
        ],
      },
      {
        key: 'pipeline_orchestration',
        question: 'How are your data pipelines orchestrated?',
        helpText: 'Consider tools like Airflow, Databricks Workflows, Dagster, or cron.',
        options: [
          { value: 1, label: 'Mostly manual / cron scripts' },
          { value: 2, label: 'Some scheduling, many manual steps' },
          { value: 3, label: 'Partial orchestration with basic dependencies' },
          { value: 4, label: 'Orchestrated with retries, SLAs, alerting' },
          { value: 5, label: 'Fully orchestrated with CI/CD across environments' },
        ],
      },
      {
        key: 'version_control',
        question: 'How do you version your pipelines and transformations?',
        options: [
          { value: 1, label: 'Code lives in notebooks / shared drives' },
          { value: 2, label: 'Some code in git; many artifacts not versioned' },
          { value: 3, label: 'Most pipelines in git; patchy review practice' },
          { value: 4, label: 'All pipelines in git with branches and PR reviews' },
          { value: 5, label: 'Git + trunk-based CI with required checks and approvals' },
        ],
      },
      {
        key: 'data_quality',
        question: 'Do you have automated data quality tests in your pipelines?',
        helpText: 'Expectations, constraints, schema checks, anomaly detection.',
        options: [
          { value: 1, label: 'None' },
          { value: 2, label: 'Ad-hoc spot checks' },
          { value: 3, label: 'Tests on critical tables only' },
          { value: 4, label: 'Tests across most pipelines with alerting' },
          { value: 5, label: 'Comprehensive DQ with SLAs and ownership' },
        ],
      },
      {
        key: 'schema_delivery',
        question: 'How do new tables and schemas get promoted to production?',
        options: [
          { value: 1, label: 'DBA adds manually when asked' },
          { value: 2, label: 'Manual with change control forms' },
          { value: 3, label: 'Semi-automated deployment scripts' },
          { value: 4, label: 'Fully automated via IaC / bundles' },
          { value: 5, label: 'Self-service with policy-enforced governance' },
        ],
      },
    ],
  },
  {
    key: 'dataScience',
    label: 'Data Science / ML',
    description: 'How much ML is delivering value in production today vs. staying in notebooks.',
    questions: [
      {
        key: 'models_in_prod',
        question: 'How many ML models are running in production today?',
        helpText: 'Actively scoring / driving a decision, not a prototype in a notebook.',
        options: [
          { value: 1, label: 'None' },
          { value: 2, label: 'Exploring / pilots only' },
          { value: 3, label: '1–3 production models' },
          { value: 4, label: '4–10 production models' },
          { value: 5, label: '10+ production models with active monitoring' },
        ],
      },
      {
        key: 'team',
        question: 'Do you have dedicated ML engineers or data scientists?',
        options: [
          { value: 1, label: 'No — requests go to analytics/BI team' },
          { value: 2, label: 'Shared resources from analytics team' },
          { value: 3, label: 'Small dedicated team (1–5 people)' },
          { value: 4, label: 'Established team (6–20 people)' },
          { value: 5, label: 'In-house ML platform team + embedded scientists' },
        ],
      },
      {
        key: 'deployment',
        question: 'How are models deployed to production?',
        options: [
          { value: 1, label: 'Notebooks run on a schedule' },
          { value: 2, label: 'Manual copy/paste into scoring scripts' },
          { value: 3, label: 'Basic CI for scoring containers' },
          { value: 4, label: 'MLOps platform (MLflow, SageMaker, Vertex, etc.)' },
          { value: 5, label: 'Full ModelOps — registry, staging, rollback, shadow' },
        ],
      },
      {
        key: 'monitoring',
        question: 'Do you monitor production models for drift and performance?',
        options: [
          { value: 1, label: 'No monitoring' },
          { value: 2, label: 'Basic logs, checked reactively' },
          { value: 3, label: 'Scheduled accuracy/drift checks' },
          { value: 4, label: 'Automated drift + performance alerts' },
          { value: 5, label: 'Full observability incl. fairness, bias, business KPI link' },
        ],
      },
      {
        key: 'feature_store',
        question: 'Do you have a feature store or shared feature pipelines?',
        helpText: 'Reusable, governed features available across models.',
        options: [
          { value: 1, label: 'No — features rebuilt per project' },
          { value: 2, label: 'Exploring / evaluating' },
          { value: 3, label: 'Some shared feature code, no central store' },
          { value: 4, label: 'Feature store in use for core models' },
          { value: 5, label: 'Enterprise feature store with governance + discovery' },
        ],
      },
    ],
  },
  {
    key: 'cloudInfra',
    label: 'Cloud Infrastructure',
    description: 'How much of your stack runs in cloud and how operationally mature it is.',
    questions: [
      {
        key: 'cloud_pct',
        question: 'What percentage of your data workloads run in cloud?',
        options: [
          { value: 1, label: '0% — fully on-prem' },
          { value: 2, label: 'Under 25%' },
          { value: 3, label: '25–50% (hybrid)' },
          { value: 4, label: '50–80% (mostly cloud)' },
          { value: 5, label: 'Over 80% — cloud-native' },
        ],
      },
      {
        key: 'iac',
        question: 'Do you use Infrastructure-as-Code for your cloud resources?',
        helpText: 'Terraform, CloudFormation, Bicep, Pulumi, Databricks Asset Bundles, etc.',
        options: [
          { value: 1, label: 'No — clicked through the console' },
          { value: 2, label: 'Some scripts, mostly manual' },
          { value: 3, label: 'Partial IaC for core resources' },
          { value: 4, label: 'Mostly IaC with CI-managed state' },
          { value: 5, label: 'Fully declarative, policy-enforced, multi-env' },
        ],
      },
      {
        key: 'operating_model',
        question: 'What best describes your cloud operating model?',
        options: [
          { value: 1, label: 'All on-prem, no cloud strategy' },
          { value: 2, label: 'Lift-and-shift to cloud in progress' },
          { value: 3, label: 'Hybrid with some cloud-native services' },
          { value: 4, label: 'Cloud-first; new workloads land in cloud' },
          { value: 5, label: 'Cloud-native with FinOps and cost governance' },
        ],
      },
      {
        key: 'cost_governance',
        question: 'How mature is your cloud cost governance?',
        options: [
          { value: 1, label: 'No visibility into spend' },
          { value: 2, label: 'Monthly invoice review only' },
          { value: 3, label: 'Tagging + some dashboards' },
          { value: 4, label: 'Dashboards, alerts, chargeback' },
          { value: 5, label: 'Optimization loop + commit-based discounts + FinOps team' },
        ],
      },
      {
        key: 'streaming',
        question: 'Do you use streaming / real-time cloud services?',
        helpText: 'Kafka, Kinesis, Event Hubs, Delta Live Tables / Structured Streaming, etc.',
        options: [
          { value: 1, label: 'No — all batch' },
          { value: 2, label: 'Exploring / pilots' },
          { value: 3, label: 'Streaming for one or two use cases' },
          { value: 4, label: 'Streaming for core operational workloads' },
          { value: 5, label: 'Real-time by default across major platforms' },
        ],
      },
    ],
  },
  {
    key: 'executiveSponsorship',
    label: 'Executive Sponsorship',
    description: 'How much executive commitment and governance backs your Data/AI program.',
    questions: [
      {
        key: 'champion',
        question: 'Who is your senior-most Data/AI champion today?',
        options: [
          { value: 1, label: 'No formal champion' },
          { value: 2, label: 'IT director level' },
          { value: 3, label: 'VP-level' },
          { value: 4, label: 'SVP or C-level executive' },
          { value: 5, label: 'Board-level mandate' },
        ],
      },
      {
        key: 'budget',
        question: 'How is Data/AI work funded?',
        options: [
          { value: 1, label: 'No dedicated budget' },
          { value: 2, label: 'Ad-hoc project funding' },
          { value: 3, label: 'Annual line item in IT budget' },
          { value: 4, label: 'Multi-year programmatic budget' },
          { value: 5, label: 'Strategic investment thesis with board visibility' },
        ],
      },
      {
        key: 'strategy_doc',
        question: 'Is there a published Data/AI strategy?',
        options: [
          { value: 1, label: 'No strategy document' },
          { value: 2, label: 'Verbal direction from leadership' },
          { value: 3, label: 'Draft document, internal only' },
          { value: 4, label: 'Published strategy with tracked initiatives' },
          { value: 5, label: 'Strategy aligned across the enterprise with KPIs' },
        ],
      },
      {
        key: 'exec_cadence',
        question: 'How often does Data/AI get executive attention?',
        options: [
          { value: 1, label: 'Rarely' },
          { value: 2, label: 'Ad-hoc when issues arise' },
          { value: 3, label: 'Quarterly business reviews' },
          { value: 4, label: 'Monthly exec steering committee' },
          { value: 5, label: 'Continuous — on the CEO/BOD KPI dashboard' },
        ],
      },
    ],
  },
];

/**
 * Given derived answers keyed as `${dimension}.${questionKey}`, compute the
 * CapabilityScores object by averaging answered questions per dimension.
 * Unanswered dimensions default to 3 (neutral).
 */
export function deriveCapabilityScores(
  derivedAnswers: Record<string, number>
): CapabilityScores {
  const scores: CapabilityScores = {
    dataEngineering: 3,
    dataScience: 3,
    cloudInfra: 3,
    executiveSponsorship: 3,
  };

  for (const dim of DERIVED_QUESTIONS) {
    const values: number[] = [];
    for (const q of dim.questions) {
      const v = derivedAnswers[`${dim.key}.${q.key}`];
      if (typeof v === 'number' && v >= 1 && v <= 5) values.push(v);
    }
    if (values.length > 0) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      scores[dim.key] = Math.max(1, Math.min(5, Math.round(avg)));
    }
  }

  return scores;
}

/** Count answered questions across all dimensions. */
export function countAnswered(derivedAnswers: Record<string, number>): {
  answered: number;
  total: number;
} {
  const total = DERIVED_QUESTIONS.reduce((sum, d) => sum + d.questions.length, 0);
  let answered = 0;
  for (const dim of DERIVED_QUESTIONS) {
    for (const q of dim.questions) {
      if (typeof derivedAnswers[`${dim.key}.${q.key}`] === 'number') answered += 1;
    }
  }
  return { answered, total };
}
