-- AI Value Flywheel — Postgres (Lakebase) baseline schema.
--
-- The complete app-state schema for a fresh install, applied once by the setup job
-- (server/migrator.py records it in schema_migrations). Later schema changes are new
-- numbered files (002_*.sql, …) — never edits to this one — with a matching file in
-- server/migrations_delta/ and a regenerated server/storage/schema_meta.json
-- (scripts/gen_delta_schema.py).

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE TABLE public.account_assessments (
    id text NOT NULL,
    account_id integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    label text,
    answers_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    results_json jsonb,
    overall_score integer,
    current_phase integer,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    submitted_at timestamp with time zone,
    CONSTRAINT account_assessments_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text])))
);

CREATE TABLE public.account_asset_status (
    account_id integer NOT NULL,
    data_asset_id integer NOT NULL,
    ingestion_status text DEFAULT 'not_started'::text NOT NULL,
    local_name text,
    owning_lob_id integer,
    ingest_cost_low numeric,
    ingest_cost_high numeric,
    notes text,
    is_user_edited boolean DEFAULT false NOT NULL,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    CONSTRAINT account_asset_status_source_check CHECK ((source = ANY (ARRAY['survey'::text, 'discovered'::text, 'manual'::text, 'promote'::text])))
);

CREATE TABLE public.account_members (
    account_id integer NOT NULL,
    user_email text NOT NULL,
    role text DEFAULT 'owner'::text NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    added_by text,
    CONSTRAINT account_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'editor'::text, 'viewer'::text])))
);

CREATE TABLE public.account_portfolio_use_cases (
    account_id integer NOT NULL,
    use_case_id integer NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.account_promotions (
    id text NOT NULL,
    account_id integer NOT NULL,
    assessment_id text,
    summary_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.account_source_status (
    account_id integer NOT NULL,
    data_source_id text NOT NULL,
    available boolean DEFAULT false NOT NULL,
    source text DEFAULT 'survey'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text,
    CONSTRAINT account_source_status_source_check CHECK ((source = ANY (ARRAY['survey'::text, 'manual'::text, 'promote'::text])))
);

CREATE TABLE public.accounts (
    id integer NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    utility_type text,
    is_active boolean DEFAULT true NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    notes text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    geography text,
    territory_size text,
    strategic_priorities text[] DEFAULT '{}'::text[] NOT NULL,
    profile_complete boolean DEFAULT false NOT NULL
);

CREATE SEQUENCE public.accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.accounts_id_seq OWNED BY public.accounts.id;

CREATE TABLE public.admins (
    user_email text NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    added_by text
);

CREATE TABLE public.artifacts (
    id integer NOT NULL,
    artifact_type text NOT NULL,
    workspace_id text,
    artifact_id text,
    name text NOT NULL,
    owner text,
    description text,
    ai_description text,
    uc_catalog text,
    uc_schema text,
    last_modified timestamp with time zone,
    last_run timestamp with time zone,
    run_count_30d integer,
    status text,
    use_case_id integer,
    lob_id integer,
    mapped_by text,
    is_user_edited boolean DEFAULT false NOT NULL,
    is_present boolean DEFAULT true NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artifacts_artifact_type_check CHECK ((artifact_type = ANY (ARRAY['dashboard'::text, 'model'::text, 'serving_endpoint'::text, 'job'::text, 'pipeline'::text, 'query'::text, 'genie_space'::text, 'notebook'::text, 'alert'::text]))),
    CONSTRAINT artifacts_mapped_by_check CHECK ((mapped_by = ANY (ARRAY['manual'::text, 'llm'::text, 'lineage'::text])))
);

CREATE SEQUENCE public.artifacts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.artifacts_id_seq OWNED BY public.artifacts.id;

CREATE TABLE public.asset_feeds (
    product_asset_id integer NOT NULL,
    raw_asset_id integer NOT NULL,
    mapped_by text DEFAULT 'catalog'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT asset_feeds_check CHECK ((product_asset_id <> raw_asset_id)),
    CONSTRAINT asset_feeds_mapped_by_check CHECK ((mapped_by = ANY (ARRAY['catalog'::text, 'auto'::text, 'manual'::text])))
);

CREATE TABLE public.asset_serves_domain (
    data_asset_id integer NOT NULL,
    domain_id integer NOT NULL,
    confidence text DEFAULT 'high'::text NOT NULL,
    mapped_by text DEFAULT 'catalog'::text NOT NULL,
    notes text,
    is_user_edited boolean DEFAULT false NOT NULL,
    mapped_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT asset_serves_domain_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT asset_serves_domain_mapped_by_check CHECK ((mapped_by = ANY (ARRAY['catalog'::text, 'llm'::text, 'manual'::text])))
);

CREATE TABLE public.data_assets (
    id integer NOT NULL,
    source_category text,
    vendor text,
    source_system text NOT NULL,
    module text NOT NULL,
    description text,
    sub_vertical text,
    ingestion_status text DEFAULT 'not_started'::text NOT NULL,
    ingest_effort text,
    ingest_cost_low numeric,
    ingest_cost_high numeric,
    uc_catalog text,
    uc_schema text,
    owning_lob_id integer,
    origin text DEFAULT 'custom'::text NOT NULL,
    auto_captured boolean DEFAULT false NOT NULL,
    auto_note text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    discovered_table_count integer DEFAULT 0 NOT NULL,
    discovery_confidence text,
    last_discovered_at timestamp with time zone,
    tier text DEFAULT 'raw'::text NOT NULL,
    curate_effort text,
    CONSTRAINT data_assets_curate_effort_check CHECK ((curate_effort = ANY (ARRAY['S'::text, 'M'::text, 'L'::text, 'XL'::text]))),
    CONSTRAINT data_assets_ingest_effort_check CHECK ((ingest_effort = ANY (ARRAY['S'::text, 'M'::text, 'L'::text, 'XL'::text]))),
    CONSTRAINT data_assets_ingestion_status_check CHECK ((ingestion_status = ANY (ARRAY['not_started'::text, 'landed'::text, 'curated'::text, 'governed'::text]))),
    CONSTRAINT data_assets_origin_check CHECK ((origin = ANY (ARRAY['catalog'::text, 'auto'::text, 'custom'::text]))),
    CONSTRAINT data_assets_tier_check CHECK ((tier = ANY (ARRAY['raw'::text, 'product'::text])))
);

CREATE VIEW public.asset_status_by_account AS
 SELECT a.id AS account_id,
    da.id AS data_asset_id,
    COALESCE(s.ingestion_status, 'not_started'::text) AS ingestion_status,
    COALESCE(s.local_name, da.module) AS display_name,
    COALESCE(s.owning_lob_id, da.owning_lob_id) AS owning_lob_id,
    COALESCE(s.ingest_cost_low, da.ingest_cost_low) AS ingest_cost_low,
    COALESCE(s.ingest_cost_high, da.ingest_cost_high) AS ingest_cost_high,
    COALESCE(s.is_user_edited, false) AS is_user_edited,
    (s.account_id IS NOT NULL) AS has_account_row
   FROM ((public.accounts a
     CROSS JOIN public.data_assets da)
     LEFT JOIN public.account_asset_status s ON (((s.account_id = a.id) AND (s.data_asset_id = da.id))));

CREATE TABLE public.asset_taxonomy (
    id integer NOT NULL,
    data_asset_id integer NOT NULL,
    dimension text NOT NULL,
    value text NOT NULL,
    source text DEFAULT 'ai'::text NOT NULL,
    confidence numeric,
    ai_reasoning text,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_to timestamp with time zone,
    created_by text,
    CONSTRAINT asset_taxonomy_dimension_check CHECK ((dimension = ANY (ARRAY['integration_pattern'::text, 'criticality'::text, 'vendor_type'::text]))),
    CONSTRAINT asset_taxonomy_source_check CHECK ((source = ANY (ARRAY['ai'::text, 'manual'::text, 'catalog'::text])))
);

CREATE SEQUENCE public.asset_taxonomy_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.asset_taxonomy_id_seq OWNED BY public.asset_taxonomy.id;

CREATE TABLE public.assumption_research (
    id integer NOT NULL,
    key text NOT NULL,
    value_before numeric,
    value_proposed numeric,
    confidence text,
    rationale text,
    basis text,
    applied boolean DEFAULT false NOT NULL,
    applied_at timestamp with time zone,
    research_run integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id integer NOT NULL,
    CONSTRAINT assumption_research_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])))
);

