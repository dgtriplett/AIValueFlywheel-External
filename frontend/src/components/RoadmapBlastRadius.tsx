import React, { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { ExternalLink } from 'lucide-react';
import { USE_CASES, DOMAIN_COLORS, getUseCaseById } from '../data/useCases';
import type { UseCase } from '../data/useCases';
import type { AssessmentResults } from '../data/scoring';
import { useCaseMatchesUtility, type UtilityType } from '../data/questions';
import { getActiveIndustry, getActiveIndustryIds, getIndustries } from '../industries/active';
import type { IndustryMeta } from '../industries/types';

// ── Layout constants ────────────────────────────────────────────────────────

// Domains are pulled from the active industry pack and split roughly in half
// around the circle (left semicircle vs right). For industries other than the
// original P&U pack, the split is purely positional — the wedge ordering is
// the pack's `domains` array order, with the first half going on the left.
function getLayoutDomains(): { left: string[]; right: string[] } {
  const ind = getActiveIndustry();
  const all = (ind.domains && ind.domains.length > 0)
    ? ind.domains
    : ['Generation', 'Transmission', 'Distribution', 'Customer', 'Regulatory', 'Corporate Services'];
  const mid = Math.ceil(all.length / 2);
  return { left: all.slice(0, mid), right: all.slice(mid) };
}

// Color palette assigned positionally to packs in a blended layout. First
// pack gets the lava hue, second electric, third success-green, etc. Stable
// per active-pack ordering so the same pack stays the same color frame-to-frame.
const _PACK_COLOR_PALETTE = [
  '#FF3621', // lava — Databricks brand
  '#1E90FF', // electric blue
  '#00C896', // success green
  '#FFB800', // warning amber
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F59E0B', // orange
];

interface BlendPackSlice {
  industryId: string;
  label: string;
  shortLabel: string;
  color: string;
  domains: string[];
}

/** When a blend is active, return one slice per source pack — each holding
 *  the pack's own domain order + a stable color. Returns null for single-pack
 *  views so the caller falls back to the simple `getLayoutDomains()` path. */
function getBlendSlices(): BlendPackSlice[] | null {
  const activeIds = getActiveIndustryIds();
  if (activeIds.length < 2) return null;
  const allIndustries: IndustryMeta[] = getIndustries();
  const packs = activeIds
    .map(id => allIndustries.find(p => p.id === id))
    .filter((p): p is IndustryMeta => !!p);
  if (packs.length < 2) return null;
  return packs.map((p, i) => ({
    industryId: p.id,
    label: p.label,
    shortLabel: p.shortLabel || p.id,
    color: _PACK_COLOR_PALETTE[i % _PACK_COLOR_PALETTE.length],
    domains: p.domains || [],
  }));
}

// Square viewBox so the entire circle fits without clipping.
const SVG_WIDTH = 1000;
const SVG_HEIGHT = 1000;
const CENTER_X = SVG_WIDTH / 2;
const CENTER_Y = SVG_HEIGHT / 2;
const OUTER_R = 430;
const INNER_R = 55;


// Ring outer radii — innermost ring is small, then they expand outward.
// ── Helpers ─────────────────────────────────────────────────────────────────

function getStatus(uc: UseCase, results: AssessmentResults | null): 'completed' | 'recommended' | 'future' {
  if (!results) return 'future';
  if (results.completedUseCases.includes(uc.id)) return 'completed';
  if (results.recommendations.some(r => r.useCase.id === uc.id)) return 'recommended';
  return 'future';
}

// Convert polar (r, angle in radians, 0 = up, clockwise) → cartesian (x, y) in SVG.
function polar(r: number, angleRad: number): { x: number; y: number } {
  return {
    x: CENTER_X + r * Math.sin(angleRad),
    y: CENTER_Y - r * Math.cos(angleRad),
  };
}

// SVG arc path between two angles at a radius (used for ring boundaries / wedge labels).
function arcPath(r: number, startAngle: number, endAngle: number): string {
  const start = polar(r, startAngle);
  const end = polar(r, endAngle);
  const large = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;
  // Sweep direction: 1 (clockwise) if endAngle > startAngle.
  const sweep = endAngle > startAngle ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} ${sweep} ${end.x} ${end.y}`;
}

// Wedge fill (donut sector): used for hover / domain backdrop.
function wedgePath(rInner: number, rOuter: number, startAngle: number, endAngle: number): string {
  const a = polar(rInner, startAngle);
  const b = polar(rOuter, startAngle);
  const c = polar(rOuter, endAngle);
  const d = polar(rInner, endAngle);
  const large = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;
  return [
    `M ${a.x} ${a.y}`,
    `L ${b.x} ${b.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${c.x} ${c.y}`,
    `L ${d.x} ${d.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${a.x} ${a.y}`,
    'Z',
  ].join(' ');
}

// ── Bubble layout ───────────────────────────────────────────────────────────

interface Bubble {
  uc: UseCase;
  number: number;
  x: number;
  y: number;
  r: number;        // bubble radius (visual)
  rPolar: number;   // distance from CENTER — used to compute phase boundaries
  domain: string;
  status: 'completed' | 'recommended' | 'future';
  horizonScore: number;
}

interface BubbleLayout {
  bubbles: Bubble[];
  byId: Map<string, Bubble>;
}

// Continuous radial mapping. The horizon score (0..1) drives radial position.
// Bubbles spread inside-out per their data-driven readiness ranking.
const RADIAL_INNER_PAD = 0.04;  // keep some space at center
const RADIAL_OUTER_PAD = 0.04;  // and at outer edge

function fallbackHorizonScore(uc: UseCase): number {
  // Backstop if a use case lacks a precomputed score (older catalog rows).
  // Mirrors the Python horizon_score formula but coarser — relies on whatever
  // signals are on the use case object.
  const c = (uc.complexity - 1) / 4;
  const ml = uc.complexityScoring?.rubric?.mlMaturity ?? 'none';
  const mlScore = ml === 'agentic' ? 1 : ml === 'genai' ? 0.75 : ml === 'classical' ? 0.45 : 0;
  const deps = Math.min((uc.dependencies || []).length, 6) / 6;
  return Math.max(0.05, Math.min(0.95, 0.4 * c + 0.3 * mlScore + 0.3 * deps));
}

function layoutBubbles(
  results: AssessmentResults | null,
  customerView: UtilityType | null,
  industryIds: string[] | null,
): BubbleLayout {
  const bubbles: Bubble[] = [];
  const byId = new Map<string, Bubble>();
  let counter = 1;

  const layout = getLayoutDomains();
  // Each side holds the same wedge span regardless of how many domains it
  // contains, so 1, 2, 3, or 4 domains fit in the half-circle cleanly.
  const leftSpan = Math.PI / Math.max(1, layout.left.length);
  const rightSpan = Math.PI / Math.max(1, layout.right.length);
  const radialRange = OUTER_R - INNER_R;
  const radialUsable = radialRange * (1 - RADIAL_INNER_PAD - RADIAL_OUTER_PAD);
  const radialStart = INNER_R + radialRange * RADIAL_INNER_PAD;

  const placeWedge = (domain: string, sideStart: number, wedgeIndex: number, wedgeSpan: number) => {
    const wedgeStart = sideStart + wedgeIndex * wedgeSpan;
    const padding = wedgeSpan * 0.07;
    const usable = wedgeSpan - 2 * padding;

    // All use cases in this wedge, sorted ascending by horizon score so
    // bubble #1 is the lowest-score (innermost) and the sequence traces the
    // recommended order of work outward. The customer-view filter narrows
    // to use cases relevant for the selected utility type (or all when null).
    const ucsHere = USE_CASES
      .filter(uc =>
        uc.domain === domain &&
        (!industryIds || industryIds.length === 0 || !uc.industryId || industryIds.includes(uc.industryId)) &&
        useCaseMatchesUtility(uc.utilityTypes, customerView)
      )
      .map(uc => ({ uc, score: uc.horizonScore ?? fallbackHorizonScore(uc) }))
      .sort((a, b) => a.score - b.score);

    const n = ucsHere.length;
    if (n === 0) return;

    // ── 2D grid packing inside the wedge ──────────────────────────────────
    // Decide rows × cols so bubbles fit without overlap. Aspect ratio leans
    // wider than tall (more columns than rows) since the wedge arc is
    // generally longer than the radial thickness at typical radii.
    const arcLengthAtMid = (radialStart + radialUsable / 2) * usable;
    const aspect = arcLengthAtMid / radialUsable;
    const rows = Math.max(1, Math.round(Math.sqrt(n / aspect)));
    const cols = Math.ceil(n / rows);

    // Bubble radius shrinks if the cell would be too small.
    const cellArc = arcLengthAtMid / cols;
    const cellRadial = radialUsable / rows;
    const cellSize = Math.min(cellArc, cellRadial);
    const bubbleR = Math.max(8, Math.min(14, cellSize * 0.42));

    // Keep a small margin off the inner / outer guides so dashed arcs are
    // visible underneath the bubble grid.
    const radialMargin = radialUsable * 0.05;
    const radialPlot = radialUsable - 2 * radialMargin;
    const angularMargin = usable * 0.04;
    const angularPlot = usable - 2 * angularMargin;

    ucsHere.forEach(({ uc, score }, i) => {
      // Sorted ascending by score, so row 0 = innermost = lowest scores.
      const row = Math.floor(i / cols);
      const col = i % cols;
      // Last row may be shorter than `cols` — center its bubbles in the
      // angular space by leaving an empty offset on each side.
      const colsInRow = (row === rows - 1) ? (n - row * cols) : cols;
      const colOffset = (cols - colsInRow) / 2;

      // Within-row score perturbation: bubbles at different scores within
      // the same row land at slightly different radii, so adjacent use
      // cases visibly differ even when ranked into the same row.
      const rowStartIdx = row * cols;
      const rowEndIdx = Math.min(rowStartIdx + cols, n);
      const rowScores = ucsHere.slice(rowStartIdx, rowEndIdx).map(b => b.score);
      const rowMin = rowScores[0];
      const rowMax = rowScores[rowScores.length - 1];
      const rowRange = rowMax - rowMin;
      const scoreFrac = rowRange > 0.001 ? (score - rowMin) / rowRange : 0.5;

      // Base radial slot for this row (rank-based, ensures clean separation).
      const rowT = (row + 0.5) / rows;
      // Always divide by `cols` for angular position so partial rows stay
      // inside the wedge (was the bug that put #98 into Generation).
      const angularT = (col + colOffset + 0.5) / cols;

      // ±~30% of the row's radial thickness based on within-row score rank.
      const rowSlotThickness = 1 / rows;
      const radialPerturb = (scoreFrac - 0.5) * 0.55 * rowSlotThickness;

      const radialT = Math.max(0, Math.min(1, rowT + radialPerturb));

      const r = radialStart + radialMargin + radialT * radialPlot;
      const angle = wedgeStart + padding + angularMargin + angularT * angularPlot;

      const { x, y } = polar(r, angle);
      const status = getStatus(uc, results);
      const bubble: Bubble = {
        uc,
        number: counter++,
        x,
        y,
        r: bubbleR,
        rPolar: r,
        domain,
        status,
        horizonScore: score,
      };
      bubbles.push(bubble);
      byId.set(uc.id, bubble);
    });
  };

  // Pack-grouped layout for blends: each source pack gets an EQUAL arc
  // around the circle, with its domains as sub-wedges inside that arc.
  // Equal-arc rather than proportional-to-UC-count because a pack with 200+
  // UCs (e.g. pu) would visually swamp packs with 16 UCs and the layout
  // becomes unreadable. Equal arcs preserve the per-pack identity and let
  // the legend handle "this pack has more content."
  const slices = getBlendSlices();
  if (slices && slices.length >= 2) {
    const TWO_PI = Math.PI * 2;
    const perPackArc = TWO_PI / slices.length;
    // Start at top of circle (-π/2) and go clockwise.
    let currentAngle = -Math.PI / 2;
    slices.forEach((slice) => {
      // Reserve a visible gutter between packs (~8° each side) so the eye
      // separates them cleanly. Domains divide the remainder evenly.
      const gutter = Math.min(0.14, perPackArc * 0.08);
      const usable = Math.max(0.05, perPackArc - gutter);
      const domainSpan = usable / Math.max(1, slice.domains.length);
      slice.domains.forEach((domain, dIdx) => {
        placeWedge(domain, currentAngle + gutter / 2, dIdx, domainSpan);
      });
      currentAngle += perPackArc;
    });
  } else {
    // Left semicircle (top → bottom = first half of pack.domains, reversed
    // so the first domain sits at the top of the half).
    layout.left.forEach((domain, i) => {
      placeWedge(domain, -Math.PI, layout.left.length - 1 - i, leftSpan);
    });
    // Right semicircle (top → bottom = second half of pack.domains).
    layout.right.forEach((domain, i) => {
      placeWedge(domain, 0, i, rightSpan);
    });
  }

  return { bubbles, byId };
}

// ── Component ───────────────────────────────────────────────────────────────

interface RoadmapBlastRadiusProps {
  customerView?: UtilityType | null;
  /** Legacy single-pack id — accepted for backward compat. Prefer industryIds. */
  industryId?: string | null;
  /** Active pack ids (single or blend). Use cases not in this set are hidden. */
  industryIds?: string[] | null;
  results: AssessmentResults | null;
  onSelect: (uc: UseCase) => void;
  onOpenDetail: (ucId: string) => void;
  selectedUcId: string | null;
}

export const RoadmapBlastRadius: React.FC<RoadmapBlastRadiusProps> = ({
  results,
  onSelect,
  onOpenDetail,
  selectedUcId,
  customerView,
  industryId,
  industryIds,
}) => {
  // Normalize: prefer industryIds when provided, else fall back to legacy single id.
  const resolvedIds = industryIds && industryIds.length > 0
    ? industryIds
    : (industryId ? [industryId] : null);
  const { bubbles, byId } = useMemo(
    () => layoutBubbles(results, customerView ?? null, resolvedIds),
    [results, customerView, resolvedIds && resolvedIds.join(',')]
  );
  const [hover, setHover] = useState<{ uc: UseCase; x: number; y: number } | null>(null);

  // Compute phase-cluster boundaries from the actual bubble positions.
  // Phase boundary = midpoint between the largest radius of phase N and the
  // smallest radius of phase N+1, so the dashed arc visually separates the
  // two clusters regardless of how I've mapped phases to rings.
  const phaseBands = useMemo(() => {
    const byPhase: Record<number, { min: number; max: number }> = {};
    bubbles.forEach(b => {
      const ph = b.uc.phase;
      const cur = byPhase[ph];
      if (!cur) byPhase[ph] = { min: b.rPolar, max: b.rPolar };
      else {
        cur.min = Math.min(cur.min, b.rPolar);
        cur.max = Math.max(cur.max, b.rPolar);
      }
    });
    const phases = [1, 2, 3];
    const boundaries: { radius: number; fromPhase: number; toPhase: number }[] = [];
    for (let i = 0; i < phases.length - 1; i++) {
      const a = byPhase[phases[i]];
      const b = byPhase[phases[i + 1]];
      if (!a || !b) continue;
      boundaries.push({
        radius: (a.max + b.min) / 2,
        fromPhase: phases[i],
        toPhase: phases[i + 1],
      });
    }
    return { byPhase, boundaries };
  }, [bubbles]);

  // Connectivity for selected use case: dashed lines to prereqs, dependents, shared-data.
  const relations = useMemo(() => {
    if (!selectedUcId) return null;
    const sel = getUseCaseById(selectedUcId);
    if (!sel) return null;

    const prereqs = new Set(sel.dependencies);
    const dependents = new Set<string>();
    USE_CASES.forEach(uc => {
      if (uc.dependencies.includes(sel.id)) dependents.add(uc.id);
    });
    const shared = new Set<string>();
    const selDeps = new Set(sel.dependencies);
    USE_CASES.forEach(uc => {
      if (uc.id === sel.id) return;
      if (prereqs.has(uc.id) || dependents.has(uc.id)) return;
      if (uc.dependencies.some(d => selDeps.has(d))) shared.add(uc.id);
    });

    return { selected: sel, prereqs, dependents, shared };
  }, [selectedUcId]);

  const allRelatedIds = useMemo(() => {
    if (!relations) return null;
    const set = new Set<string>([relations.selected.id]);
    relations.prereqs.forEach(id => set.add(id));
    relations.dependents.forEach(id => set.add(id));
    relations.shared.forEach(id => set.add(id));
    return set;
  }, [relations]);

  // Wedge label positions (placed just inside the outer ring).
  // In blend mode: emit domain labels near the bubbles plus a pack-name
  // label at the centroid of each pack's arc (with the pack's hue).
  const wedgeLabels = useMemo(() => {
    const labels: Array<{ x: number; y: number; angle: number; text: string; color: string; size?: 'sm' | 'lg' }> = [];
    const labelR = OUTER_R + 28;
    const packLabelR = OUTER_R + 70;
    const slices = getBlendSlices();

    if (slices && slices.length >= 2) {
      // Match the equal-arc allocation in layoutBubbles.
      const TWO_PI = Math.PI * 2;
      const perPackArc = TWO_PI / slices.length;
      let currentAngle = -Math.PI / 2;
      slices.forEach((slice) => {
        // Only emit domain sub-labels when the pack has ≤3 domains; otherwise
        // they overlap each other unreadably. Bubble hover + the right-side
        // use-case key carry the domain info instead.
        if (slice.domains.length > 0 && slice.domains.length <= 3) {
          const gutter = Math.min(0.14, perPackArc * 0.08);
          const usable = Math.max(0.05, perPackArc - gutter);
          const domainSpan = usable / Math.max(1, slice.domains.length);
          slice.domains.forEach((domain, dIdx) => {
            const wedgeStart = currentAngle + gutter / 2 + dIdx * domainSpan;
            const a = wedgeStart + domainSpan / 2;
            const { x, y } = polar(labelR, a);
            labels.push({ x, y, angle: a, text: domain, color: slice.color, size: 'sm' });
          });
        }
        // Pack centroid label (bolder, further out).
        const packMid = currentAngle + perPackArc / 2;
        const { x: px, y: py } = polar(packLabelR, packMid);
        labels.push({ x: px, y: py, angle: packMid, text: slice.shortLabel, color: slice.color, size: 'lg' });
        currentAngle += perPackArc;
      });
      return labels;
    }

    // Single-pack — original left/right split.
    const layout = getLayoutDomains();
    const leftSpan = Math.PI / Math.max(1, layout.left.length);
    const rightSpan = Math.PI / Math.max(1, layout.right.length);

    layout.left.forEach((domain, i) => {
      const wedgeStart = -Math.PI + (layout.left.length - 1 - i) * leftSpan;
      const angle = wedgeStart + leftSpan / 2;
      const { x, y } = polar(labelR, angle);
      labels.push({ x, y, angle, text: domain, color: DOMAIN_COLORS[domain] });
    });
    layout.right.forEach((domain, i) => {
      const wedgeStart = i * rightSpan;
      const angle = wedgeStart + rightSpan / 2;
      const { x, y } = polar(labelR, angle);
      labels.push({ x, y, angle, text: domain, color: DOMAIN_COLORS[domain] });
    });
    return labels;
  }, [resolvedIds && resolvedIds.join(','), customerView]);

  // Build dashed line endpoints (selected → related) for SVG.
  const connectorLines = useMemo(() => {
    if (!relations) return [];
    const sel = byId.get(relations.selected.id);
    if (!sel) return [];
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number; color: string; type: string }> = [];
    relations.prereqs.forEach(id => {
      const b = byId.get(id);
      if (b) lines.push({ x1: sel.x, y1: sel.y, x2: b.x, y2: b.y, color: '#F59E0B', type: 'prereq' });
    });
    relations.dependents.forEach(id => {
      const b = byId.get(id);
      if (b) lines.push({ x1: sel.x, y1: sel.y, x2: b.x, y2: b.y, color: '#10B981', type: 'depends' });
    });
    relations.shared.forEach(id => {
      const b = byId.get(id);
      if (b) lines.push({ x1: sel.x, y1: sel.y, x2: b.x, y2: b.y, color: '#8B5CF6', type: 'shared' });
    });
    return lines;
  }, [relations, byId]);

  return (
    <div className="w-full flex items-start gap-4">
      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="flex-1 min-w-0 max-w-[900px] h-auto select-none mx-auto"
        data-blast-radius="true"
      >
        {/* Background — for single-pack mode tint left vs right (Ops vs Business).
            For blend mode tint each pack's arc in its own hue so the eye picks
            up the per-pack territory at a glance. */}
        {(() => {
          const slices = getBlendSlices();
          if (slices && slices.length >= 2) {
            const TWO_PI = Math.PI * 2;
            const perPackArc = TWO_PI / slices.length;
            let currentAngle = -Math.PI / 2;
            const out = slices.map((slice) => {
              const start = currentAngle;
              const end = currentAngle + perPackArc;
              currentAngle = end;
              return (
                <path
                  key={`pack-bg-${slice.industryId}`}
                  d={wedgePath(0, OUTER_R, start, end)}
                  fill={slice.color}
                  opacity={0.06}
                />
              );
            });
            return <>{out}</>;
          }
          return (
            <>
              <path d={wedgePath(0, OUTER_R, -Math.PI, 0)} fill="rgba(59, 130, 246, 0.025)" />
              <path d={wedgePath(0, OUTER_R, 0, Math.PI)} fill="rgba(139, 92, 246, 0.025)" />
            </>
          );
        })()}

        {/* Innermost circle */}
        <path
          d={arcPath(INNER_R, -Math.PI, Math.PI)}
          fill="none"
          stroke="rgba(148, 163, 184, 0.18)"
          strokeWidth={1}
        />

        {/* Phase cluster boundaries — dashed concentric arcs that visually
            group use cases by Databricks delivery phase. Computed from actual
            bubble radii so the arcs always cleanly separate the clusters. */}
        {phaseBands.boundaries.map((b, i) => (
          <g key={`phase-${i}`}>
            <path
              d={arcPath(b.radius, -Math.PI + 0.001, Math.PI - 0.001)}
              fill="none"
              stroke="rgba(245, 158, 11, 0.55)"
              strokeWidth={1.4}
              strokeDasharray="6 5"
            />
          </g>
        ))}
        {/* Phase labels — pinned along the bottom-center axis (where there
            are no domain bubbles, since the vertical splitter sits between
            wedges). Stacked from inner to outer. */}
        {[1, 2, 3].map(ph => {
          const band = phaseBands.byPhase[ph];
          if (!band) return null;
          const r = (band.min + band.max) / 2;
          return (
            <g key={`phase-label-${ph}`} pointerEvents="none">
              <rect
                x={CENTER_X - 38}
                y={CENTER_Y + r - 9}
                width={76}
                height={18}
                rx={9}
                fill="rgba(15, 23, 42, 0.92)"
                stroke="rgba(245, 158, 11, 0.55)"
                strokeWidth={1}
              />
              <text
                x={CENTER_X}
                y={CENTER_Y + r + 4}
                textAnchor="middle"
                fontSize="10"
                fontWeight={700}
                fill="rgba(245, 158, 11, 0.95)"
                letterSpacing="0.08em"
              >
                PHASE {ph}
              </text>
            </g>
          );
        })}

        {/* Wedge dividers (between domains on each side) */}
        {[-2 * Math.PI / 3, -Math.PI / 3, Math.PI / 3, 2 * Math.PI / 3].map((a, i) => {
          const inner = polar(INNER_R, a);
          const outer = polar(OUTER_R, a);
          return (
            <line
              key={i}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="rgba(148, 163, 184, 0.14)"
              strokeWidth={1}
              strokeDasharray="2 4"
            />
          );
        })}
        {/* Vertical splitter between left/right semi-circles */}
        <line
          x1={CENTER_X}
          y1={CENTER_Y - OUTER_R}
          x2={CENTER_X}
          y2={CENTER_Y - INNER_R}
          stroke="rgba(148, 163, 184, 0.25)"
          strokeWidth={1}
        />
        <line
          x1={CENTER_X}
          y1={CENTER_Y + INNER_R}
          x2={CENTER_X}
          y2={CENTER_Y}
          stroke="rgba(148, 163, 184, 0.25)"
          strokeWidth={1}
        />


        {/* Domain + pack wedge labels (outside outer ring). Pack-level
            labels in blend mode are larger to anchor the eye on each pack's
            arc; domain labels stay readable but smaller. */}
        {wedgeLabels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={l.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={l.size === 'lg' ? 16 : 12}
            fontWeight={l.size === 'lg' ? 800 : 700}
            fill={l.color}
            style={l.size === 'lg' ? { letterSpacing: '0.05em', textTransform: 'uppercase' as const } : undefined}
          >
            {l.text}
          </text>
        ))}

        {/* Side caption labels — Operations vs Business (placed at the very top) */}
        {/* Side captions — only meaningful for the P&U layout (left =
            Operations, right = Business). For blends or any other pack, the
            pack-level labels rendered above carry the same semantic, so we
            suppress these to avoid contradictory framing. */}
        {(() => {
          const ind = getActiveIndustry();
          const isPuSingle = ind.id === 'pu';
          if (!isPuSingle) return null;
          return (
            <>
              <text
                x={CENTER_X - OUTER_R * 0.55}
                y={28}
                textAnchor="middle"
                fontSize="13"
                fontWeight={700}
                fill="rgba(148, 163, 184, 0.9)"
                letterSpacing="0.12em"
              >
                GRID OPERATIONS
              </text>
              <text
                x={CENTER_X + OUTER_R * 0.55}
                y={28}
                textAnchor="middle"
                fontSize="13"
                fontWeight={700}
                fill="rgba(148, 163, 184, 0.9)"
                letterSpacing="0.12em"
              >
                BUSINESS &amp; CUSTOMER
              </text>
            </>
          );
        })()}

        {/* Connector dashed lines (under bubbles so bubbles render on top) */}
        {connectorLines.map((l, i) => (
          <line
            key={i}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke={l.color}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            opacity={0.85}
          />
        ))}

        {/* Bubbles */}
        {bubbles.map(b => {
          const isSelected = b.uc.id === selectedUcId;
          const isRelated = allRelatedIds?.has(b.uc.id) ?? true;
          const dimmed = !!selectedUcId && !isRelated;
          const fill = DOMAIN_COLORS[b.domain] || '#64748B';
          return (
            <g
              key={b.uc.id}
              className="cursor-pointer"
              opacity={dimmed ? 0.18 : 1}
              onClick={(e) => { e.stopPropagation(); onSelect(b.uc); }}
              onMouseEnter={() => setHover({ uc: b.uc, x: b.x, y: b.y })}
              onMouseLeave={() => setHover(prev => (prev?.uc.id === b.uc.id ? null : prev))}
            >
              {/* halo for selected */}
              {isSelected && (
                <circle
                  cx={b.x}
                  cy={b.y}
                  r={b.r + 7}
                  fill="none"
                  stroke={fill}
                  strokeWidth={2}
                  opacity={0.5}
                />
              )}
              {/* recommended pulse ring */}
              {b.status === 'recommended' && !isSelected && (
                <circle
                  cx={b.x}
                  cy={b.y}
                  r={b.r + 4}
                  fill="none"
                  stroke={fill}
                  strokeWidth={1}
                  opacity={0.45}
                />
              )}
              <circle
                cx={b.x}
                cy={b.y}
                r={b.r}
                fill={fill}
                fillOpacity={b.status === 'completed' ? 0.95 : b.status === 'recommended' ? 0.85 : 0.55}
                stroke={isSelected ? '#fff' : 'rgba(15, 23, 42, 0.6)'}
                strokeWidth={isSelected ? 2 : 1}
              />
              <text
                x={b.x}
                y={b.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="10"
                fontWeight={700}
                fill="#fff"
                pointerEvents="none"
              >
                {b.number}
              </text>
            </g>
          );
        })}

        {/* Center pivot */}
        <circle cx={CENTER_X} cy={CENTER_Y} r={4} fill="rgba(148, 163, 184, 0.5)" />

        {/* Hover tooltip — anchored above the bubble */}
        {hover && (() => {
          const isRec = !!results?.recommendations.some(r => r.useCase.id === hover.uc.id);
          const txt = hover.uc.name;
          const sub = `Phase ${hover.uc.phase} · complexity ${hover.uc.complexity}/5${isRec ? ' · recommended' : ''}`;
          // Width based on text length (rough approx).
          const w = Math.max(220, Math.min(360, txt.length * 7.5 + 40));
          const h = 46;
          // Place above bubble; if too high, place below.
          const above = hover.y - 24 - h > 0;
          const tx = Math.max(8, Math.min(SVG_WIDTH - w - 8, hover.x - w / 2));
          const ty = above ? hover.y - 24 - h : hover.y + 24;
          return (
            <g pointerEvents="none">
              <rect
                x={tx}
                y={ty}
                width={w}
                height={h}
                rx={6}
                fill="rgba(15, 23, 42, 0.97)"
                stroke="rgba(148, 163, 184, 0.35)"
                strokeWidth={1}
              />
              <text x={tx + 10} y={ty + 18} fontSize="12" fontWeight={600} fill="#fff">{txt}</text>
              <text x={tx + 10} y={ty + 35} fontSize="10" fill="rgba(148, 163, 184, 0.85)">{sub}</text>
            </g>
          );
        })()}
      </svg>

      {/* Legend / number key panel renders alongside via parent layout */}
      <BubbleNumberKey
        bubbles={bubbles}
        selectedUcId={selectedUcId}
        relations={relations}
        onSelect={(uc) => onSelect(uc)}
        onOpenDetail={onOpenDetail}
      />
    </div>
  );
};

// ── Number key (legend) ─────────────────────────────────────────────────────

const BubbleNumberKey: React.FC<{
  bubbles: Bubble[];
  selectedUcId: string | null;
  relations: { selected: UseCase; prereqs: Set<string>; dependents: Set<string>; shared: Set<string> } | null;
  onSelect: (uc: UseCase) => void;
  onOpenDetail: (ucId: string) => void;
}> = ({ bubbles, selectedUcId, relations, onSelect, onOpenDetail }) => {
  // When a bubble is selected, narrow the list to just that use case + its
  // related ones so the side panel becomes a focused dependency summary.
  const visibleIds = useMemo(() => {
    if (!relations) return null; // null → show everything
    const set = new Set<string>([relations.selected.id]);
    relations.prereqs.forEach(id => set.add(id));
    relations.dependents.forEach(id => set.add(id));
    relations.shared.forEach(id => set.add(id));
    return set;
  }, [relations]);

  const grouped = useMemo(() => {
    const map: Record<string, Bubble[]> = {};
    bubbles.forEach(b => {
      if (visibleIds && !visibleIds.has(b.uc.id)) return;
      (map[b.domain] ||= []).push(b);
    });
    return map;
  }, [bubbles, visibleIds]);

  const _layout = getLayoutDomains();
  const allDomains: readonly string[] = [..._layout.left, ..._layout.right];

  return (
    <div className="hidden xl:block w-72 ml-4 max-h-[80vh] overflow-y-auto sticky top-24">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wider text-slate-400">
          {relations ? 'Related use cases' : 'Use case key'}
        </div>
        {relations && (
          <button
            onClick={() => onSelect(relations.selected)}
            className="text-[10px] text-slate-400 hover:text-heading"
            title="Clear selection"
          >
            Clear
          </button>
        )}
      </div>
      {allDomains.map(domain => {
        const list = grouped[domain] || [];
        if (list.length === 0) return null;
        return (
          <div key={domain} className="mb-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2.5 h-2.5 rounded" style={{ backgroundColor: DOMAIN_COLORS[domain] }} />
              <div className="text-[11px] font-semibold text-heading">{domain}</div>
            </div>
            <ul className="space-y-0.5 pl-1">
              {list.map(b => {
                const rel = relations
                  ? b.uc.id === relations.selected.id ? 'selected'
                  : relations.prereqs.has(b.uc.id) ? 'prereq'
                  : relations.dependents.has(b.uc.id) ? 'depends'
                  : relations.shared.has(b.uc.id) ? 'shared'
                  : null
                  : null;
                const isSelected = b.uc.id === selectedUcId;
                return (
                  <li key={b.uc.id}>
                    <div
                      className={clsx(
                        'w-full flex items-center gap-2 text-left px-1 py-0.5 rounded hover:bg-navy-700/50 transition-colors',
                        isSelected && 'bg-navy-700',
                      )}
                    >
                      <button
                        onClick={() => onSelect(b.uc)}
                        className="flex items-center gap-2 flex-1 min-w-0"
                      >
                        <span
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-heading flex-shrink-0"
                          style={{ backgroundColor: DOMAIN_COLORS[domain] }}
                        >
                          {b.number}
                        </span>
                        <span className="text-[11px] text-slate-300 truncate flex-1 text-left">{b.uc.name}</span>
                      </button>
                      {rel && rel !== 'selected' && (
                        <span
                          className="text-[8px] uppercase tracking-wide font-bold flex-shrink-0"
                          style={{
                            color: rel === 'prereq' ? '#F59E0B' : rel === 'depends' ? '#10B981' : '#8B5CF6',
                          }}
                        >
                          {rel === 'prereq' ? 'prereq' : rel === 'depends' ? 'builds-on' : 'shared'}
                        </span>
                      )}
                      {isSelected && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onOpenDetail(b.uc.id); }}
                          className="text-electric hover:text-heading flex-shrink-0"
                          title="Open full details"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
};
