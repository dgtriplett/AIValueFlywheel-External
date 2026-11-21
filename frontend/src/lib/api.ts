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


// ---------------------------------------------------------------------------
// Multi-user account context. The active account id is persisted per-browser and
// sent on every request as X-AIVR-Account so the account-scoped backend
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
  return id ? { 'X-AIVR-Account': id } : {};
}

// ---------------------------------------------------------------------------
// Local-first stubs: a few per-browser settings live in localStorage rather than on
// the server. Returns undefined to mean "not a stubbed route — do a real fetch".
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
  const PREFS = 'gc.prefs';
  // No industry packs from the server: the SPA uses its built-in P&U catalog.
  if (url === '/api/industries' || url === '/api/admin/industries') return [];
  if (url === '/api/blend-presets' || url === '/api/admin/blend-presets') return [];
  // Single built-in industry and built-in FX rates: no server round trip (and no 404).
  if (url === '/api/industry') return { id: '', meta: null };
  if (url === '/api/locale/fx-rates') return { json: '' };
  if (url === '/api/my-prefs') {
    if (method === 'PUT') { lsSet(PREFS, body.prefs || {}); return { ok: true }; }
    return lsGet<Record<string, unknown>>(PREFS, {});
  }
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
export interface PortfolioRow {
  id: number; title: string; phase: number | null; status: string;
  readiness: string | null; hypothesized_mm: number; realized_mm: number;
  /** The catalog value model's estimate; `hypothesized_mm` is the roadmap's when it has one. */
  model_mm?: number; value_source?: 'roadmap' | 'model';
  /** From the imported roadmap, when this use case is on it. */
  roadmap?: { pillar_ids: string[]; stage: string | null; workstream: string | null;
    priority_rank: number | null; priority_tier: 'now' | 'next' | 'later' | null;
    value_base_mm: number | null; dropped: boolean } | null;
}
export interface RoadmapMatch {
  external_id: string; name: string; summary: string | null; pillar_ids: string[];
  priority_tier: string | null; value_base: number | null; previously_imported?: boolean;
  candidates: Array<{ use_case_id: number; title: string; score: number; reason: string }>;
  suggestion: { action: 'map' | 'create'; use_case_id: number | null };
}
export interface RoadmapPreview {
  ok: boolean; source: 'deck' | 'package'; warnings: string[];
  roadmap: { id: string; version: string | null; title: string | null; organization: string | null;
    industry: string | null; currency: string; business_unit: string | null; target_executive: string | null };
  generator: { name: string; version: string | null };
  pillars: Array<{ id: string; name: string; description: string | null }>;
  counts: { use_cases: number; pillars: number; suggest_map: number; suggest_create: number; total_value: number };
  matches: RoadmapMatch[];
  diff: { first_import: boolean; added: string[]; removed: string[]; changed: Array<{ id: string; name: string; fields: string[] }> };
  replaces: { roadmap_id: string; title: string | null; imported_at: string } | null;
  industry_note: string | null;
}
/** What is being imported: a roadmap package, or the AITR deck (.html) it comes from. */
export type RoadmapSource = { package: unknown } | { deck_html: string; file_name: string };
export interface RoadmapDecision { external_id: string; action: 'map' | 'create' | 'skip'; use_case_id?: number | null }
export interface RoadmapSummary {
  roadmap: { import_id: string; roadmap_id: string; version: string | null; title: string | null;
    organization: string | null; currency: string; imported_at: string; imported_by: string } | null;
  pillars: Array<{ pillar_id: string; name: string; description: string | null; use_cases: number;
    in_flight: number; live: number; value_base: number; value_live: number }>;
  use_cases: Array<Record<string, any>>;
}
export interface RoadmapUseCase {
  use_case_id: number; external_id: string; name: string | null; summary: string | null;
  business_problem: string | null; kpi: string | null; pillars: Array<{ id: string; name: string }>;
  stage: string | null; workstream: string | null; priority_rank: number | null;
  priority_tier: string | null; effort: string | null; effort_quadrant: string | null;
  value_currency: string | null; value_low: number | null; value_base: number | null; value_high: number | null;
  value_json: { basis?: string | null; formula?: string | null;
    assumptions?: Array<{ label: string; low?: number | null; base?: number | null; high?: number | null;
      unit?: string | null; note?: string | null; source?: string | null }> } | null;
  plan_json: { headline: string | null; pilot: string | null; phases: Array<{ name: string | null; when: string | null;
    title: string | null; summary: string | null; scope: string | null; steps: string[] }> } | null;
  data_needs_json: { datasets?: string[]; assets?: string[]; sources?: string[]; rationale?: string | null } | null;
  dropped_at: string | null;
}
export interface Session {
  email: string | null;
  accounts: AccountRow[];
  active_account_id: number | null;
  is_admin: boolean;
}
export interface ProfileIn {
  name: string; utility_type?: string; slug?: string;
  geography?: string; territory_size?: string; strategic_priorities?: string[];
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
  // Full account creation = company-profile capture (static per customer).
  createAccountFull: (p: ProfileIn) =>
    fetchJson<AccountRow>('/api/accounts', { method: 'POST', body: JSON.stringify(p) }),
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
  operateRoadmap: () => fetchJson<{ account_id: number | null;
    use_cases: PortfolioRow[];
    summary: Record<string, number> }>('/api/operate/roadmap'),