CREATE SEQUENCE public.assumption_research_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.assumption_research_id_seq OWNED BY public.assumption_research.id;

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    entity_type text NOT NULL,
    entity_id integer,
    action text NOT NULL,
    actor text,
    diff_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;

CREATE TABLE public.benchmark_library (
    id integer NOT NULL,
    use_case_pattern text NOT NULL,
    sub_vertical text,
    metric_type text,
    low numeric,
    mid numeric,
    high numeric,
    unit text,
    notes text
);

CREATE SEQUENCE public.benchmark_library_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.benchmark_library_id_seq OWNED BY public.benchmark_library.id;

CREATE TABLE public.branding (
    id integer DEFAULT 1 NOT NULL,
    display_name text,
    subtitle text,
    accent_color text,
    logo_bytes bytea,
    logo_mime text,
    logo_filename text,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id integer
);

CREATE TABLE public.chat_conversations (
    id text NOT NULL,
    title text,
    actor text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id integer NOT NULL
);

CREATE TABLE public.chat_messages (
    id integer NOT NULL,
    conversation_id text NOT NULL,
    role text NOT NULL,
    content text,
    tool_name text,
    tool_args_json jsonb,
    tool_result_json jsonb,
    confirm_token text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'tool'::text])))
);

CREATE SEQUENCE public.chat_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages.id;

CREATE TABLE public.classification_rules (
    id integer NOT NULL,
    dimension text NOT NULL,
    field text NOT NULL,
    match_type text NOT NULL,
    pattern text NOT NULL,
    case_sensitive boolean DEFAULT false NOT NULL,
    value text,
    priority integer DEFAULT 100 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    origin text DEFAULT 'manual'::text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classification_rules_dimension_check CHECK ((dimension = ANY (ARRAY['environment'::text, 'lob'::text, 'source_category'::text, 'zone'::text, 'ignore'::text]))),
    CONSTRAINT classification_rules_field_check CHECK ((field = ANY (ARRAY['catalog_name'::text, 'schema_name'::text, 'table_name'::text, 'owner'::text, 'comment'::text]))),
    CONSTRAINT classification_rules_match_type_check CHECK ((match_type = ANY (ARRAY['equals'::text, 'prefix'::text, 'suffix'::text, 'contains'::text, 'regex'::text]))),
    CONSTRAINT classification_rules_origin_check CHECK ((origin = ANY (ARRAY['seed'::text, 'manual'::text, 'llm'::text])))
);

CREATE SEQUENCE public.classification_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.classification_rules_id_seq OWNED BY public.classification_rules.id;

CREATE TABLE public.comments (
    id integer NOT NULL,
    entity_type text NOT NULL,
    entity_id integer NOT NULL,
    body text NOT NULL,
    author text,
    mentions text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id integer NOT NULL
);

CREATE SEQUENCE public.comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.comments_id_seq OWNED BY public.comments.id;

CREATE TABLE public.company_profile (
    id integer DEFAULT 1 NOT NULL,
    company_name text NOT NULL,
    utility_type text,
    segments text[] DEFAULT '{}'::text[],
    service_territory text,
    regulator text,
    iso_rto text,
    description text,
    research_notes text,
    researched_at timestamp with time zone,
    researched_by text,
    model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id integer
);

CREATE TABLE public.confirm_tokens (
    token text NOT NULL,
    intent text NOT NULL,
    payload_json jsonb NOT NULL,
    before_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    after_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    summary text,
    actor text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    consumed_by text
);

CREATE TABLE public.data_asset_aliases (
    id integer NOT NULL,
    raw text NOT NULL,
    raw_normalized text NOT NULL,
    canonical text,
    mapped_by text NOT NULL,
    confidence text,
    notes text,
    is_user_edited boolean DEFAULT false NOT NULL,
    mapped_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT data_asset_aliases_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT data_asset_aliases_mapped_by_check CHECK ((mapped_by = ANY (ARRAY['seed'::text, 'exact'::text, 'normalized'::text, 'llm'::text, 'manual'::text, 'fallback_other'::text])))
);

CREATE SEQUENCE public.data_asset_aliases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.data_asset_aliases_id_seq OWNED BY public.data_asset_aliases.id;

CREATE TABLE public.data_asset_lobs (
    data_asset_id integer NOT NULL,
    lob_id integer NOT NULL
);

CREATE SEQUENCE public.data_assets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.data_assets_id_seq OWNED BY public.data_assets.id;

CREATE TABLE public.data_domains (
    id integer NOT NULL,
    name text NOT NULL,
    label text NOT NULL,
    description text,
    category text,
    example_attributes text,
    is_active boolean DEFAULT true NOT NULL,
    origin text DEFAULT 'custom'::text NOT NULL,
    is_user_edited boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT data_domains_category_check CHECK ((category = ANY (ARRAY['operational'::text, 'asset'::text, 'customer'::text, 'grid'::text, 'market'::text, 'financial'::text, 'regulatory'::text, 'safety'::text, 'external'::text, 'workforce'::text]))),
    CONSTRAINT data_domains_origin_check CHECK ((origin = ANY (ARRAY['catalog'::text, 'auto'::text, 'custom'::text])))
);

CREATE SEQUENCE public.data_domains_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.data_domains_id_seq OWNED BY public.data_domains.id;

