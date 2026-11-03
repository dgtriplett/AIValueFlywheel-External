// API client for backend endpoints. All calls same-origin (served by FastAPI).
import type { ComplexityScoring } from '../data/complexityRubric';
import type { ValueModel } from '../data/businessValue';

export interface CurrentUser {
  email: string | null;
  name: string | null;
  isAdmin: boolean;
}

export interface UseCaseAPI {
  id: string;
  name: string;
  phase: number;
  domain: string;
  category: string;
  description: string;
  dataRequirements: string[];
  systemPrerequisites: string[];
  businessValue: string[];
  complexity: number;
  /** Optional structured rubric. Mode 'manual' = hand-typed complexity wins;
   *  'derived' = the rubric drives the displayed score. */
  complexityScoring?: ComplexityScoring;
  /** Admin-editable formula that drives the Quantified Annual Value display. */
  valueModel?: ValueModel;
  /** Admin-set per-UC partner / SI cost estimate ($M). When null, the strategic
   *  roadmap derives the SI fee from complexity × cost-per-cx-pt-per-half. */
  partnerCostEstimateMM?: number | null;
  /** Fractional time reduction applied when the strategic roadmap's
   *  "Apply Accelerators" toggle is on AND this UC has a linked accelerator.
   *  0-0.8. Null = use the global default (currently 0.4 / 40%). */
  acceleratorTimeReductionPct?: number | null;
  timeToValue: string;
  dependencies: string[];
  tags: string[];
  referenceCustomers: string[];
  kpiImpact: { kpi: string; delta: number; unit: string }[];
  enabled: boolean;
  /** Industry tag. Defaults to 'pu' for legacy rows. */
  industryId?: string;
}

export interface AdminRow {
  email: string;
  added_at: string;
  added_by: string;
}

export interface AssessmentListRow {
  id: string;
  customer_name: string;
  created_at: string;
  created_by: string;
  overall_score: number;
  current_phase: number;
}

export type ArtifactType =
  | 'accelerator' | 'brickbuilder' | 'partner' | 'marketplace'
  | 'notebook' | 'blog' | 'docs' | 'repo'
  | 'video' | 'dashboard' | 'sql' | 'architecture'
  | 'training' | 'case_study' | 'reference';