  // --- Roadmap import (a planning tool's roadmap package -> this business unit) ---
  roadmapImportPreview: (src: RoadmapSource) =>
    fetchJson<RoadmapPreview>('/api/roadmap-import/preview', { method: 'POST', body: JSON.stringify(src) }),
  roadmapImportPackage: (src: RoadmapSource) =>
    fetchJson<{ package: unknown; warnings: string[] }>('/api/roadmap-import/package', { method: 'POST', body: JSON.stringify(src) }),
  roadmapImportSuggest: (src: RoadmapSource, externalIds: string[]) =>
    fetchJson<{ suggestions: Array<{ external_id: string; use_case_id: number | null; title: string | null; why: string }>;
      model_used: boolean; message?: string }>('/api/roadmap-import/suggest',
      { method: 'POST', body: JSON.stringify({ ...src, external_ids: externalIds }) }),
  roadmapImportApply: (src: RoadmapSource, decisions: RoadmapDecision[]) =>
    fetchJson<{ ok: boolean; import_id: string; summary: Record<string, any>; use_case_ids: Record<string, number> }>(
      '/api/roadmap-import/apply', { method: 'POST', body: JSON.stringify({ ...src, decisions }) }),
  roadmapSummary: () => fetchJson<RoadmapSummary>('/api/roadmap/summary'),
  roadmapUseCase: (useCaseId: number) => fetchJson<{ roadmap: RoadmapUseCase | null }>(`/api/roadmap/use-cases/${useCaseId}`),

  // --- Explore (shipped catalog map <-> this business unit's portfolio) ---
  explorePortfolio: () => fetchJson<{ account_id: number | null;
    use_cases: Record<string, { use_case_id: number; in_portfolio: boolean; status: string }> }>('/api/explore/portfolio'),
  exploreAdd: (catalogIds: string[]) =>
    fetchJson<{ added: number; use_case_ids: Record<string, number>; unresolved: string[] }>(
      '/api/explore/portfolio', { method: 'POST', body: JSON.stringify({ catalog_ids: catalogIds }) }),
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
  // Data assets (per-account ingestion status overlaid)
  dataAssets: () => fetchJson<any[]>('/api/data-assets'),
  // Correct a module's per-account ingestion status (stamps source='manual')
  setAssetStatus: (assetId: number, ingestion_status: string) =>
    fetchJson<any>(`/api/data-assets/${assetId}/status`, {
      method: 'PATCH', body: JSON.stringify({ ingestion_status }) }),
  whatifSimulate: (assetIds: number[]) =>
    fetchJson<any>('/api/whatif/simulate', { method: 'POST', body: JSON.stringify({ data_asset_ids: assetIds }) }),

  // --- Admin (cross-account; admins only) ---
  adminOverview: () => fetchJson<{ accounts: any[]; users: any[]; admins: string[]; totals: any }>('/api/admin/overview'),
  myFeatureFlags: () => fetchJson<Record<string, boolean>>('/api/feature-flags'),
  /** LEGACY single-industry endpoint. Newer code uses `industries()` below. */
  activeIndustry: () => fetchJson<{ id: string; meta: any }>('/api/industry'),