CREATE TABLE public.data_source_domains (
    data_source_id text NOT NULL,
    domain_id integer NOT NULL
);

CREATE TABLE public.data_source_rollup (
    data_asset_id integer NOT NULL,
    data_source_id text NOT NULL,
    mapped_by text DEFAULT 'catalog'::text NOT NULL,
    CONSTRAINT data_source_rollup_mapped_by_check CHECK ((mapped_by = ANY (ARRAY['catalog'::text, 'manual'::text])))
);

CREATE TABLE public.data_sources (
    id text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    description text,
    utility_types text[] DEFAULT '{}'::text[] NOT NULL,
    match_terms text[] DEFAULT '{}'::text[] NOT NULL,
    sort_order integer,
    is_active boolean DEFAULT true NOT NULL,
    origin text DEFAULT 'catalog'::text NOT NULL,
    CONSTRAINT data_sources_origin_check CHECK ((origin = ANY (ARRAY['catalog'::text, 'custom'::text])))
);

CREATE TABLE public.discovered_schemas (
    id integer NOT NULL,
    workspace_id text NOT NULL,
    workspace_url text,
    catalog_name text NOT NULL,
    schema_name text NOT NULL,
    owner text,
    comment text,
    table_count integer DEFAULT 0 NOT NULL,
    source_created_at timestamp with time zone,
    source_altered_at timestamp with time zone,
    business_name text,
    ai_definition text,
    ai_confidence numeric,
    is_user_edited boolean DEFAULT false NOT NULL,
    is_present boolean DEFAULT true NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.discovered_schemas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.discovered_schemas_id_seq OWNED BY public.discovered_schemas.id;

CREATE TABLE public.discovered_tables (
    id integer NOT NULL,
    workspace_id text NOT NULL,
    catalog_name text NOT NULL,
    schema_name text NOT NULL,
    table_name text NOT NULL,
    table_type text,
    data_format text,
    owner text,
    comment text,
    column_summary text,
    column_count integer,
    source_created_at timestamp with time zone,
    source_altered_at timestamp with time zone,
    business_name text,
    ai_definition text,
    source_system_raw text,
    source_system_canonical text,
    canonical_confidence text,
    data_asset_id integer,
    mapped_by text,
    is_user_edited boolean DEFAULT false NOT NULL,
    is_present boolean DEFAULT true NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT discovered_tables_canonical_confidence_check CHECK ((canonical_confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT discovered_tables_mapped_by_check CHECK ((mapped_by = ANY (ARRAY['exact'::text, 'normalized'::text, 'llm'::text, 'manual'::text, 'lineage'::text])))
);

CREATE SEQUENCE public.discovered_tables_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.discovered_tables_id_seq OWNED BY public.discovered_tables.id;

CREATE TABLE public.external_object_map (
    account_id integer NOT NULL,
    source_app text NOT NULL,
    source_object_type text NOT NULL,
    source_object_id text NOT NULL,
    local_object_type text NOT NULL,
    local_object_id text NOT NULL,
    source_hash text,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    imported_by text
);

CREATE TABLE public.feature_flags (
    key text NOT NULL,
    label text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    category text DEFAULT 'Beta'::text NOT NULL,
    state text DEFAULT 'off'::text NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text,
    CONSTRAINT feature_flags_state_check CHECK ((state = ANY (ARRAY['off'::text, 'admin'::text, 'on'::text])))
);

CREATE TABLE public.funding_requests (
    id integer NOT NULL,
    data_asset_id integer NOT NULL,
    requesting_lob_id integer,
    co_funding_lobs integer[] DEFAULT '{}'::integer[],
    combined_value numeric,
    status text DEFAULT 'proposed'::text,
    sponsor text,
    cost_share_json jsonb,
    brief_md text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id integer NOT NULL,
    CONSTRAINT funding_requests_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'committed'::text, 'funded'::text, 'declined'::text])))
);

CREATE SEQUENCE public.funding_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.funding_requests_id_seq OWNED BY public.funding_requests.id;

CREATE TABLE public.glossary_terms (
    id integer NOT NULL,
    term text NOT NULL,
    definition text,
    domain_id integer,
    lob_id integer,
    synonyms text[] DEFAULT '{}'::text[],
    source_systems text[] DEFAULT '{}'::text[],
    owner text,
    origin text DEFAULT 'manual'::text NOT NULL,
    is_user_edited boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id integer,
    CONSTRAINT glossary_terms_origin_check CHECK ((origin = ANY (ARRAY['catalog'::text, 'derived'::text, 'llm'::text, 'manual'::text])))
);

CREATE SEQUENCE public.glossary_terms_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.glossary_terms_id_seq OWNED BY public.glossary_terms.id;

CREATE TABLE public.ingestion_runs (
    id integer NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    stats_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    error text,
    actor text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT ingestion_runs_kind_check CHECK ((kind = ANY (ARRAY['inventory_upload'::text, 'ai_enrichment'::text, 'canonicalization'::text, 'taxonomy'::text, 'asset_mapping'::text, 'lineage_sync'::text]))),
    CONSTRAINT ingestion_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text, 'partial'::text])))
);

CREATE SEQUENCE public.ingestion_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.ingestion_runs_id_seq OWNED BY public.ingestion_runs.id;

CREATE TABLE public.kb_article_versions (
    id integer NOT NULL,
    article_id integer NOT NULL,
    version integer NOT NULL,
    title text NOT NULL,
    body_md text NOT NULL,
    summary text,
    change_note text,
    edited_by text,
    edited_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.kb_article_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.kb_article_versions_id_seq OWNED BY public.kb_article_versions.id;

CREATE TABLE public.kb_articles (
    id integer NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    folder_id integer,
    body_md text DEFAULT ''::text NOT NULL,
    summary text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    generated_by text,
    version integer DEFAULT 1 NOT NULL,
    created_by text,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_tsv tsvector GENERATED ALWAYS AS (((setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(summary, ''::text)), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(body_md, ''::text)), 'C'::"char"))) STORED,
    account_id integer,
    CONSTRAINT kb_articles_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))
);

CREATE SEQUENCE public.kb_articles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.kb_articles_id_seq OWNED BY public.kb_articles.id;

CREATE TABLE public.kb_attachments (
    id integer NOT NULL,
    article_id integer NOT NULL,
    filename text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    storage text NOT NULL,
    volume_path text,
    content bytea,
    checksum text,
    uploaded_by text,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_attachments_storage_check CHECK ((storage = ANY (ARRAY['volume'::text, 'lakebase'::text]))),
    CONSTRAINT kb_attachments_storage_consistent CHECK ((((storage = 'volume'::text) AND (volume_path IS NOT NULL) AND (content IS NULL)) OR ((storage = 'lakebase'::text) AND (content IS NOT NULL) AND (volume_path IS NULL))))
);

CREATE SEQUENCE public.kb_attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.kb_attachments_id_seq OWNED BY public.kb_attachments.id;

