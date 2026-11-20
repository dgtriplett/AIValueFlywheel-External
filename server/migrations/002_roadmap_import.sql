-- 002 — Roadmap import (AIVR 2.0).
--
-- A business unit's portfolio can now be seeded from a roadmap package produced by a
-- planning tool (format: docs/ROADMAP_PACKAGE.md). Three tables:
--
--   roadmap_imports            one row per package applied to an account: history, and
--                              the base a later version of the same roadmap is diffed
--                              against.
--   account_pillars            the account's strategic pillars (the "why" every use case
--                              on the roadmap ladders up to).
--   account_roadmap_use_cases  what the roadmap said about each portfolio use case:
--                              pillar, value-chain stage, workstream, priority, the
--                              roadmap's value estimate and its first-version plan.
--
-- stage / workstream hold the roadmap's display names (the ids live in the package
-- kept on roadmap_imports). Additive only: no existing table or column changes.

CREATE TABLE public.roadmap_imports (
    id text NOT NULL,
    account_id integer NOT NULL,
    source_app text NOT NULL,
    roadmap_id text NOT NULL,
    roadmap_version text,
    title text,
    package_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    summary_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.account_pillars (
    account_id integer NOT NULL,
    pillar_id text NOT NULL,
    name text NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    source text DEFAULT 'roadmap'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.account_roadmap_use_cases (
    account_id integer NOT NULL,
    use_case_id integer NOT NULL,
    external_id text NOT NULL,
    roadmap_import_id text,
    name text,
    summary text,
    business_problem text,
    kpi text,
    pillar_ids text[] DEFAULT '{}'::text[] NOT NULL,
    stage text,
    workstream text,
    priority_rank integer,
    priority_tier text,
    effort text,
    effort_quadrant text,
    value_currency text,
    value_low numeric,
    value_base numeric,
    value_high numeric,
    value_json jsonb,
    plan_json jsonb,
    data_needs_json jsonb,
    dropped_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.roadmap_imports
    ADD CONSTRAINT roadmap_imports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.account_pillars
    ADD CONSTRAINT account_pillars_pkey PRIMARY KEY (account_id, pillar_id);

ALTER TABLE ONLY public.account_roadmap_use_cases
    ADD CONSTRAINT account_roadmap_use_cases_pkey PRIMARY KEY (account_id, use_case_id);

ALTER TABLE ONLY public.account_roadmap_use_cases
    ADD CONSTRAINT account_roadmap_use_cases_external_key UNIQUE (account_id, external_id);

CREATE INDEX roadmap_imports_account_idx ON public.roadmap_imports USING btree (account_id, created_at DESC);

ALTER TABLE ONLY public.roadmap_imports
    ADD CONSTRAINT roadmap_imports_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_pillars
    ADD CONSTRAINT account_pillars_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_roadmap_use_cases
    ADD CONSTRAINT account_roadmap_use_cases_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_roadmap_use_cases
    ADD CONSTRAINT account_roadmap_use_cases_use_case_id_fkey FOREIGN KEY (use_case_id) REFERENCES public.use_cases(id) ON DELETE CASCADE;
