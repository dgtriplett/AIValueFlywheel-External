// Customer-facing artifact panel. Fetches enabled-only artifacts for a given
// use case, renders them as expandable cards. Inline markdown content is shown
// in a simple pre/prose block; external links open in a new tab.

import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  ExternalLink, ChevronDown, ChevronRight, Package, BookOpen, Github,
  FileText, Layers, Database, Video, LayoutDashboard, Library, Zap,
  Handshake, Store, GraduationCap, Trophy, Rocket,
} from 'lucide-react';
import { api, type ArtifactAPI, type ArtifactType } from '../lib/api';

interface ArtifactsProps {
  useCaseId: string;
  /** When true, also render disabled artifacts with a badge. Used in admin preview contexts. */
  showAll?: boolean;
  /** Optional pre-fetched list — skips the network call. */
  preloaded?: ArtifactAPI[];
  title?: string;
}

const TYPE_ICON: Record<ArtifactType, React.ReactNode> = {
  accelerator: <Zap className="w-4 h-4" />,
  brickbuilder: <Rocket className="w-4 h-4" />,
  partner: <Handshake className="w-4 h-4" />,
  marketplace: <Store className="w-4 h-4" />,
  notebook: <BookOpen className="w-4 h-4" />,
  blog: <FileText className="w-4 h-4" />,
  docs: <Library className="w-4 h-4" />,
  repo: <Github className="w-4 h-4" />,
  video: <Video className="w-4 h-4" />,
  dashboard: <LayoutDashboard className="w-4 h-4" />,
  sql: <Database className="w-4 h-4" />,
  architecture: <Layers className="w-4 h-4" />,
  training: <GraduationCap className="w-4 h-4" />,
  case_study: <Trophy className="w-4 h-4" />,
  reference: <Package className="w-4 h-4" />,
};

const TYPE_LABEL: Record<ArtifactType, string> = {
  accelerator: 'Solution Accelerator',
  brickbuilder: 'Brickbuilder Solution',
  partner: 'Partner Solution',
  marketplace: 'Databricks Marketplace',
  notebook: 'Notebook',
  blog: 'Blog',
  docs: 'Docs',
  repo: 'Repository',
  video: 'Video',
  dashboard: 'Dashboard',
  sql: 'SQL Starter',
  architecture: 'Architecture',
  training: 'Training',
  case_study: 'Customer Case Study',
  reference: 'Reference',
};

export const Artifacts: React.FC<ArtifactsProps> = ({ useCaseId, showAll, preloaded, title }) => {
  const [rows, setRows] = useState<ArtifactAPI[] | null>(preloaded ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (preloaded) return;
    const fn = showAll ? api.adminListArtifacts : api.getArtifacts;
    setLoadError(null);
    fn(useCaseId).then((rs: unknown) => {
      // The curated "how to get started" artifacts are a maturity-app feature; in this
      // app /api/artifacts is served by the inventory endpoint, which returns an object
      // ({artifacts, summary, by_type}) rather than the ArtifactAPI[] this panel expects.
      // Coerce anything that isn't an ArtifactAPI[] to empty so the panel shows nothing
      // instead of crashing on rs.slice(). (Was: `r.slice is not a function`.)
      setRows(Array.isArray(rs) ? (rs as ArtifactAPI[]) : []);
    }).catch((e: Error) => {
      setRows([]);
      setLoadError(e.message || 'Failed to load resources.');
    });
  }, [useCaseId, showAll, preloaded]);

  if (rows === null) {
    return (
      <div className="text-xs text-navy-400">Loading resources…</div>
    );
  }
  if (loadError) {
    return (
      <div className="text-xs text-lava-300">
        Couldn't load resources — {loadError}
      </div>
    );
  }
  if (rows.length === 0) return null;

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold text-navy-400 uppercase tracking-wider">
        {title ?? 'How to get started'}
      </h3>
      <div className="space-y-2">
        {rows
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((a) => (
            <ArtifactCard key={a.id} artifact={a} showDisabledBadge={showAll} />
          ))}
      </div>
    </section>
  );
};

const ArtifactCard: React.FC<{ artifact: ArtifactAPI; showDisabledBadge?: boolean }> = ({
  artifact,
  showDisabledBadge,
}) => {
  const [expanded, setExpanded] = useState(false);
  const hasContent = !!artifact.content;
  const hasUrl = !!artifact.url;

  return (
    <div className={clsx(
      'card p-4',
      showDisabledBadge && !artifact.enabled && 'opacity-60 border-dashed'
    )}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5 text-lava">{TYPE_ICON[artifact.type]}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider text-navy-400">
                  {TYPE_LABEL[artifact.type]}
                </span>
                {showDisabledBadge && !artifact.enabled && (
                  <span className="text-[10px] uppercase tracking-wider bg-warning-600/15 text-warning-400 px-1.5 py-0.5 rounded">
                    Disabled
                  </span>
                )}
              </div>
              <div className="text-sm font-medium text-heading mt-0.5">{artifact.title}</div>
              {artifact.description && (
                <p className="text-xs text-navy-300 mt-1 leading-relaxed">{artifact.description}</p>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {hasUrl && (
                <a
                  href={artifact.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-navy-500 text-xs text-heading hover:bg-navy-700"
                  title={artifact.url}
                >
                  Open <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {hasContent && (
                <button
                  onClick={() => setExpanded((e) => !e)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-navy-500 text-xs text-heading hover:bg-navy-700"
                >
                  {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  {expanded ? 'Hide' : 'View'}
                </button>
              )}
            </div>
          </div>
          {expanded && hasContent && (
            <div className="mt-3 p-3 rounded bg-navy-900 border border-navy-600 text-[13px] text-navy-300 leading-relaxed">
              <MarkdownBlock source={artifact.content} />
            </div>
          )}
          {artifact.tags && artifact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {artifact.tags.slice(0, 6).map((t) => (
                <span key={t} className="text-[10px] text-navy-400 bg-navy-700 rounded px-1.5 py-0.5">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Very minimal markdown renderer — enough for the starter artifacts:
 * - Preserves line breaks
 * - Renders ```language code blocks``` as a styled pre
 * - Leaves other markdown as preformatted text
 * Not a full parser; intentionally simple to keep bundle size small.
 */
const MarkdownBlock: React.FC<{ source: string }> = ({ source }) => {
  const blocks = splitCodeBlocks(source);
  return (
    <div className="space-y-3">
      {blocks.map((b, i) =>
        b.type === 'code' ? (
          <pre
            key={i}
            className="bg-navy-800 border border-navy-600 rounded p-3 overflow-x-auto text-[12px] font-mono text-heading"
          >
            <code>{b.text}</code>
          </pre>
        ) : (
          <div key={i} className="whitespace-pre-wrap">{b.text.trim()}</div>
        )
      )}
    </div>
  );
};

function splitCodeBlocks(md: string): Array<{ type: 'code' | 'text'; text: string }> {
  const parts: Array<{ type: 'code' | 'text'; text: string }> = [];
  const re = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    if (m.index > lastIdx) parts.push({ type: 'text', text: md.slice(lastIdx, m.index) });
    parts.push({ type: 'code', text: m[1] });
    lastIdx = re.lastIndex;
  }
  if (lastIdx < md.length) parts.push({ type: 'text', text: md.slice(lastIdx) });
  return parts;
}