CREATE TABLE public.kb_folders (
    id integer NOT NULL,
    name text NOT NULL,
    parent_id integer,
    path text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id integer
);

CREATE SEQUENCE public.kb_folders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.kb_folders_id_seq OWNED BY public.kb_folders.id;

CREATE TABLE public.kb_links (
    id integer NOT NULL,
    article_id integer NOT NULL,
    entity_type text NOT NULL,
    entity_id integer NOT NULL,
    relation text DEFAULT 'related'::text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_links_entity_type_check CHECK ((entity_type = ANY (ARRAY['use_case'::text, 'data_asset'::text, 'data_domain'::text, 'lob'::text, 'roadmap_item'::text, 'funding_request'::text]))),
    CONSTRAINT kb_links_relation_check CHECK ((relation = ANY (ARRAY['explains'::text, 'standard'::text, 'proposal'::text, 'evidence'::text, 'related'::text])))
);

CREATE SEQUENCE public.kb_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.kb_links_id_seq OWNED BY public.kb_links.id;

CREATE TABLE public.linked_databricks_assets (
    id integer NOT NULL,
    use_case_id integer NOT NULL,
    asset_type text,
    asset_id text,
    asset_name text,
    CONSTRAINT linked_databricks_assets_asset_type_check CHECK ((asset_type = ANY (ARRAY['job'::text, 'pipeline'::text, 'model'::text, 'dashboard'::text])))
);

CREATE SEQUENCE public.linked_databricks_assets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.linked_databricks_assets_id_seq OWNED BY public.linked_databricks_assets.id;

CREATE TABLE public.lobs (
    id integer NOT NULL,
    name text NOT NULL,
    description text
);

CREATE SEQUENCE public.lobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.lobs_id_seq OWNED BY public.lobs.id;

CREATE TABLE public.research_runs (
    id integer NOT NULL,
    company_name text NOT NULL,
    scope text[] DEFAULT '{}'::text[],
    status text DEFAULT 'running'::text NOT NULL,
    stats_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    warnings text[] DEFAULT '{}'::text[],
    model text,
    used_llm boolean DEFAULT false NOT NULL,
    error text,
    actor text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    account_id integer NOT NULL,
    CONSTRAINT research_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text, 'partial'::text])))
);

CREATE SEQUENCE public.research_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.research_runs_id_seq OWNED BY public.research_runs.id;

CREATE TABLE public.roadmap_items (
    id integer NOT NULL,
    use_case_id integer NOT NULL,
    horizon text,
    wave integer,
    target_date date,
    completion_date date,
    notes text,
    account_id integer NOT NULL,
    CONSTRAINT roadmap_items_horizon_check CHECK ((horizon = ANY (ARRAY['now'::text, 'next'::text, 'later'::text])))
);

CREATE SEQUENCE public.roadmap_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.roadmap_items_id_seq OWNED BY public.roadmap_items.id;

CREATE TABLE public.uc_enables_uc (
    from_use_case_id integer NOT NULL,
    to_use_case_id integer NOT NULL,
    detected_by_agent boolean DEFAULT false NOT NULL,
    rationale text,
    CONSTRAINT uc_enables_uc_check CHECK ((from_use_case_id <> to_use_case_id))
);

CREATE TABLE public.uc_requires_asset (
    use_case_id integer NOT NULL,
    data_asset_id integer NOT NULL,
    criticality text DEFAULT 'required'::text NOT NULL,
    manual boolean DEFAULT false NOT NULL,
    CONSTRAINT uc_requires_asset_criticality_check CHECK ((criticality = ANY (ARRAY['required'::text, 'helpful'::text])))
);

CREATE TABLE public.uc_requires_domain (
    use_case_id integer NOT NULL,
    domain_id integer NOT NULL,
    necessity text DEFAULT 'required'::text NOT NULL,
    rationale text,
    mapped_by text DEFAULT 'catalog'::text NOT NULL,
    manual boolean DEFAULT false NOT NULL,
    mapped_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uc_requires_domain_mapped_by_check CHECK ((mapped_by = ANY (ARRAY['catalog'::text, 'generation'::text, 'extraction'::text, 'manual'::text]))),
    CONSTRAINT uc_requires_domain_necessity_check CHECK ((necessity = ANY (ARRAY['required'::text, 'helpful'::text])))
);

CREATE TABLE public.use_cases (
    id integer NOT NULL,
    title text NOT NULL,
    description text,
    lob_id integer,
    sub_vertical text,
    stage text,
    phase integer,
    status text DEFAULT 'not_started'::text NOT NULL,
    category text,
    effort_tshirt text,
    priority_score numeric,
    risk_tags text[] DEFAULT '{}'::text[],
    compliance_tags text[] DEFAULT '{}'::text[],
    hypothesized_value_json jsonb,
    realized_value_amount numeric,
    realized_value_json jsonb,
    realized_override_enabled boolean DEFAULT false NOT NULL,
    realized_override_amount numeric,
    realized_override_note text,
    status_source text DEFAULT 'manual'::text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    requires_locked boolean DEFAULT false NOT NULL,
    origin text DEFAULT 'custom'::text NOT NULL,
    in_portfolio boolean DEFAULT true NOT NULL,
    domains_locked boolean DEFAULT false NOT NULL,
    generated_from_preview text,
    generation_lens text,
    CONSTRAINT use_cases_effort_tshirt_check CHECK ((effort_tshirt = ANY (ARRAY['S'::text, 'M'::text, 'L'::text, 'XL'::text]))),
    CONSTRAINT use_cases_origin_check CHECK ((origin = ANY (ARRAY['catalog'::text, 'custom'::text, 'auto'::text]))),
    CONSTRAINT use_cases_phase_check CHECK (((phase >= 0) AND (phase <= 4))),
    CONSTRAINT use_cases_stage_check CHECK ((stage = ANY (ARRAY['U1'::text, 'U2'::text, 'U3'::text, 'U4'::text, 'U5'::text, 'U6'::text]))),
    CONSTRAINT use_cases_status_check CHECK ((status = ANY (ARRAY['not_started'::text, 'scoping'::text, 'in_progress'::text, 'live'::text, 'value_realized'::text]))),
    CONSTRAINT use_cases_status_source_check CHECK ((status_source = ANY (ARRAY['manual'::text, 'auto'::text]))),
    CONSTRAINT use_cases_sub_vertical_check CHECK ((sub_vertical = ANY (ARRAY['fossil'::text, 'hydro'::text, 'renewables'::text, 'nuclear'::text, 'cross'::text])))
);

CREATE SEQUENCE public.use_cases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.use_cases_id_seq OWNED BY public.use_cases.id;