  /** All enabled industries available in this workspace. Drives the wizard's
   *  industry picker and populates the active-industry cache. */
  industries: () => fetchJson<Array<any>>('/api/industries'),

  /** Named blend presets — saved compositions of industry packs. Available
   *  to all users in the wizard + roadmap picker; admin-managed. */
  blendPresets: () => fetchJson<Array<{
    id: string; label: string; description: string;
    industryIds: string[]; sortOrder: number;
  }>>('/api/blend-presets'),

  fxRates: () => fetchJson<{ json: string }>('/api/locale/fx-rates'),

  // Custom assumption fields — admin-managed catalog that supplements the
  // built-in BusinessAssumptions list in the Quantified Annual Value editor.
  assumptionFields: () => fetchJson<Array<{
    key: string; label: string; unit: string;
    defaultValue: number; step: number; min: number; max: number;
    category: string; relevantFor: string[]; enabled: boolean;
    updatedAt?: string; updatedBy?: string;
  }>>('/api/assumption-fields'),
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

  // Admin — feature flags
  adminListFeatureFlags: () => fetchJson<FeatureFlagAdminRow[]>('/api/admin/feature-flags'),
  adminUpdateFeatureFlag: (key: string, state: FeatureFlagState) =>
    fetchJson<{ ok: boolean }>(`/api/admin/feature-flags/${encodeURIComponent(key)}`, {
      method: 'PUT', body: JSON.stringify({ state }),
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

  // User preferences (assumptions defaults, etc.)
  getMyPrefs: () => fetchJson<Record<string, unknown>>('/api/my-prefs'),
  putMyPrefs: (prefs: Record<string, unknown>) =>
    fetchJson<{ ok: boolean }>('/api/my-prefs', {
      method: 'PUT', body: JSON.stringify({ prefs }),
    }),
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
    title?: string; description?: string | null; hypothesized_value_json?: any; reset_roadmap_value?: boolean;
  }) => fetchJson<any>(`/api/use-cases/${encodeURIComponent(String(id))}`, {
    method: 'PATCH', body: JSON.stringify(payload),
  }),
  // Agentic value estimate: returns { value_model, used_llm, fallback_note }.
  estimateValue: (id: number) => fetchJson<any>('/api/agents/estimate-value', {
    method: 'POST', body: JSON.stringify({ use_case_id: id }),
  }),
  adminAddAdmin: (email: string) =>
    fetchJson<{ ok: boolean }>('/api/admin/admins', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  adminRemoveAdmin: (email: string) =>
    fetchJson<{ ok: boolean }>(`/api/admin/admins/${encodeURIComponent(email)}`, {
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

  // --- Discovery / ingestion pipeline (customer-side) ----------------------
  setupStatus: () => fetchJson<{ ready: boolean; checks: Array<{
    name: string; ok: boolean; label: string; detail: string; required: boolean;
    fix?: string | null; grants: string[] }> }>('/api/setup/status'),
  setupGrants: () => fetchJson<{ service_principal: string; sql: string }>('/api/setup/grants'),
  setupRecheck: () => fetchJson<any>('/api/setup/recheck', { method: 'POST', body: '{}' }),
  extractorInfo: () => fetchJson<{ available: boolean; files: string[]; total_bytes: number;
    requires: string[]; reads: string; produces: string[] }>('/api/ingestion/extractor/info'),
  ingestionSummary: () => fetchJson<any>('/api/ingestion/summary'),
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
  chatSend: (message: string, conversationId?: string) =>
    fetchJson<{ conversation_id: string; answer: string; tools_used: any[]; confirm: any; note?: string }>(
      '/api/chat', { method: 'POST', body: JSON.stringify({ message, conversation_id: conversationId || null }) }),

  // --- Value-assumptions calibration (per-customer) ------------------------
  listValueAssumptions: () => fetchJson<any[]>('/api/value-assumptions'),
  updateValueAssumption: (key: string, value: number) =>
    fetchJson<any>(`/api/value-assumptions/${encodeURIComponent(key)}`,
      { method: 'PUT', body: JSON.stringify({ value }) }),
  researchCompany: (companyName: string) =>
    fetchJson<any>('/api/research/company',
      { method: 'POST', body: JSON.stringify({ company_name: companyName, calibrate_assumptions: true, propose_lobs: false }) }),
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