export interface ArtifactAPI {
  id: string;
  useCaseId: string;
  type: ArtifactType;
  title: string;
  description: string;
  url: string;
  content: string;  // markdown for inline artifacts
  tags: string[];
  enabled: boolean;
  sortOrder: number;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AssessmentDetail {
  id: string;
  customerName: string;
  createdAt: string;
  createdBy: string;
  overallScore: number;
  currentPhase: number;
  answers: Record<string, unknown>;
  results: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Multi-user account context. The active account id is persisted per-browser and
// sent on every request as X-Grid-Atlas-Account so the account-scoped backend
// resolves the right tenant. The server also gates it by membership.
// ---------------------------------------------------------------------------
const ACTIVE_ACCOUNT_KEY = 'gc.activeAccountId';
export function getActiveAccountId(): string | null {
  try { return localStorage.getItem(ACTIVE_ACCOUNT_KEY); } catch { return null; }
}
export function setActiveAccountId(id: number | string | null): void {
  try {
    if (id === null || id === undefined) localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
    else localStorage.setItem(ACTIVE_ACCOUNT_KEY, String(id));
  } catch { /* private mode */ }
}
function accountHeaders(): Record<string, string> {
  const id = getActiveAccountId();
  return id ? { 'X-Grid-Atlas-Account': id } : {};
}

// ---------------------------------------------------------------------------
// Local-first stubs. In the converged app only a small set of endpoints exist
// server-side (identity, accounts, data-sources, pre-assessment, promote). The
// assessment SPA's other persistence (drafts, prefs, assessments list) runs from
// localStorage so a missing endpoint never crashes the app. Returns undefined to
// mean "not a stubbed route — do a real fetch".
// ---------------------------------------------------------------------------
function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; }
  catch { return fallback; }
}
function lsSet(key: string, val: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}
function localStub(url: string, init?: RequestInit): unknown | undefined {
  const method = (init?.method || 'GET').toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const PREFS = 'gc.prefs', ASSESS = 'gc.assessments';
  // NOTE: /api/feature-flags is a REAL backend route now (server/routes/feature_flags.py) —
  // it is intentionally NOT stubbed here, so admins can actually toggle beta features on.
  // no industry packs from server (SPA falls back to P&U default)
  if (url === '/api/industries' || url === '/api/admin/industries') return [];
  if (url === '/api/blend-presets' || url === '/api/admin/blend-presets') return [];
  if (url === '/api/my-prefs') {
    if (method === 'PUT') { lsSet(PREFS, body.prefs || {}); return { ok: true }; }
    return lsGet<Record<string, unknown>>(PREFS, {});
  }
  // NOTE: /api/drafts is NO LONGER stubbed — in-flight (draft) assessments are now
  // persisted SERVER-SIDE, per account, via /api/assessments (status='draft'), exactly
  // like submitted assessments. That is what scopes them to the account selected in the
  // top dropdown (the account middleware reads the X-Grid-Atlas-Account header). See the
  // draft methods below, which map onto the lifecycle endpoints.
  if (url === '/api/my-assessments') return lsGet<any[]>(ASSESS, []);
  if (url.startsWith('/api/my-assessments/')) {
    const id = decodeURIComponent(url.split('/api/my-assessments/')[1]);
    const all = lsGet<any[]>(ASSESS, []);
    if (method === 'DELETE') { lsSet(ASSESS, all.filter((a) => a.id !== id)); return { ok: true }; }
    return all.find((a) => a.id === id) || null;
  }
  // NOTE: /api/assessments POST is NOT stubbed — saveAssessment writes to the real
  // account-scoped lifecycle route so both drafts and submitted assessments live on the
  // server (a stale localStorage stub here used to divert saves off-server).
  return undefined;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const stub = localStub(url, init);
  if (stub !== undefined) return stub as T;
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...accountHeaders(),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface ConfigEntry {
  key: string;
  value: string;     // masked "••••••••" when isSecret + isSet
  isSet: boolean;
  isSecret: boolean;
  description: string;
  category: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface SfdcAccount {
  Id: string;
  Name: string;
  Industry?: string | null;
  BillingState?: string | null;
  BillingCountry?: string | null;
  AnnualRevenue?: number | null;
  NumberOfEmployees?: number | null;
  Type?: string | null;
}

export interface DraftRow {
  id: string;
  customer_name: string;
  current_step: number;
  created_at: string;
  updated_at: string;
}

export interface DraftDetail {
  id: string;
  customerName: string;
  currentStep: number;
  createdAt: string;
  updatedAt: string;
  answers: Record<string, unknown>;
}

export interface TrendRow { [k: string]: any }
export interface Trends {
  total: number;
  by_phase: TrendRow[];
  score_buckets: TrendRow[];
  by_submitter: TrendRow[];
  by_customer: TrendRow[];
  by_week: TrendRow[];
  top_use_cases: TrendRow[];
}

export interface PrepopulateSuggestion {
  profile?: {
    companyName?: string | null;
    utilityType?: 'electric' | 'gas' | 'electric_gas' | null;
    territorySize?: string | null;
    geography?: string | null;
    strategicPriorities?: string[];
  };
  infrastructure?: Record<string, 'yes' | 'partial' | 'no' | null>;
  useCasesInProduction?: { id: string; confidence: number; evidence: string }[];
  dataSourcesAvailable?: { id: string; confidence: number; evidence: string }[];
  notes?: string;
  error?: string;
  raw?: string;
}

export interface ValueField {
  key: string;
  label: string;
  value: number;
  unit: string | null;
  category: string | null;
  description: string | null;
}

export type FeatureFlagState = 'off' | 'admin' | 'on';

export interface FeatureFlagAdminRow {
  key: string;
  state: FeatureFlagState;
  name: string;
  description: string;
  category: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AccountRow {
  id: number; slug: string; name: string; utility_type?: string | null;
  role?: string; module_count?: number;
  geography?: string | null; territory_size?: string | null;
  strategic_priorities?: string[]; profile_complete?: boolean;
}

export interface AccountMember {
  user_email: string;
  role: 'owner' | 'editor' | 'viewer';
  added_by?: string | null;
  added_at?: string;
}
export interface Session {
  email: string | null;
  accounts: AccountRow[];
  active_account_id: number | null;
  is_admin: boolean;
}
export interface AssessmentRow {
  id: string; status: 'draft' | 'submitted'; label?: string | null;
  overall_score?: number | null; current_phase?: number | null;
  created_by?: string; created_at?: string; updated_at?: string; submitted_at?: string | null;
  answers_json?: any; results_json?: any;
}
export interface ProfileIn {
  name: string; utility_type?: string; slug?: string;
  geography?: string; territory_size?: string; strategic_priorities?: string[];
}
export interface DataSourceRow {
  id: string; name: string; category: string; description?: string;
  module_count?: number; available?: boolean;
}

export interface AuthorLink { id: number; rationale: string; label?: string }
export interface AuthorAsset extends AuthorLink { criticality: 'required' | 'helpful'; ready?: boolean }
export interface AuthorDomain { name: string; necessity: 'required' | 'helpful'; rationale: string; label?: string }
export interface AuthorProposal {
  title: string; description: string; category: string | null; sub_vertical: string;
  effort_tshirt: 'S' | 'M' | 'L' | 'XL'; lob_id: number | null;
  domains: AuthorDomain[]; data_assets: AuthorAsset[];
  prerequisites: AuthorLink[]; enables: AuthorLink[]; notes: string;
  value_model?: { components?: { name: string; calculationDisplay?: string }[]; notes?: string } | null;
}
export interface AuthorProposalResponse {
  proposal: AuthorProposal; warnings: string[]; used_llm: boolean; model: string; note?: string | null;
  lob_name?: string | null; readiness_preview: { required_total: number; required_ready: number };
}

export const api = {
  // Public — identity mapped from the converged /api/me (email + accounts + active).
  me: async (): Promise<CurrentUser> => {
    const s = await fetchJson<Session>('/api/me');
    if (s.active_account_id != null) setActiveAccountId(s.active_account_id);
    return { email: s.email, name: s.email, isAdmin: !!s.is_admin };
  },
  // Full session for the account switcher.
  session: () => fetchJson<Session>('/api/me'),
  // Accounts (multi-user, membership-gated server-side).
  listAccounts: () => fetchJson<{ accounts: AccountRow[]; current_account_id: number | null }>('/api/accounts'),
  createAccount: (name: string, utilityType?: string) =>
    fetchJson<AccountRow>('/api/accounts', {
      method: 'POST', body: JSON.stringify({ name, utility_type: utilityType }),
    }),
  // Full account creation = company-profile capture (static per customer).
  createAccountFull: (p: ProfileIn) =>
    fetchJson<AccountRow>('/api/accounts', { method: 'POST', body: JSON.stringify(p) }),
  patchAccount: (id: number, p: Partial<ProfileIn> & Record<string, unknown>) =>
    fetchJson<AccountRow>(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  deleteAccount: (id: number, hard = false) =>
    fetchJson<{ ok?: boolean }>(`/api/accounts/${id}${hard ? '?hard=true' : ''}`, { method: 'DELETE' }),
  switchAccount: (id: number) =>
    fetchJson<{ active_account: AccountRow }>(`/api/accounts/${id}/switch`, { method: 'POST', body: '{}' }),
  // Sharing — who can see & manage an account (owner/editor/viewer).
  accountMembers: (id: number) =>
    fetchJson<{ members: AccountMember[]; can_manage: boolean; me: string }>(`/api/accounts/${id}/members`),
  addAccountMember: (id: number, email: string, role: 'owner' | 'editor' | 'viewer') =>
    fetchJson<{ ok: boolean; email: string; role: string }>(`/api/accounts/${id}/members`, {
      method: 'POST', body: JSON.stringify({ email, role }),
    }),
  removeAccountMember: (id: number, email: string) =>
    fetchJson<{ ok: boolean; removed: string }>(`/api/accounts/${id}/members/${encodeURIComponent(email)}`,
      { method: 'DELETE' }),

  // --- Server-side assessments (per account): history, resume, prefill, delete ---
  listAssessments: (status?: 'draft' | 'submitted') =>
    fetchJson<{ assessments: AssessmentRow[] }>(`/api/assessments${status ? `?status=${status}` : ''}`),
  latestAssessment: () => fetchJson<{ assessment: AssessmentRow | null }>('/api/assessments/latest'),
  getAssessment: (id: string) => fetchJson<{ assessment: AssessmentRow }>(`/api/assessments/${encodeURIComponent(id)}`),
  saveAssessment: (a: { id: string; status: 'draft' | 'submitted'; label?: string;
                        answers_json: any; results_json?: any; overall_score?: number; current_phase?: number }) =>
    fetchJson<{ id: string; status: string }>('/api/assessments', { method: 'POST', body: JSON.stringify(a) }),
  deleteAssessmentSrv: (id: string) =>
    fetchJson<{ deleted: string }>(`/api/assessments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  promotions: () => fetchJson<{ promotions: any[] }>('/api/promotions'),

  // --- Operate (per active account) ---
  operateDashboard: () => fetchJson<any>('/api/analytics/dashboard'),
  operateRoadmap: () => fetchJson<{ account_id: number | null;
    use_cases: Array<{ id: number; title: string; phase: number | null; status: string;
      readiness: string | null; hypothesized_mm: number; realized_mm: number }>;
    summary: Record<string, number> }>('/api/operate/roadmap'),
  useCasesReadiness: () => fetchJson<Record<string, any>>('/api/use-cases/readiness'),
  useCasesList: () => fetchJson<any>('/api/use-cases'),
  roadmapItems: () => fetchJson<any>('/api/roadmap'),
  reconciliation: () => fetchJson<{ counts: Record<string, number>;
    sources: Array<{ id: string; name: string; category: string; self_reported: boolean;
      discovered: boolean; modules: number; status: string }> }>('/api/operate/reconciliation'),
  useCaseDetail: (id: number) => fetchJson<any>(`/api/use-cases/${id}/detail`),
  // Use-case lifecycle tracking (living roadmap)
  setUseCaseStatus: (id: number, status?: string, advance = false) =>
    fetchJson<any>(`/api/use-cases/${id}/status`, {
      method: 'PATCH', body: JSON.stringify(advance ? { advance: true } : { status }) }),
  roadmapForUseCase: (id: number) =>
    fetchJson<any>(`/api/roadmap?use_case_id=${id}`),
  upsertRoadmap: (body: { use_case_id: number; horizon?: string | null; wave?: number | null;
    target_date?: string | null; completion_date?: string | null; notes?: string | null }) =>
    fetchJson<any>('/api/roadmap', { method: 'POST', body: JSON.stringify(body) }),
  addValueRecord: (body: { use_case_id: number; kind: string; metric_type?: string;
    amount?: number; unit?: string; fiscal_period?: string; confidence?: string }) =>
    fetchJson<any>('/api/values', { method: 'POST', body: JSON.stringify(body) }),
  addComment: (entity_id: number, bodyText: string) =>
    fetchJson<any>('/api/comments', { method: 'POST',
      body: JSON.stringify({ entity_type: 'use_case', entity_id, body: bodyText, mentions: [] }) }),
  deleteComment: (commentId: number) =>
    fetchJson<any>(`/api/comments/${commentId}`, { method: 'DELETE' }),
  getProposal: (id: number) => fetchJson<any>(`/api/proposals/use-cases/${id}`),
  kbArticle: (slug: string) => fetchJson<any>(`/api/knowledge/articles/${encodeURIComponent(slug)}`),
  generateProposal: (id: number, regenerate = false) =>
    fetchJson<any>(`/api/proposals/use-cases/${id}${regenerate ? '?regenerate=true' : ''}`,
      { method: 'POST', body: '{}' }),
  // Coverage & gaps
  coverageMatrix: () => fetchJson<any>('/api/domains/coverage-matrix'),
  domainGaps: () => fetchJson<any>('/api/domains/gaps'),
  // Data assets (per-account ingestion status overlaid)
  dataAssets: () => fetchJson<any[]>('/api/data-assets'),
  // Coarse (Assess) source -> fine (Operate) module lineage, per account
  dataLineage: () => fetchJson<{ account_id: number | null; sources: Array<{
    source_id: string; source_name: string; category: string; self_reported: boolean;
    module_count: number; modules_ready: number; modules: Array<{
      data_asset_id: number; module: string; source_category: string; vendor: string | null;
      ingestion_status: string; status_source: string | null; is_user_edited: boolean; ready: boolean;
    }> }> }>('/api/operate/data-lineage'),
  // Correct a module's per-account ingestion status (stamps source='manual')
  setAssetStatus: (assetId: number, ingestion_status: string) =>
    fetchJson<any>(`/api/data-assets/${assetId}/status`, {
      method: 'PATCH', body: JSON.stringify({ ingestion_status }) }),
  // Value / analyze
  valueComputed: () => fetchJson<any>('/api/value-assumptions/computed/portfolio'),
  valueAssumptions: () => fetchJson<any[]>('/api/value-assumptions'),
  jointOpportunities: () => fetchJson<{ opportunities: any[] }>('/api/joint-funding/opportunities'),
  // What-if
  whatifCandidates: () => fetchJson<any>('/api/whatif/candidates'),
  whatifSimulate: (assetIds: number[]) =>
    fetchJson<any>('/api/whatif/simulate', { method: 'POST', body: JSON.stringify({ data_asset_ids: assetIds }) }),

  // --- Admin (cross-account; admins only) ---
  adminOverview: () => fetchJson<{ accounts: any[]; users: any[]; admins: string[]; totals: any }>('/api/admin/overview'),
  adminAssessments: () => fetchJson<{ assessments: any[] }>('/api/admin/assessments'),
  promoteFull: (selectedDataSourceIds: string[], inProductionUseCaseIds: string[], assessmentId?: string) =>
    fetchJson<{ sources_available: number; modules_set: number; use_cases_added: number; unresolved_use_cases: string[] }>(
      '/api/assess/promote', { method: 'POST', body: JSON.stringify({
        selected_data_source_ids: selectedDataSourceIds,
        in_production_use_case_ids: inProductionUseCaseIds, assessment_id: assessmentId }) }),
  // Canonical 31-source taxonomy for the current account.
  dataSourcesApi: () => fetchJson<{ data_sources: DataSourceRow[]; account_id: number | null }>('/api/data-sources'),
  // Promote an assessment result into the current account's Operate state.
  // roadmapUseCaseIds = the prescriptive roadmap's recommended next use cases, added to
  // the portfolio (source='roadmap') so Operate shows the full roadmap, not just what's live.
  promote: (selectedDataSourceIds: string[], inProductionUseCaseIds: string[],
            roadmapUseCaseIds: string[] = [], assessmentId?: string) =>
    fetchJson<{ sources_available: number; modules_set: number; use_cases_added: number;
                in_production_added?: number; roadmap_added?: number; unresolved_use_cases: string[] }>(
      '/api/assess/promote', {
        method: 'POST',
        body: JSON.stringify({
          selected_data_source_ids: selectedDataSourceIds,
          in_production_use_case_ids: inProductionUseCaseIds,
          roadmap_use_case_ids: roadmapUseCaseIds,
          assessment_id: assessmentId,
        }),
      }),
  myFeatureFlags: () => fetchJson<Record<string, boolean>>('/api/feature-flags'),
  /** LEGACY single-industry endpoint. Newer code uses `industries()` below. */
  activeIndustry: () => fetchJson<{ id: string; meta: any }>('/api/industry'),

  /** All enabled industries available in this workspace. Drives the wizard's
   *  industry picker and populates the active-industry cache. */
  industries: () => fetchJson<Array<any>>('/api/industries'),
  adminListIndustries: () => fetchJson<Array<any>>('/api/admin/industries'),
  adminCreateIndustry: (payload: any) => fetchJson<{ ok: boolean }>(
    '/api/admin/industries',
    { method: 'POST', body: JSON.stringify(payload) },
  ),
  adminUpdateIndustry: (id: string, payload: any) => fetchJson<{ ok: boolean }>(
    `/api/admin/industries/${encodeURIComponent(id)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
  ),
  adminDeleteIndustry: (id: string) => fetchJson<{ ok: boolean }>(
    `/api/admin/industries/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  ),

  /** Named blend presets — saved compositions of industry packs. Available
   *  to all users in the wizard + roadmap picker; admin-managed. */
  blendPresets: () => fetchJson<Array<{
    id: string; label: string; description: string;
    industryIds: string[]; sortOrder: number;
  }>>('/api/blend-presets'),
  adminListBlendPresets: () => fetchJson<Array<{
    id: string; label: string; description: string;
    industryIds: string[]; sortOrder: number;
  }>>('/api/admin/blend-presets'),
  adminCreateBlendPreset: (payload: any) => fetchJson<{ ok: boolean }>(
    '/api/admin/blend-presets',
    { method: 'POST', body: JSON.stringify(payload) },
  ),
  adminUpdateBlendPreset: (id: string, payload: any) => fetchJson<{ ok: boolean }>(
    `/api/admin/blend-presets/${encodeURIComponent(id)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
  ),
  adminDeleteBlendPreset: (id: string) => fetchJson<{ ok: boolean }>(
    `/api/admin/blend-presets/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  ),

  fxRates: () => fetchJson<{ json: string }>('/api/locale/fx-rates'),

  // Custom assumption fields — admin-managed catalog that supplements the
  // built-in BusinessAssumptions list in the Quantified Annual Value editor.
  assumptionFields: () => fetchJson<Array<{
    key: string; label: string; unit: string;
    defaultValue: number; step: number; min: number; max: number;
    category: string; relevantFor: string[]; enabled: boolean;
    updatedAt?: string; updatedBy?: string;
  }>>('/api/assumption-fields'),
  adminListAssumptionFields: () => fetchJson<Array<{
    key: string; label: string; unit: string;
    defaultValue: number; step: number; min: number; max: number;
    category: string; relevantFor: string[]; enabled: boolean;
    updatedAt?: string; updatedBy?: string;
  }>>('/api/admin/assumption-fields'),
  adminCreateAssumptionField: (payload: {
    key: string; label: string; unit?: string;
    defaultValue?: number; step?: number; min?: number; max?: number;
    category?: string; relevantFor?: string[]; enabled?: boolean;
  }) => fetchJson<{ ok: boolean }>('/api/admin/assumption-fields', {
    method: 'POST', body: JSON.stringify(payload),
  }),
  adminUpdateAssumptionField: (key: string, payload: {
    key: string; label: string; unit?: string;
    defaultValue?: number; step?: number; min?: number; max?: number;
    category?: string; relevantFor?: string[]; enabled?: boolean;
  }) => fetchJson<{ ok: boolean }>(`/api/admin/assumption-fields/${encodeURIComponent(key)}`, {
    method: 'PUT', body: JSON.stringify(payload),
  }),
  // Value-model fields shaped to the converged backend (server/routes/admin_assess.py):
  // {key,label,value,unit,category,description}. Used by the Admin > Assumptions tab.
  listValueFields: () => fetchJson<Array<ValueField>>('/api/admin/assumption-fields'),
  createValueField: (payload: { label: string; value?: number; unit?: string | null; category?: string | null; description?: string | null }) =>
    fetchJson<{ ok: boolean; key: string }>('/api/admin/assumption-fields', { method: 'POST', body: JSON.stringify(payload) }),
  updateValueField: (key: string, payload: { label: string; value?: number; unit?: string | null; category?: string | null; description?: string | null }) =>
    fetchJson<{ ok: boolean; key: string }>(`/api/admin/assumption-fields/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  adminDeleteAssumptionField: (key: string) => fetchJson<{ ok: boolean }>(
    `/api/admin/assumption-fields/${encodeURIComponent(key)}`,
    { method: 'DELETE' },
  ),
  capacityModel: () => fetchJson<{ baselineCapacityPerHalf: number; capacityCostPerPointM: number }>(
    '/api/strategic-roadmap/capacity-model',
  ),

  // Admin — feature flags
  adminListFeatureFlags: () => fetchJson<FeatureFlagAdminRow[]>('/api/admin/feature-flags'),
  adminUpdateFeatureFlag: (key: string, state: FeatureFlagState) =>
    fetchJson<{ ok: boolean }>(`/api/admin/feature-flags/${encodeURIComponent(key)}`, {
      method: 'PUT', body: JSON.stringify({ state }),
    }),

  // Experimental — AI exec summary
  generateExecSummary: (assessmentId: string) =>
    fetchJson<{ assessmentId: string; summary: string; model: string }>(
      `/api/assessments/${encodeURIComponent(assessmentId)}/exec-summary`,
      { method: 'POST' },
    ),

  // AI use-case proposer — returns 3-5 new UCs tailored to the customer.
  generateProposedUseCases: (assessmentId: string) =>
    fetchJson<{
      rationale: string;
      proposals: Array<{
        id: string; name: string; phase: number; domain: string;
        description: string; businessValue: string[]; dataRequirements: string[];
        complexity: number; whyItFits: string; expectedValueMM: number;
      }>;
    }>(
      `/api/assessments/${encodeURIComponent(assessmentId)}/proposed-use-cases`,
      { method: 'POST' },
    ),

  // Data-source strategy — aggregated + AI-narrated overview of the data the
  // customer needs to ingest to deliver the recommended roadmap.
  generateDataStrategy: (assessmentId: string) =>
    fetchJson<{
      narrative: string;
      categories: Array<{
        name: string;
        sources: Array<{
          label: string; earliestPhase: number;
          ucIds: string[]; ucNames: string[]; alreadyInScope: boolean;
        }>;
      }>;
      totalSources: number;
      alreadyInScope: number;
      needToIngest: number;
    }>(
      `/api/assessments/${encodeURIComponent(assessmentId)}/data-strategy`,
      { method: 'POST' },
    ),

  // Experimental — strategic 3/5 yr roadmap narrative (LLM prose around a
  // deterministic schedule built client-side).
  strategicRoadmapNarrative: (payload: unknown) =>
    fetchJson<{ narrative: string; model: string; horizonYears: number }>(
      '/api/strategic-roadmap/narrative',
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  // Pre-assessment Excel workflow — downloadable worksheet + upload parser.
  // Full worksheet: every wizard step (Profile / Infrastructure / Capabilities
  // questions from preassessmentSpec.ts + the server-side use-case / data-source tabs).
  preassessmentWorksheet: async (params: { utilityType?: string | null; customerName?: string | null; questions: unknown[] }): Promise<Blob> => {
    const r = await fetch('/api/preassessment/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...accountHeaders() },
      body: JSON.stringify({ utilityType: params.utilityType || null, customerName: params.customerName || '', questions: params.questions }),
    });
    if (!r.ok) throw new Error(`Template download failed (${r.status})`);
    return await r.blob();
  },
  preassessmentParse: async (file: File): Promise<{ useCaseIds: string[]; dataSourceIds: string[]; answers?: Record<string, string | string[]>; warnings: string[] }> => {
    const form = new FormData();
    form.append('file', file, file.name);
    const r = await fetch('/api/preassessment/parse', {
      method: 'POST',
      headers: { ...accountHeaders() },   // multipart boundary set by the browser
      body: form,
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`Parse failed (${r.status}): ${txt.slice(0, 200)}`);
    }
    return await r.json();
  },

  // Experimental — outcome tracking (commitments + check-ins).
  createCommitment: (payload: unknown) =>
    fetchJson<{ id: string }>('/api/roadmap/commitments', {
      method: 'POST', body: JSON.stringify(payload),
    }),
  listCommitments: (customerName?: string | null) => {
    const qs = customerName ? `?customerName=${encodeURIComponent(customerName)}` : '';
    return fetchJson<Array<{
      id: string; customer_name: string; assessment_id: string | null;
      created_at: string; created_by: string;
      horizon_years: number; start_date: string; notes: string;
    }>>(`/api/roadmap/commitments${qs}`);
  },
  getCommitment: (id: string) =>
    fetchJson<{
      id: string; customerName: string; assessmentId: string | null;
      createdAt: string; createdBy: string;
      horizonYears: number; startDate: string; notes: string;
      schedule: any;
      checkins: Array<{ id: string; created_at: string; created_by: string; as_of_date: string; notes: string; status: Record<string, string> }>;
    }>(`/api/roadmap/commitments/${encodeURIComponent(id)}`),
  deleteCommitment: (id: string) =>
    fetchJson<{ ok: boolean }>(`/api/roadmap/commitments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createCheckin: (payload: { commitmentId: string; asOfDate?: string; status: Record<string, string>; notes?: string }) =>
    fetchJson<{ id: string }>('/api/roadmap/checkins', {
      method: 'POST', body: JSON.stringify(payload),
    }),

  // Experimental — pre-submit AI consistency check on the assessment answers.
  consistencyCheck: (answers: unknown) =>
    fetchJson<{ issues: Array<{
      id: string;
      severity: 'warn' | 'info' | 'error';
      title: string;
      description: string;
      suggestedFix: string;
      stepIndex: number;
    }> }>('/api/assessments/consistency-check', {
      method: 'POST', body: JSON.stringify({ answers }),
    }),

  // Experimental — POC Statement of Work (.docx download).
  generatePocScope: async (payload: unknown): Promise<Blob> => {
    const r = await fetch('/api/poc-scope/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`POC SOW generation failed (${r.status}): ${txt.slice(0, 200)}`);
    }
    return await r.blob();
  },

  // Experimental — strategic roadmap deck (PowerPoint download).
  strategicRoadmapDeck: async (payload: unknown): Promise<Blob> => {
    const r = await fetch('/api/strategic-roadmap/deck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`Deck generation failed (${r.status}): ${txt.slice(0, 200)}`);
    }
    return await r.blob();
  },

  // Drafts (in-flight assessments) — persisted SERVER-SIDE per account via the
  // lifecycle route (status='draft'), so they align to the account selected in the top
  // dropdown, exactly like submitted assessments. The wizard step rides in
  // `current_phase` (a draft has no maturity phase yet).
  myDrafts: async (): Promise<DraftRow[]> => {
    const r = await fetchJson<{ assessments: AssessmentRow[] }>('/api/assessments?status=draft');
    return (r.assessments || []).map((a) => ({
      id: a.id, customer_name: a.label || '', current_step: a.current_phase || 0,
      created_at: a.created_at || '', updated_at: a.updated_at || a.created_at || '',
    }));
  },
  getDraft: async (id: string): Promise<DraftDetail> => {
    const r = await fetchJson<{ assessment: AssessmentRow }>(`/api/assessments/${encodeURIComponent(id)}`);
    const a = r.assessment;
    return {
      id: a.id, customerName: a.label || '', currentStep: a.current_phase || 0,
      createdAt: a.created_at || '', updatedAt: a.updated_at || a.created_at || '',
      answers: (a.answers_json || {}) as Record<string, unknown>,
    };
  },
  upsertDraft: (id: string, customerName: string, answers: unknown, currentStep: number) =>
    fetchJson<{ id: string; status: string }>('/api/assessments', {
      method: 'POST',
      body: JSON.stringify({ id, status: 'draft', label: customerName,
                             answers_json: answers, current_phase: currentStep }),
    }),
  deleteDraft: (id: string) =>
    fetchJson<{ deleted: string }>(`/api/assessments/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // My assessments (RBAC scoped)
  // Recent-work + view read SERVER-SIDE submitted assessments (per account), mapped to
  // the landing's row/detail shapes. (Was a localStorage/legacy stub.)
  myAssessments: async (): Promise<AssessmentListRow[]> => {
    const r = await fetchJson<{ assessments: AssessmentRow[] }>('/api/assessments?status=submitted');
    return (r.assessments || []).map((a) => ({
      id: a.id, customer_name: a.label || '', created_at: a.submitted_at || a.created_at || '',
      created_by: a.created_by || '', overall_score: a.overall_score || 0, current_phase: a.current_phase || 0,
    }));
  },
  getMyAssessment: async (id: string): Promise<AssessmentDetail> => {
    const r = await fetchJson<{ assessment: AssessmentRow }>(`/api/assessments/${encodeURIComponent(id)}`);
    const a = r.assessment;
    return {
      id: a.id, customerName: a.label || '', createdAt: a.submitted_at || a.created_at || '',
      createdBy: a.created_by || '', overallScore: a.overall_score || 0, currentPhase: a.current_phase || 0,
      answers: (a.answers_json || {}) as Record<string, unknown>,
      results: (a.results_json || {}) as Record<string, unknown>,
    };
  },
  myAssessmentsByCustomer: (customerName: string) =>
    fetchJson<AssessmentListRow[]>(
      `/api/my-assessments/by-customer?customerName=${encodeURIComponent(customerName)}`,
    ),
  compareAssessments: (fromId: string, toId: string) =>
    fetchJson<{ from: AssessmentDetail; to: AssessmentDetail }>(
      `/api/my-assessments/compare?fromId=${encodeURIComponent(fromId)}&toId=${encodeURIComponent(toId)}`,
    ),
  deleteMyAssessment: (id: string) =>
    fetchJson<{ deleted: string }>(`/api/assessments/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // PPTX export
  pptxUrl: (id: string) => `/api/assessments/${encodeURIComponent(id)}/pptx`,
  valueFlywheelRoadmapPackage: async (assessmentId: string): Promise<Blob> => {
    const r = await fetch(`/api/exports/value-flywheel-roadmap?assessmentId=${encodeURIComponent(assessmentId)}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`Value Flywheel export failed (${r.status}): ${txt.slice(0, 200)}`);
    }
    return await r.blob();
  },

  // User preferences (assumptions defaults, etc.)
  getMyPrefs: () => fetchJson<Record<string, unknown>>('/api/my-prefs'),
  putMyPrefs: (prefs: Record<string, unknown>) =>
    fetchJson<{ ok: boolean }>('/api/my-prefs', {
      method: 'PUT', body: JSON.stringify({ prefs }),
    }),
  updateMyAssessmentAssumptions: (id: string, assumptions: Record<string, unknown>) =>
    fetchJson<{ ok: boolean }>(`/api/my-assessments/${encodeURIComponent(id)}/assumptions`, {
      method: 'PUT', body: JSON.stringify({ assumptions }),
    }),

  // Admin trends
  adminTrends: () => fetchJson<Trends>('/api/admin/trends'),

  // Admin config
  adminListConfig: () => fetchJson<ConfigEntry[]>('/api/admin/config'),
  adminUpsertConfig: (entry: { key: string; value: string | null; isSecret: boolean; description: string; category: string }) =>
    fetchJson<{ ok: boolean }>('/api/admin/config', {
      method: 'PUT',
      body: JSON.stringify(entry),
    }),
  adminDeleteConfig: (key: string) =>
    fetchJson<{ ok: boolean }>(`/api/admin/config/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }),

  // DBX usage scan stub
  scanCustomerUsage: () =>
    fetchJson<{ configured: boolean; message: string }>('/api/admin/scan-customer-usage', {
      method: 'POST', body: '{}',
    }),
  health: () => fetchJson<{ status: string; warehouse_configured: boolean; db_init_error?: string }>('/api/health'),
  // The WHOLE catalog (all use cases), for the admin editor + the editor's prerequisite
  // picker. /api/use-cases is PAGINATED ({items,total,…}) and defaults to a page/scope —
  // unwrap items + request scope=all with a high limit so nothing is silently dropped
  // (this was why the Admin → Use Cases table showed "No use cases").
  useCases: async (): Promise<UseCaseAPI[]> => {
    const r = await fetchJson<{ items: UseCaseAPI[] } | UseCaseAPI[]>('/api/use-cases?scope=all&limit=2000');
    return Array.isArray(r) ? r : (r?.items ?? []);
  },
  // Admin catalog editor — create/update/delete use cases (server/routes/use_cases.py).
  // `title` is the only required field; status must be one of the lifecycle values.
  createUseCase: (payload: {
    title: string; description?: string | null; lob_id?: number | null;
    status?: string; category?: string | null;
  }) => fetchJson<{ id: number }>('/api/use-cases', {
    method: 'POST', body: JSON.stringify(payload),
  }),
  updateUseCase: (id: string | number, payload: {
    title: string; description?: string | null; lob_id?: number | null;
    status?: string; category?: string | null;
  }) => fetchJson<{ id: number }>(`/api/use-cases/${encodeURIComponent(String(id))}`, {
    method: 'PUT', body: JSON.stringify(payload),
  }),
  deleteUseCase: (id: string | number) => fetchJson<{ ok: boolean }>(
    `/api/use-cases/${encodeURIComponent(String(id))}`, { method: 'DELETE' }),
  // Partial edit (non-admin): change only the fields provided — title/description
  // and/or the value model — without the full-replace semantics of PUT.
  patchUseCase: (id: string | number, payload: {
    title?: string; description?: string | null; hypothesized_value_json?: any;
  }) => fetchJson<any>(`/api/use-cases/${encodeURIComponent(String(id))}`, {
    method: 'PATCH', body: JSON.stringify(payload),
  }),
  // Agentic value estimate: returns { value_model, used_llm, fallback_note }.
  estimateValue: (id: number) => fetchJson<any>('/api/agents/estimate-value', {
    method: 'POST', body: JSON.stringify({ use_case_id: id }),
  }),

  setAccountArchetype: (archetype_key: string) =>
    fetchJson<any>('/api/playbook/account-archetype', { method: 'PATCH', body: JSON.stringify({ archetype_key }) }),
  submitAssessment: (payload: unknown) =>
    fetchJson<{ id: string }>('/api/assessments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Admin
  adminListAdmins: () => fetchJson<AdminRow[]>('/api/admin/admins'),
  adminAddAdmin: (email: string) =>
    fetchJson<{ ok: boolean }>('/api/admin/admins', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  adminRemoveAdmin: (email: string) =>
    fetchJson<{ ok: boolean }>(`/api/admin/admins/${encodeURIComponent(email)}`, {
      method: 'DELETE',
    }),

  adminListUseCases: () => fetchJson<UseCaseAPI[]>('/api/admin/use-cases'),
  adminUpsertUseCase: (uc: UseCaseAPI) =>
    fetchJson<{ ok: boolean }>(`/api/admin/use-cases/${encodeURIComponent(uc.id)}`, {
      method: 'PUT',
      body: JSON.stringify(uc),
    }),
  adminCreateUseCase: (uc: UseCaseAPI) =>
    fetchJson<{ ok: boolean }>('/api/admin/use-cases', {
      method: 'POST',
      body: JSON.stringify(uc),
    }),
  adminDeleteUseCase: (id: string) =>
    fetchJson<{ ok: boolean }>(`/api/admin/use-cases/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Artifacts — customer (only enabled)
  getArtifacts: (useCaseId?: string) =>
    fetchJson<ArtifactAPI[]>(
      useCaseId ? `/api/artifacts?use_case_id=${encodeURIComponent(useCaseId)}` : '/api/artifacts'
    ),

  // Artifacts — admin (all including disabled)
  adminListArtifacts: (useCaseId?: string) =>
    fetchJson<ArtifactAPI[]>(
      useCaseId ? `/api/admin/artifacts?use_case_id=${encodeURIComponent(useCaseId)}` : '/api/admin/artifacts'
    ),
  adminCreateArtifact: (a: ArtifactAPI) =>
    fetchJson<{ ok: boolean }>('/api/admin/artifacts', {
      method: 'POST',
      body: JSON.stringify(a),
    }),
  adminUpdateArtifact: (a: ArtifactAPI) =>
    fetchJson<{ ok: boolean }>(`/api/admin/artifacts/${encodeURIComponent(a.id)}`, {
      method: 'PUT',
      body: JSON.stringify(a),
    }),
  adminToggleArtifact: (id: string, enabled: boolean) =>
    fetchJson<{ ok: boolean }>(`/api/admin/artifacts/${encodeURIComponent(id)}/enabled`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  adminDeleteArtifact: (id: string) =>
    fetchJson<{ ok: boolean }>(`/api/admin/artifacts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  adminListAssessments: () => fetchJson<AssessmentListRow[]>('/api/admin/assessments'),
  adminGetAssessment: (id: string) =>
    fetchJson<AssessmentDetail>(`/api/admin/assessments/${encodeURIComponent(id)}`),
  adminDeleteAssessment: (id: string) =>
    fetchJson<{ ok: boolean }>(`/api/admin/assessments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // --- Discovery / ingestion pipeline (customer-side) ----------------------
  setupStatus: () => fetchJson<{ ready: boolean; checks: Array<{
    name: string; ok: boolean; label: string; detail: string; required: boolean;
    fix?: string | null; grants: string[] }> }>('/api/setup/status'),
  setupGrants: () => fetchJson<{ service_principal: string; sql: string }>('/api/setup/grants'),
  setupRecheck: () => fetchJson<any>('/api/setup/recheck', { method: 'POST', body: '{}' }),
  extractorInfo: () => fetchJson<{ available: boolean; files: string[]; total_bytes: number;
    requires: string[]; reads: string; produces: string[] }>('/api/ingestion/extractor/info'),
  ingestionSummary: () => fetchJson<any>('/api/ingestion/summary'),
  ingestionAliases: (needsReview = false) =>
    fetchJson<any>(`/api/ingestion/aliases?needs_review=${needsReview}`),
  ingestionRuns: () => fetchJson<any[]>('/api/ingestion/runs'),
  sourceRecommendations: () => fetchJson<any>('/api/source-recommendations/recommendations'),
  ingestUpload: async (kind: 'schemas' | 'tables' | 'columns', file: File): Promise<any> => {
    const form = new FormData();
    form.append('file', file, file.name);
    const r = await fetch(`/api/ingestion/upload/${kind}`, {
      method: 'POST', headers: { ...accountHeaders() }, body: form,
    });
    if (!r.ok) throw new Error(`Upload ${kind} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    return r.json();
  },
  enrichSchemas: () => fetchJson<any>('/api/ingestion/enrich/schemas', { method: 'POST', body: '{}' }),
  enrichTables: () => fetchJson<any>('/api/ingestion/enrich/tables', { method: 'POST', body: '{}' }),
  canonicalize: () => fetchJson<any>('/api/ingestion/canonicalize', { method: 'POST', body: '{}' }),
  attribute: () => fetchJson<any>('/api/ingestion/attribute',
    { method: 'POST', body: JSON.stringify({ advance_status: true }) }),

  // --- Native agents (surface existing /api/use-cases/author, /api/agents, /api/chat) --
  lobs: () => fetchJson<any[]>('/api/lobs'),
  // Add a use case by hand: the agent proposes every mapping (writes nothing), the
  // reviewer edits, commit returns a confirm card, confirmWrite performs the write.
  authorPropose: (body: { title: string; description?: string; lob_id?: number | null; notes?: string; use_case_id?: number | null }) =>
    fetchJson<AuthorProposalResponse>('/api/use-cases/author/propose', { method: 'POST', body: JSON.stringify(body) }),
  authorCommit: (body: { proposal: AuthorProposal; use_case_id?: number | null; in_portfolio?: boolean }) =>
    fetchJson<{ token: string; summary: string; proposal: AuthorProposal; warnings: string[] }>(
      '/api/use-cases/author/commit', { method: 'POST', body: JSON.stringify(body) }),
  confirmWrite: (token: string) =>
    fetchJson<any>(`/api/confirm/${encodeURIComponent(token)}`, { method: 'POST', body: '{}' }),
  detectDependencies: (useCaseId: number, maxAssets = 6, maxEnables = 6) =>
    fetchJson<any>('/api/agents/detect-dependencies',
      { method: 'POST', body: JSON.stringify({ use_case_id: useCaseId, max_assets: maxAssets, max_enables: maxEnables }) }),
  decomposeSource: (sourceCategory: string, vendor?: string) =>
    fetchJson<any>('/api/agents/decompose-source',
      { method: 'POST', body: JSON.stringify({ source_category: sourceCategory, vendor: vendor || null }) }),
  chatSend: (message: string, conversationId?: string) =>
    fetchJson<{ conversation_id: string; answer: string; tools_used: any[]; confirm: any; note?: string }>(
      '/api/chat', { method: 'POST', body: JSON.stringify({ message, conversation_id: conversationId || null }) }),
  chatTools: () => fetchJson<{ tools: Array<{ name: string; description?: string }> }>('/api/chat/tools/list'),

  // --- Value-assumptions calibration (per-customer) ------------------------
  listValueAssumptions: () => fetchJson<any[]>('/api/value-assumptions'),
  updateValueAssumption: (key: string, value: number) =>
    fetchJson<any>(`/api/value-assumptions/${encodeURIComponent(key)}`,
      { method: 'PUT', body: JSON.stringify({ value }) }),
  researchCompany: (companyName: string) =>
    fetchJson<any>('/api/research/company',
      { method: 'POST', body: JSON.stringify({ company_name: companyName, calibrate_assumptions: true, propose_lobs: false }) }),
  researchAssumptions: () => fetchJson<any>('/api/research/assumptions'),
  researchApply: (runId: number | null, keys: string[] = []) =>
    fetchJson<any>('/api/research/apply',
      { method: 'POST', body: JSON.stringify({ run_id: runId, keys, apply_profile: false, apply_lobs: false }) }),

  // --- Raw/product tiers, dependency graph, editor deps, roadmap waves, DAB export ---
  // Layered dependency graph (raw datasets → data products → use cases) for the visual
  // What-If + Execute-Roadmap timelapse. See server/routes/whatif.py:/graph.
  whatifGraph: () => fetchJson<{
    account_id: number | null;
    nodes: {
      raw: Array<{ id: number; module: string; source_category: string; status: string; ready: boolean }>;
      product: Array<{ id: number; module: string; source_category: string; status: string; ready: boolean; curate_effort: string | null }>;
      use_case: Array<{ id: number; title: string; phase: number | null; readiness: string | null; value_mm: number; in_portfolio: boolean }>;
    };
    edges: {
      feeds: Array<{ raw_id: number; product_id: number }>;
      requires: Array<{ use_case_id: number; asset_id: number; tier: string; criticality: string }>;
      enables: Array<{ from_use_case_id: number; to_use_case_id: number }>;
    };
  }>('/api/whatif/graph'),

  // Roadmap waves (topologically sorted) for the Execute-Roadmap timelapse.
  agentsRoadmap: () => fetchJson<{ horizons: { now: any[]; next: any[]; later: any[] }; waves: number }>(
    '/api/agents/roadmap', { method: 'POST', body: JSON.stringify({ persist: false }) }),

  // Live projection for the What-If: given assets being landed/curated, returns each
  // use case's PROJECTED readiness (recolour live) + the use cases that NEWLY become
  // shovel-ready (the incremental unlock), each flagged in_portfolio or not, by value.
  whatifProject: (dataAssetIds: number[]) => fetchJson<{
    projected_readiness: Record<string, string>;
    unlocked: Array<{ id: number; title: string; phase: number | null; value_mm: number; in_portfolio: boolean; readiness: string }>;
    unlocked_count: number; unlocked_in_portfolio: number; unlocked_new: number;
  }>('/api/whatif/project', { method: 'POST', body: JSON.stringify({ data_asset_ids: dataAssetIds }) }),

  // Use-case dependency editing (searchable multi-selects in the editor).
  ucNetwork: (id: number) => fetchJson<{ focal: number; prerequisites: number[]; builds_upon: number[]; shared_data: number[]; titles: Record<string, string> }>(
    `/api/use-cases/${id}/network`),
  ucUnlocks: (id: number) => fetchJson<any>(`/api/use-cases/${id}/unlocks`),
  ucRequires: (useCaseId: number) => fetchJson<Array<{ use_case_id: number; data_asset_id: number; criticality: string; manual: boolean }>>(
    `/api/dependencies/requires?use_case_id=${useCaseId}`),
  addRequires: (useCaseId: number, dataAssetId: number, criticality: 'required' | 'helpful' = 'required') =>
    fetchJson<{ ok: boolean }>('/api/dependencies/requires', { method: 'POST', body: JSON.stringify({ use_case_id: useCaseId, data_asset_id: dataAssetId, criticality, manual: true }) }),
  removeRequires: (useCaseId: number, dataAssetId: number) =>
    fetchJson<{ ok: boolean }>(`/api/dependencies/requires?use_case_id=${useCaseId}&data_asset_id=${dataAssetId}`, { method: 'DELETE' }),
  addEnables: (fromUseCaseId: number, toUseCaseId: number) =>
    fetchJson<{ ok: boolean }>('/api/dependencies/enables', { method: 'POST', body: JSON.stringify({ from_use_case_id: fromUseCaseId, to_use_case_id: toUseCaseId }) }),
  removeEnables: (fromUseCaseId: number, toUseCaseId: number) =>
    fetchJson<{ ok: boolean }>(`/api/dependencies/enables?from_use_case_id=${fromUseCaseId}&to_use_case_id=${toUseCaseId}`, { method: 'DELETE' }),

  // --- Portfolio add-from-catalog, manual dataset/product creation, agent standardize ---
  // Recommended catalog use cases (ideas to add), for the "recommended first" section.
  recommendCatalog: (topN = 8) => fetchJson<{ recommendations: Array<{ id: number; title: string; lob_name?: string; readiness?: string; value_mm?: number; pending_prereqs?: string[] }> }>(`/api/agents/recommend-catalog?top_n=${topN}`),
  // Catalog listing with each use case's in_portfolio flag (for "add from catalog").
  // NOTE: /api/use-cases is PAGINATED ({items,total,limit,offset}); unwrap items + ask
  // for a high limit so the modal gets the whole catalog, not one page / a blank crash.
  catalogUseCases: async (): Promise<Array<{ id: number; title: string; phase: number | null; category: string | null; lob_id: number | null; in_portfolio: boolean }>> => {
    const r = await fetchJson<{ items: any[] } | any[]>('/api/use-cases?scope=all&limit=1000');
    return Array.isArray(r) ? r : (r?.items ?? []);
  },
  setPortfolio: (ucId: number, inPortfolio: boolean) =>
    fetchJson<any>(`/api/use-cases/${ucId}/portfolio`, { method: 'PATCH', body: JSON.stringify({ in_portfolio: inPortfolio }) }),
  bulkPortfolio: (ids: number[], inPortfolio = true) =>
    fetchJson<{ updated: number }>('/api/use-cases/portfolio/bulk', { method: 'POST', body: JSON.stringify({ ids, in_portfolio: inPortfolio }) }),
  // Manually add a raw dataset or curated data product (products carry fed_by raw ids).
  createDataAsset: (payload: {
    source_category: string; module: string; description?: string; sub_vertical?: string;
    owning_lob_id?: number | null; tier: 'raw' | 'product'; curate_effort?: string | null; fed_by?: number[];
  }) => fetchJson<any>('/api/data-assets', { method: 'POST', body: JSON.stringify(payload) }),
  setAssetTier: (assetId: number, tier: 'raw' | 'product', curateEffort?: string | null) =>
    fetchJson<{ ok: boolean }>(`/api/data-assets/${assetId}/tier`, { method: 'PATCH', body: JSON.stringify({ tier, curate_effort: curateEffort ?? null }) }),
  setAssetFeeds: (assetId: number, rawAssetIds: number[]) =>
    fetchJson<{ ok: boolean }>(`/api/data-assets/${assetId}/feeds`, { method: 'PUT', body: JSON.stringify({ raw_asset_ids: rawAssetIds }) }),
  standardizeUseCase: (payload: { use_case_id?: number; title?: string; description?: string }) =>
    fetchJson<{ used_llm: boolean; note: string; suggestion: { title: string; description: string; category: string | null; sub_vertical: string; effort_tshirt: string } }>(
      '/api/agents/standardize-use-case', { method: 'POST', body: JSON.stringify(payload) }),
  standardizeAsset: (payload: { module: string; description?: string; source_category?: string; tier?: string }) =>
    fetchJson<{ used_llm: boolean; note: string; suggestion: { module: string; description: string; source_category: string; tier: 'raw' | 'product'; curate_effort: string | null; sub_vertical: string } }>(
      '/api/agents/standardize-asset', { method: 'POST', body: JSON.stringify(payload) }),
};