CREATE TABLE public.user_active_account (
    user_email text NOT NULL,
    account_id integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.value_assumptions (
    id integer NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    value numeric NOT NULL,
    unit text,
    category text,
    description text,
    source text DEFAULT 'default'::text NOT NULL,
    source_note text,
    confidence text,
    updated_at timestamp with time zone,
    account_id integer
);

CREATE SEQUENCE public.value_assumptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.value_assumptions_id_seq OWNED BY public.value_assumptions.id;

CREATE TABLE public.value_records (
    id integer NOT NULL,
    use_case_id integer NOT NULL,
    kind text NOT NULL,
    metric_type text,
    amount numeric,
    unit text,
    fiscal_period text,
    confidence text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id integer NOT NULL,
    CONSTRAINT value_records_confidence_check CHECK ((confidence = ANY (ARRAY['low'::text, 'med'::text, 'high'::text]))),
    CONSTRAINT value_records_kind_check CHECK ((kind = ANY (ARRAY['hypothesized'::text, 'realized'::text])))
);

CREATE SEQUENCE public.value_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.value_records_id_seq OWNED BY public.value_records.id;

CREATE TABLE public.value_snapshots (
    id integer NOT NULL,
    account_id integer,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text DEFAULT 'manual'::text NOT NULL,
    detail text,
    captured_by text,
    total_value_mm numeric,
    buildable_value_mm numeric,
    realized_value_mm numeric,
    shovel_ready integer,
    nearly_ready integer,
    awaiting_prereqs integer,
    blocked integer,
    sources_total integer,
    sources_ready integer,
    domains_total integer,
    domains_satisfied integer,
    use_cases_total integer,
    use_cases_live integer,
    metrics_json jsonb,
    captured_minute timestamp without time zone GENERATED ALWAYS AS (date_trunc('minute'::text, (captured_at AT TIME ZONE 'UTC'::text))) STORED
);

CREATE SEQUENCE public.value_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.value_snapshots_id_seq OWNED BY public.value_snapshots.id;

ALTER TABLE ONLY public.accounts ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);

ALTER TABLE ONLY public.artifacts ALTER COLUMN id SET DEFAULT nextval('public.artifacts_id_seq'::regclass);

ALTER TABLE ONLY public.asset_taxonomy ALTER COLUMN id SET DEFAULT nextval('public.asset_taxonomy_id_seq'::regclass);

ALTER TABLE ONLY public.assumption_research ALTER COLUMN id SET DEFAULT nextval('public.assumption_research_id_seq'::regclass);

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);

ALTER TABLE ONLY public.benchmark_library ALTER COLUMN id SET DEFAULT nextval('public.benchmark_library_id_seq'::regclass);

ALTER TABLE ONLY public.chat_messages ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);

ALTER TABLE ONLY public.classification_rules ALTER COLUMN id SET DEFAULT nextval('public.classification_rules_id_seq'::regclass);

ALTER TABLE ONLY public.comments ALTER COLUMN id SET DEFAULT nextval('public.comments_id_seq'::regclass);

ALTER TABLE ONLY public.data_asset_aliases ALTER COLUMN id SET DEFAULT nextval('public.data_asset_aliases_id_seq'::regclass);

ALTER TABLE ONLY public.data_assets ALTER COLUMN id SET DEFAULT nextval('public.data_assets_id_seq'::regclass);

ALTER TABLE ONLY public.data_domains ALTER COLUMN id SET DEFAULT nextval('public.data_domains_id_seq'::regclass);

ALTER TABLE ONLY public.discovered_schemas ALTER COLUMN id SET DEFAULT nextval('public.discovered_schemas_id_seq'::regclass);

ALTER TABLE ONLY public.discovered_tables ALTER COLUMN id SET DEFAULT nextval('public.discovered_tables_id_seq'::regclass);

ALTER TABLE ONLY public.funding_requests ALTER COLUMN id SET DEFAULT nextval('public.funding_requests_id_seq'::regclass);

ALTER TABLE ONLY public.glossary_terms ALTER COLUMN id SET DEFAULT nextval('public.glossary_terms_id_seq'::regclass);

ALTER TABLE ONLY public.ingestion_runs ALTER COLUMN id SET DEFAULT nextval('public.ingestion_runs_id_seq'::regclass);

ALTER TABLE ONLY public.kb_article_versions ALTER COLUMN id SET DEFAULT nextval('public.kb_article_versions_id_seq'::regclass);

ALTER TABLE ONLY public.kb_articles ALTER COLUMN id SET DEFAULT nextval('public.kb_articles_id_seq'::regclass);

ALTER TABLE ONLY public.kb_attachments ALTER COLUMN id SET DEFAULT nextval('public.kb_attachments_id_seq'::regclass);

ALTER TABLE ONLY public.kb_folders ALTER COLUMN id SET DEFAULT nextval('public.kb_folders_id_seq'::regclass);

ALTER TABLE ONLY public.kb_links ALTER COLUMN id SET DEFAULT nextval('public.kb_links_id_seq'::regclass);

ALTER TABLE ONLY public.linked_databricks_assets ALTER COLUMN id SET DEFAULT nextval('public.linked_databricks_assets_id_seq'::regclass);

ALTER TABLE ONLY public.lobs ALTER COLUMN id SET DEFAULT nextval('public.lobs_id_seq'::regclass);

ALTER TABLE ONLY public.research_runs ALTER COLUMN id SET DEFAULT nextval('public.research_runs_id_seq'::regclass);

ALTER TABLE ONLY public.roadmap_items ALTER COLUMN id SET DEFAULT nextval('public.roadmap_items_id_seq'::regclass);

ALTER TABLE ONLY public.use_cases ALTER COLUMN id SET DEFAULT nextval('public.use_cases_id_seq'::regclass);

ALTER TABLE ONLY public.value_assumptions ALTER COLUMN id SET DEFAULT nextval('public.value_assumptions_id_seq'::regclass);

ALTER TABLE ONLY public.value_records ALTER COLUMN id SET DEFAULT nextval('public.value_records_id_seq'::regclass);

ALTER TABLE ONLY public.value_snapshots ALTER COLUMN id SET DEFAULT nextval('public.value_snapshots_id_seq'::regclass);

ALTER TABLE ONLY public.account_assessments
    ADD CONSTRAINT account_assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.account_asset_status
    ADD CONSTRAINT account_asset_status_pkey PRIMARY KEY (account_id, data_asset_id);

ALTER TABLE ONLY public.account_members
    ADD CONSTRAINT account_members_pkey PRIMARY KEY (account_id, user_email);

ALTER TABLE ONLY public.account_portfolio_use_cases
    ADD CONSTRAINT account_portfolio_use_cases_pkey PRIMARY KEY (account_id, use_case_id);

ALTER TABLE ONLY public.account_promotions
    ADD CONSTRAINT account_promotions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.account_source_status
    ADD CONSTRAINT account_source_status_pkey PRIMARY KEY (account_id, data_source_id);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (user_email);

ALTER TABLE ONLY public.artifacts
    ADD CONSTRAINT artifacts_artifact_type_workspace_id_artifact_id_key UNIQUE (artifact_type, workspace_id, artifact_id);

ALTER TABLE ONLY public.artifacts
    ADD CONSTRAINT artifacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.asset_feeds
    ADD CONSTRAINT asset_feeds_pkey PRIMARY KEY (product_asset_id, raw_asset_id);

ALTER TABLE ONLY public.asset_serves_domain
    ADD CONSTRAINT asset_serves_domain_pkey PRIMARY KEY (data_asset_id, domain_id);

ALTER TABLE ONLY public.asset_taxonomy
    ADD CONSTRAINT asset_taxonomy_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.assumption_research
    ADD CONSTRAINT assumption_research_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.benchmark_library
    ADD CONSTRAINT benchmark_library_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.branding
    ADD CONSTRAINT branding_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chat_conversations
    ADD CONSTRAINT chat_conversations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.classification_rules
    ADD CONSTRAINT classification_rules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.company_profile
    ADD CONSTRAINT company_profile_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.confirm_tokens
    ADD CONSTRAINT confirm_tokens_pkey PRIMARY KEY (token);

ALTER TABLE ONLY public.data_asset_aliases
    ADD CONSTRAINT data_asset_aliases_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.data_asset_aliases
    ADD CONSTRAINT data_asset_aliases_raw_key UNIQUE (raw);

ALTER TABLE ONLY public.data_asset_lobs
    ADD CONSTRAINT data_asset_lobs_pkey PRIMARY KEY (data_asset_id, lob_id);

ALTER TABLE ONLY public.data_assets
    ADD CONSTRAINT data_assets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.data_domains
    ADD CONSTRAINT data_domains_name_key UNIQUE (name);

ALTER TABLE ONLY public.data_domains
    ADD CONSTRAINT data_domains_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.data_source_domains
    ADD CONSTRAINT data_source_domains_pkey PRIMARY KEY (data_source_id, domain_id);

ALTER TABLE ONLY public.data_source_rollup
    ADD CONSTRAINT data_source_rollup_pkey PRIMARY KEY (data_asset_id);

ALTER TABLE ONLY public.data_sources
    ADD CONSTRAINT data_sources_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.discovered_schemas
    ADD CONSTRAINT discovered_schemas_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.discovered_schemas
    ADD CONSTRAINT discovered_schemas_workspace_id_catalog_name_schema_name_key UNIQUE (workspace_id, catalog_name, schema_name);

ALTER TABLE ONLY public.discovered_tables
    ADD CONSTRAINT discovered_tables_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.discovered_tables
    ADD CONSTRAINT discovered_tables_workspace_id_catalog_name_schema_name_tab_key UNIQUE (workspace_id, catalog_name, schema_name, table_name);

ALTER TABLE ONLY public.external_object_map
    ADD CONSTRAINT external_object_map_pkey PRIMARY KEY (account_id, source_app, source_object_type, source_object_id, local_object_type);

ALTER TABLE ONLY public.feature_flags
    ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.funding_requests
    ADD CONSTRAINT funding_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.glossary_terms
    ADD CONSTRAINT glossary_terms_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.glossary_terms
    ADD CONSTRAINT glossary_terms_term_key UNIQUE (term);

ALTER TABLE ONLY public.ingestion_runs
    ADD CONSTRAINT ingestion_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.kb_article_versions
    ADD CONSTRAINT kb_article_versions_article_id_version_key UNIQUE (article_id, version);

ALTER TABLE ONLY public.kb_article_versions
    ADD CONSTRAINT kb_article_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.kb_articles
    ADD CONSTRAINT kb_articles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.kb_articles
    ADD CONSTRAINT kb_articles_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.kb_attachments
    ADD CONSTRAINT kb_attachments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.kb_folders
    ADD CONSTRAINT kb_folders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.kb_links
    ADD CONSTRAINT kb_links_article_id_entity_type_entity_id_relation_key UNIQUE (article_id, entity_type, entity_id, relation);

ALTER TABLE ONLY public.kb_links
    ADD CONSTRAINT kb_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.linked_databricks_assets
    ADD CONSTRAINT linked_databricks_assets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lobs
    ADD CONSTRAINT lobs_name_key UNIQUE (name);

ALTER TABLE ONLY public.lobs
    ADD CONSTRAINT lobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.research_runs
    ADD CONSTRAINT research_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.roadmap_items
    ADD CONSTRAINT roadmap_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.uc_enables_uc
    ADD CONSTRAINT uc_enables_uc_pkey PRIMARY KEY (from_use_case_id, to_use_case_id);

ALTER TABLE ONLY public.uc_requires_asset
    ADD CONSTRAINT uc_requires_asset_pkey PRIMARY KEY (use_case_id, data_asset_id);

ALTER TABLE ONLY public.uc_requires_domain
    ADD CONSTRAINT uc_requires_domain_pkey PRIMARY KEY (use_case_id, domain_id);

ALTER TABLE ONLY public.use_cases
    ADD CONSTRAINT use_cases_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_active_account
    ADD CONSTRAINT user_active_account_pkey PRIMARY KEY (user_email);

ALTER TABLE ONLY public.value_assumptions
    ADD CONSTRAINT value_assumptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.value_records
    ADD CONSTRAINT value_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.value_snapshots
    ADD CONSTRAINT value_snapshots_pkey PRIMARY KEY (id);

CREATE INDEX account_asset_status_account ON public.account_asset_status USING btree (account_id, ingestion_status);

CREATE INDEX account_portfolio_use_cases_uc ON public.account_portfolio_use_cases USING btree (use_case_id);

CREATE INDEX accounts_active ON public.accounts USING btree (is_active);

CREATE UNIQUE INDEX accounts_single_default ON public.accounts USING btree (is_default) WHERE is_default;

CREATE INDEX assumption_research_account ON public.assumption_research USING btree (account_id);

CREATE INDEX branding_account ON public.branding USING btree (account_id);

CREATE UNIQUE INDEX branding_one_per_account ON public.branding USING btree (account_id);

CREATE INDEX chat_conversations_account ON public.chat_conversations USING btree (account_id);

CREATE INDEX comments_account ON public.comments USING btree (account_id);

CREATE INDEX company_profile_account ON public.company_profile USING btree (account_id);

CREATE UNIQUE INDEX company_profile_one_per_account ON public.company_profile USING btree (account_id);

CREATE INDEX external_object_map_local ON public.external_object_map USING btree (local_object_type, local_object_id);

CREATE INDEX funding_requests_account ON public.funding_requests USING btree (account_id);

CREATE INDEX glossary_terms_account ON public.glossary_terms USING btree (account_id);

CREATE INDEX idx_aas_source ON public.account_asset_status USING btree (account_id, source);

CREATE INDEX idx_account_members_user ON public.account_members USING btree (lower(user_email));

CREATE INDEX idx_aliases_canonical ON public.data_asset_aliases USING btree (canonical);

CREATE INDEX idx_aliases_normalized ON public.data_asset_aliases USING btree (raw_normalized);

CREATE INDEX idx_artifacts_type ON public.artifacts USING btree (artifact_type);

CREATE INDEX idx_artifacts_uc ON public.artifacts USING btree (use_case_id);

CREATE INDEX idx_artifacts_unattributed ON public.artifacts USING btree (id) WHERE ((use_case_id IS NULL) AND is_present);

CREATE INDEX idx_asd_domain ON public.asset_serves_domain USING btree (domain_id);

CREATE INDEX idx_ass_account ON public.account_source_status USING btree (account_id);

CREATE INDEX idx_assessments_account ON public.account_assessments USING btree (account_id, status, updated_at DESC);

CREATE INDEX idx_asset_feeds_raw ON public.asset_feeds USING btree (raw_asset_id);

CREATE INDEX idx_assumption_research_key ON public.assumption_research USING btree (key);

CREATE INDEX idx_assumption_research_run ON public.assumption_research USING btree (research_run);

CREATE INDEX idx_chat_messages_conv ON public.chat_messages USING btree (conversation_id, created_at);

CREATE INDEX idx_comments_entity ON public.comments USING btree (entity_type, entity_id);

CREATE INDEX idx_confirm_tokens_expiry ON public.confirm_tokens USING btree (expires_at);

CREATE INDEX idx_data_assets_lob ON public.data_assets USING btree (owning_lob_id);

CREATE INDEX idx_data_assets_status ON public.data_assets USING btree (ingestion_status);

CREATE INDEX idx_data_assets_tier ON public.data_assets USING btree (tier);

CREATE INDEX idx_data_sources_active ON public.data_sources USING btree (is_active);

CREATE INDEX idx_data_sources_category ON public.data_sources USING btree (category);

CREATE INDEX idx_disc_tables_asset ON public.discovered_tables USING btree (data_asset_id);

CREATE INDEX idx_disc_tables_canonical ON public.discovered_tables USING btree (source_system_canonical);

CREATE INDEX idx_disc_tables_schema ON public.discovered_tables USING btree (workspace_id, catalog_name, schema_name);

CREATE INDEX idx_disc_tables_unenriched ON public.discovered_tables USING btree (id) WHERE ((ai_definition IS NULL) AND is_present);

CREATE INDEX idx_domains_active ON public.data_domains USING btree (is_active);

CREATE INDEX idx_domains_category ON public.data_domains USING btree (category);

CREATE INDEX idx_dsd_domain ON public.data_source_domains USING btree (domain_id);

CREATE INDEX idx_dsr_source ON public.data_source_rollup USING btree (data_source_id);

CREATE INDEX idx_enables_to ON public.uc_enables_uc USING btree (to_use_case_id);

CREATE INDEX idx_glossary_domain ON public.glossary_terms USING btree (domain_id);

CREATE INDEX idx_ingestion_runs_kind ON public.ingestion_runs USING btree (kind, started_at DESC);

CREATE INDEX idx_promotions_account ON public.account_promotions USING btree (account_id, created_at DESC);

CREATE INDEX idx_roadmap_uc ON public.roadmap_items USING btree (use_case_id);

CREATE INDEX idx_rules_dimension ON public.classification_rules USING btree (dimension, priority) WHERE is_active;

CREATE UNIQUE INDEX idx_taxonomy_current ON public.asset_taxonomy USING btree (data_asset_id, dimension) WHERE (effective_to IS NULL);

CREATE INDEX idx_taxonomy_dimension ON public.asset_taxonomy USING btree (dimension, value);

CREATE INDEX idx_ura_asset ON public.uc_requires_asset USING btree (data_asset_id);

CREATE INDEX idx_urd_domain ON public.uc_requires_domain USING btree (domain_id);

CREATE INDEX idx_use_cases_lob ON public.use_cases USING btree (lob_id);

CREATE INDEX idx_use_cases_stage ON public.use_cases USING btree (stage);

CREATE INDEX idx_value_uc ON public.value_records USING btree (use_case_id);

CREATE INDEX kb_articles_account ON public.kb_articles USING btree (account_id);

CREATE INDEX kb_articles_folder ON public.kb_articles USING btree (folder_id);

CREATE INDEX kb_articles_search ON public.kb_articles USING gin (search_tsv);

CREATE INDEX kb_articles_status ON public.kb_articles USING btree (status);

CREATE INDEX kb_articles_tags ON public.kb_articles USING gin (tags);

CREATE INDEX kb_articles_title_trgm ON public.kb_articles USING gin (title public.gin_trgm_ops);

CREATE INDEX kb_attachments_article ON public.kb_attachments USING btree (article_id);

CREATE INDEX kb_attachments_checksum ON public.kb_attachments USING btree (checksum);

CREATE INDEX kb_folders_account ON public.kb_folders USING btree (account_id);

CREATE INDEX kb_folders_path ON public.kb_folders USING btree (path);

CREATE UNIQUE INDEX kb_folders_unique_child ON public.kb_folders USING btree (parent_id, lower(name)) WHERE (parent_id IS NOT NULL);

CREATE UNIQUE INDEX kb_folders_unique_root ON public.kb_folders USING btree (lower(name)) WHERE (parent_id IS NULL);

CREATE INDEX kb_links_article ON public.kb_links USING btree (article_id);

CREATE INDEX kb_links_entity ON public.kb_links USING btree (entity_type, entity_id);

CREATE INDEX kb_versions_article ON public.kb_article_versions USING btree (article_id, version DESC);

CREATE INDEX research_runs_account ON public.research_runs USING btree (account_id);

CREATE INDEX roadmap_items_account ON public.roadmap_items USING btree (account_id);

CREATE UNIQUE INDEX use_cases_title_unique ON public.use_cases USING btree (lower(title));

CREATE INDEX value_assumptions_account ON public.value_assumptions USING btree (account_id);

CREATE UNIQUE INDEX value_assumptions_key_per_account ON public.value_assumptions USING btree (account_id, key);

CREATE INDEX value_records_account ON public.value_records USING btree (account_id);

CREATE INDEX value_snapshots_account_time ON public.value_snapshots USING btree (account_id, captured_at DESC);

CREATE UNIQUE INDEX value_snapshots_one_per_minute ON public.value_snapshots USING btree (account_id, captured_minute, reason);

CREATE INDEX value_snapshots_reason ON public.value_snapshots USING btree (reason);

ALTER TABLE ONLY public.account_assessments
    ADD CONSTRAINT account_assessments_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_asset_status
    ADD CONSTRAINT account_asset_status_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_asset_status
    ADD CONSTRAINT account_asset_status_data_asset_id_fkey FOREIGN KEY (data_asset_id) REFERENCES public.data_assets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_asset_status
    ADD CONSTRAINT account_asset_status_owning_lob_id_fkey FOREIGN KEY (owning_lob_id) REFERENCES public.lobs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.account_members
    ADD CONSTRAINT account_members_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_portfolio_use_cases
    ADD CONSTRAINT account_portfolio_use_cases_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_portfolio_use_cases
    ADD CONSTRAINT account_portfolio_use_cases_use_case_id_fkey FOREIGN KEY (use_case_id) REFERENCES public.use_cases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_promotions
    ADD CONSTRAINT account_promotions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_promotions
    ADD CONSTRAINT account_promotions_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.account_assessments(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.account_source_status
    ADD CONSTRAINT account_source_status_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_source_status
    ADD CONSTRAINT account_source_status_data_source_id_fkey FOREIGN KEY (data_source_id) REFERENCES public.data_sources(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.artifacts
    ADD CONSTRAINT artifacts_lob_id_fkey FOREIGN KEY (lob_id) REFERENCES public.lobs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.artifacts
    ADD CONSTRAINT artifacts_use_case_id_fkey FOREIGN KEY (use_case_id) REFERENCES public.use_cases(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.asset_feeds
    ADD CONSTRAINT asset_feeds_product_asset_id_fkey FOREIGN KEY (product_asset_id) REFERENCES public.data_assets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.asset_feeds
    ADD CONSTRAINT asset_feeds_raw_asset_id_fkey FOREIGN KEY (raw_asset_id) REFERENCES public.data_assets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.asset_serves_domain
    ADD CONSTRAINT asset_serves_domain_data_asset_id_fkey FOREIGN KEY (data_asset_id) REFERENCES public.data_assets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.asset_serves_domain
    ADD CONSTRAINT asset_serves_domain_domain_id_fkey FOREIGN KEY (domain_id) REFERENCES public.data_domains(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.asset_taxonomy
    ADD CONSTRAINT asset_taxonomy_data_asset_id_fkey FOREIGN KEY (data_asset_id) REFERENCES public.data_assets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.assumption_research
    ADD CONSTRAINT assumption_research_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.branding
    ADD CONSTRAINT branding_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_conversations
    ADD CONSTRAINT chat_conversations_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.chat_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.company_profile
    ADD CONSTRAINT company_profile_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.data_asset_lobs
    ADD CONSTRAINT data_asset_lobs_data_asset_id_fkey FOREIGN KEY (data_asset_id) REFERENCES public.data_assets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.data_asset_lobs
    ADD CONSTRAINT data_asset_lobs_lob_id_fkey FOREIGN KEY (lob_id) REFERENCES public.lobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.data_assets
    ADD CONSTRAINT data_assets_owning_lob_id_fkey FOREIGN KEY (owning_lob_id) REFERENCES public.lobs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.data_source_domains
    ADD CONSTRAINT data_source_domains_data_source_id_fkey FOREIGN KEY (data_source_id) REFERENCES public.data_sources(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.data_source_domains
    ADD CONSTRAINT data_source_domains_domain_id_fkey FOREIGN KEY (domain_id) REFERENCES public.data_domains(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.data_source_rollup
    ADD CONSTRAINT data_source_rollup_data_asset_id_fkey FOREIGN KEY (data_asset_id) REFERENCES public.data_assets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.data_source_rollup
    ADD CONSTRAINT data_source_rollup_data_source_id_fkey FOREIGN KEY (data_source_id) REFERENCES public.data_sources(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.discovered_tables
    ADD CONSTRAINT discovered_tables_data_asset_id_fkey FOREIGN KEY (data_asset_id) REFERENCES public.data_assets(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.external_object_map
    ADD CONSTRAINT external_object_map_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.funding_requests
    ADD CONSTRAINT funding_requests_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.funding_requests
    ADD CONSTRAINT funding_requests_data_asset_id_fkey FOREIGN KEY (data_asset_id) REFERENCES public.data_assets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.funding_requests
    ADD CONSTRAINT funding_requests_requesting_lob_id_fkey FOREIGN KEY (requesting_lob_id) REFERENCES public.lobs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.glossary_terms
    ADD CONSTRAINT glossary_terms_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.glossary_terms
    ADD CONSTRAINT glossary_terms_domain_id_fkey FOREIGN KEY (domain_id) REFERENCES public.data_domains(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.glossary_terms
    ADD CONSTRAINT glossary_terms_lob_id_fkey FOREIGN KEY (lob_id) REFERENCES public.lobs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.kb_article_versions
    ADD CONSTRAINT kb_article_versions_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.kb_articles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.kb_articles
    ADD CONSTRAINT kb_articles_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.kb_articles
    ADD CONSTRAINT kb_articles_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.kb_folders(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.kb_attachments
    ADD CONSTRAINT kb_attachments_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.kb_articles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.kb_folders
    ADD CONSTRAINT kb_folders_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.kb_folders
    ADD CONSTRAINT kb_folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.kb_folders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.kb_links
    ADD CONSTRAINT kb_links_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.kb_articles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.linked_databricks_assets
    ADD CONSTRAINT linked_databricks_assets_use_case_id_fkey FOREIGN KEY (use_case_id) REFERENCES public.use_cases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.research_runs
    ADD CONSTRAINT research_runs_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.roadmap_items
    ADD CONSTRAINT roadmap_items_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.roadmap_items
    ADD CONSTRAINT roadmap_items_use_case_id_fkey FOREIGN KEY (use_case_id) REFERENCES public.use_cases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.uc_enables_uc
    ADD CONSTRAINT uc_enables_uc_from_use_case_id_fkey FOREIGN KEY (from_use_case_id) REFERENCES public.use_cases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.uc_enables_uc
    ADD CONSTRAINT uc_enables_uc_to_use_case_id_fkey FOREIGN KEY (to_use_case_id) REFERENCES public.use_cases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.uc_requires_asset
    ADD CONSTRAINT uc_requires_asset_data_asset_id_fkey FOREIGN KEY (data_asset_id) REFERENCES public.data_assets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.uc_requires_asset
    ADD CONSTRAINT uc_requires_asset_use_case_id_fkey FOREIGN KEY (use_case_id) REFERENCES public.use_cases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.uc_requires_domain
    ADD CONSTRAINT uc_requires_domain_domain_id_fkey FOREIGN KEY (domain_id) REFERENCES public.data_domains(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.uc_requires_domain
    ADD CONSTRAINT uc_requires_domain_use_case_id_fkey FOREIGN KEY (use_case_id) REFERENCES public.use_cases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.use_cases
    ADD CONSTRAINT use_cases_lob_id_fkey FOREIGN KEY (lob_id) REFERENCES public.lobs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.user_active_account
    ADD CONSTRAINT user_active_account_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.value_assumptions
    ADD CONSTRAINT value_assumptions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.value_records
    ADD CONSTRAINT value_records_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.value_records
    ADD CONSTRAINT value_records_use_case_id_fkey FOREIGN KEY (use_case_id) REFERENCES public.use_cases(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.value_snapshots
    ADD CONSTRAINT value_snapshots_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
