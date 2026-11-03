import React, { useState } from 'react';
import {
  Zap, BarChart3, Target, Users, ArrowRight, Shield, Clock,
  Database, ShieldAlert, FileText, Trash2, RefreshCw, BookOpen,
  ChevronDown, ChevronRight, EyeOff, Eye, ExternalLink, Edit3, GitCompare,
  FileDown, Loader2, TrendingUp,
} from 'lucide-react';
import { api, type CurrentUser, type DraftRow, type AssessmentListRow } from '../lib/api';
import { ProgressionPanel } from './ProgressionPanel';
import { UserGuideModal } from './UserGuideModal';
import { useIndustries } from '../industries/active';

interface LandingPageProps {
  onStart: () => void;
  onViewRoadmap: () => void;
  user?: CurrentUser;
  onOpenAdmin?: () => void;
  onResumeDraft?: (id: string) => void;
  onViewAssessment?: (id: string) => void;
  onEditAndRerun?: (id: string) => void;
  onViewCompare?: () => void;
  // Recent work is owned by App (lifted state) so returning to the landing
  // page is instantaneous instead of re-fetching against the warehouse.
  drafts: DraftRow[] | null;
  myAssessments: AssessmentListRow[] | null;
  onReloadMyWork: () => void;
  onDeleteDraft: (id: string) => Promise<void>;
  onDeleteAssessment: (id: string, name: string) => Promise<void>;
  deleteError: string | null;
  onDismissDeleteError: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onStart, onViewRoadmap, user, onOpenAdmin, onResumeDraft, onViewAssessment, onEditAndRerun, onViewCompare,
  drafts, myAssessments, onReloadMyWork, onDeleteDraft, onDeleteAssessment,
  deleteError, onDismissDeleteError,
}) => {
  const industries = useIndustries();
  const [progressionCustomer, setProgressionCustomer] = useState<string | null>(null);
  const [exportingAssessmentId, setExportingAssessmentId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // "AI-Powered <Thing>" — the industry's short label when there's a single
  // active industry, otherwise the generic word for multi-industry deploys.
  // While /api/industries is still loading, show "Organization" rather than
  // the FALLBACK_INDUSTRY shortLabel ("Assessment") to avoid the flash from
  // "Assessment" → "Organization" on first paint.
  const heroSubject = industries.length === 0
    ? 'Organization'
    : industries.length === 1
      ? (industries[0].shortLabel || industries[0].label || 'Organization')
      : 'Organization';

  // Customers with ≥2 submitted assessments — eligible to view a progression.
  const customerCounts = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of myAssessments || []) {
      const k = (a.customer_name || '').trim();
      if (!k) continue;
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  }, [myAssessments]);
  // Default collapsed so other business units' names aren't on screen during a
  // presentation. Persist preference per browser, scoped
  // to this app + workspace so two parallel deploys don't collide.
  const lsKey = 'damar.showRecentWork';
  const [showRecent, setShowRecent] = useState<boolean>(() => {
    try { return localStorage.getItem(lsKey) === '1'; } catch { return false; }
  });
  const toggleRecent = () => {
    setShowRecent(v => {
      const next = !v;
      try { localStorage.setItem(lsKey, next ? '1' : '0'); } catch {}
      return next;
    });
  };

  const reloadMyWork = onReloadMyWork;
  const deleteDraft = onDeleteDraft;
  const deleteAssessment = onDeleteAssessment;
  void onDismissDeleteError; // (kept for future "x" button)

  const [showGuide, setShowGuide] = useState(false);

  const exportValueFlywheelPackage = async (assessment: AssessmentListRow) => {
    setExportingAssessmentId(assessment.id);
    setExportError(null);
    try {
      const blob = await api.valueFlywheelRoadmapPackage(assessment.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const customer = (assessment.customer_name || 'roadmap')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'roadmap';
      a.href = url;
      a.download = `value-flywheel-roadmap-${customer}-${assessment.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExportingAssessmentId(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-navy-600 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-lava flex items-center justify-center">
              <Zap className="w-5 h-5 text-heading" />
            </div>
            <span className="text-lg font-semibold text-heading">AI Value Flywheel</span>
            <span className="text-slate-500 mx-1">|</span>
            <span className="text-sm text-slate-400">Assess · Plan · Operate</span>
          </div>
          <div className="flex items-center gap-5">
            <button
              onClick={() => setShowGuide(true)}
              className="flex items-center gap-2 text-sm text-slate-400 hover:text-heading transition-colors"
              title="What is this tool and how do I use it?"
            >
              <BookOpen className="w-4 h-4" />
              Guide
            </button>
            {onViewCompare && (
              <button
                onClick={onViewCompare}
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-heading transition-colors"
                title="Compare this account's assessments over time"
              >
                <TrendingUp className="w-4 h-4" />
                History
              </button>
            )}
            {user?.isAdmin && onOpenAdmin && (
              <button
                onClick={onOpenAdmin}
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-heading transition-colors"
                title="Admin console"
              >
                <ShieldAlert className="w-4 h-4" />
                Admin
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-5xl w-full">
          <div className="text-center mb-16 animate-fade-in">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-lava/10 border border-lava/30 mb-8">
              <Database className="w-4 h-4 text-lava" />
              <span className="text-sm text-lava-300">Data &amp; AI Maturity Assessment &amp; Roadmap</span>
            </div>

            <h1 className="text-5xl md:text-6xl font-bold text-heading mb-6 leading-tight">
              Your roadmap to an
              <br />
              <span className="bg-gradient-to-r from-lava via-lava-400 to-warning-600 bg-clip-text text-transparent">
                AI-Powered {heroSubject}
              </span>
            </h1>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
              Assess where you are on the prescriptive 3-phase path to becoming a Data &amp; AI–powered organization.
              Discover your highest-value next steps across your business domains with a personalized roadmap
              built from real-world deployments.
            </p>

            <div className="flex items-center justify-center">
              <button
                onClick={onStart}
                className="group inline-flex items-center gap-2 bg-lava hover:bg-lava-600 text-heading font-semibold px-7 py-3 rounded-lg transition-colors"
              >
                Start Assessment
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>

            <div className="mt-5 flex items-center justify-center gap-4">
              <p className="text-sm text-slate-500">
                <Clock className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                Takes approximately 5 minutes
              </p>
              <span className="text-slate-600">or</span>
              <button
                onClick={onViewRoadmap}
                className="text-sm text-electric hover:text-electric-300 font-medium transition-colors underline underline-offset-4 decoration-electric/30 hover:decoration-electric"
              >
                Explore the Full Roadmap
              </button>
            </div>
          </div>

          {/* My recent work — collapsed by default so other business units' names
              stay off screen during a presentation; expand for drafts + past assessments. */}
          {user?.email && ((drafts?.length || 0) > 0 || (myAssessments?.length || 0) > 0) && (
            <div className="mb-12 animate-slide-up">
              <button
                onClick={toggleRecent}
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg border border-navy-600 hover:border-navy-500 bg-navy-800/40 hover:bg-navy-700/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {showRecent ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                  <span className="text-sm font-medium text-heading">My recent work</span>
                  <span className="text-[11px] text-navy-400">
                    {(drafts?.length || 0)} in progress · {(myAssessments?.length || 0)} submitted
                  </span>
                </div>
                <span className="flex items-center gap-1.5 text-[11px] text-navy-400">
                  {showRecent ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  {showRecent ? 'Hide' : 'Show'}
                </span>
              </button>

              {deleteError && (
                <div className="mt-2 px-3 py-2 rounded-md bg-lava/10 border border-lava/30 text-xs text-lava-300">
                  {deleteError}
                </div>
              )}
              {exportError && (
                <div className="mt-2 px-3 py-2 rounded-md bg-lava/10 border border-lava/30 text-xs text-lava-300">
                  {exportError}
                </div>
              )}

              {showRecent && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="card p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-lava" />
                        <h3 className="text-sm font-semibold text-heading">In progress</h3>
                      </div>
                      <button onClick={reloadMyWork} className="text-navy-400 hover:text-heading" title="Refresh">
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {drafts && drafts.length > 0 ? (
                      <ul className="space-y-2">
                        {drafts.slice(0, 5).map((d) => (
                          <li key={d.id} className="flex items-center gap-2 group">
                            <button
                              onClick={() => onResumeDraft?.(d.id)}
                              className="flex-1 text-left p-2 rounded-md hover:bg-navy-700/60 transition-colors"
                            >
                              <div className="text-sm text-heading">{d.customer_name || '(untitled)'}</div>
                              <div className="text-[11px] text-navy-400">
                                Step {(d.current_step || 0) + 1} · last edited {timeago(d.updated_at)}
                              </div>
                            </button>
                            <button
                              onClick={() => deleteDraft(d.id)}
                              className="text-navy-400 hover:text-lava p-1"
                              title="Delete draft"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-navy-400">No drafts in progress. Start an assessment and your work auto-saves.</p>
                    )}
                  </div>

                  <div className="card p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-lava" />
                        <h3 className="text-sm font-semibold text-heading">My recent assessments</h3>
                      </div>
                    </div>
                    {myAssessments && myAssessments.length > 0 ? (
                      <ul className="space-y-2">
                        {myAssessments.slice(0, 5).map((a) => (
                          <li key={a.id} className="p-3 rounded-md hover:bg-navy-700/60 group">
                            <div className="flex min-w-0 flex-col gap-3">
                              <button
                                onClick={() => onViewAssessment?.(a.id)}
                                className="min-w-0 w-full text-left"
                                title="Open the rendered assessment"
                              >
                                <div className="text-sm leading-snug text-heading break-words hover:text-electric transition-colors">
                                  {a.customer_name}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-navy-400">
                                  <span>Phase {a.current_phase}</span>
                                  <span>score {a.overall_score}</span>
                                  <span>{timeago(a.created_at)}</span>
                                </div>
                              </button>
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                {onViewAssessment && (
                                  <button
                                    onClick={() => onViewAssessment(a.id)}
                                    className="inline-flex h-8 items-center gap-1 whitespace-nowrap text-[11px] px-2 py-1 rounded border border-electric/40 text-electric hover:bg-electric/15 hover:text-heading flex-shrink-0"
                                    title="Open the rendered assessment"
                                  >
                                    <ExternalLink className="w-3 h-3" /> View
                                  </button>
                                )}
                                {onEditAndRerun && (
                                  <button
                                    onClick={() => onEditAndRerun(a.id)}
                                    className="inline-flex h-8 items-center gap-1 whitespace-nowrap text-[11px] px-2 py-1 rounded border border-success-300/40 text-success-300 hover:bg-success-300/15 hover:text-heading flex-shrink-0"
                                    title="Load this assessment into the wizard, adjust, and resubmit as a new run"
                                  >
                                    <Edit3 className="w-3 h-3" /> Edit & re-run
                                  </button>
                                )}
                                {customerCounts[(a.customer_name || '').trim()] >= 2 && (
                                  <button
                                    onClick={() => setProgressionCustomer(a.customer_name)}
                                    className="inline-flex h-8 items-center gap-1 whitespace-nowrap text-[11px] px-2 py-1 rounded border border-electric/30 text-electric hover:bg-electric/10 flex-shrink-0"
                                    title={`See progression across ${customerCounts[(a.customer_name || '').trim()]} assessments for ${a.customer_name}`}
                                  >
                                    <GitCompare className="w-3 h-3" /> Progression
                                    <span className="bg-electric/20 px-1 rounded text-[9px]">{customerCounts[(a.customer_name || '').trim()]}</span>
                                  </button>
                                )}
                                <a
                                  href={api.pptxUrl(a.id)}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="inline-flex h-8 items-center whitespace-nowrap text-[11px] px-2 py-1 rounded border border-navy-500 text-navy-200 hover:text-heading hover:border-navy-400 flex-shrink-0"
                                  title="Download PowerPoint summary"
                                >
                                  PPTX
                                </a>
                                <button
                                  onClick={() => exportValueFlywheelPackage(a)}
                                  disabled={exportingAssessmentId === a.id}
                                  className="inline-flex h-8 items-center gap-1 whitespace-nowrap text-[11px] px-2 py-1 rounded border border-electric/30 text-electric hover:bg-electric/10 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                                  title="Download the JSON package for Value Flywheel import"
                                >
                                  {exportingAssessmentId === a.id
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <FileDown className="w-3 h-3" />}
                                  Export
                                </button>
                                <button
                                  onClick={() => deleteAssessment(a.id, a.customer_name)}
                                  className="inline-flex h-8 w-8 items-center justify-center text-navy-400 hover:text-lava flex-shrink-0"
                                  title="Delete assessment"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-navy-400">No submitted assessments yet.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* What You'll Get */}
          <div className="mt-16 border-t border-navy-600 pt-12 animate-slide-up">
            <h2 className="text-center text-lg font-semibold text-slate-300 mb-8">
              What you will receive
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <OutcomeCard
                icon={<Target className="w-5 h-5 text-electric" />}
                title="Maturity Score"
                description="Your current phase across 5 dimensions with detailed scoring"
              />
              <OutcomeCard
                icon={<ArrowRight className="w-5 h-5 text-status-green" />}
                title="Personalized Roadmap"
                description="Top 5 recommended next use cases ranked by readiness"
              />
              <OutcomeCard
                icon={<Users className="w-5 h-5 text-status-yellow" />}
                title="Peer Comparison"
                description="See how similar organizations have progressed on their journey"
              />
              <OutcomeCard
                icon={<Shield className="w-5 h-5 text-purple-400" />}
                title="Shareable Report"
                description="Export or share your results with stakeholders"
              />
            </div>
          </div>

          {/* Privacy note */}
          <div className="mt-12 card p-5 text-sm text-slate-400 leading-relaxed max-w-3xl mx-auto">
            <div className="flex items-start gap-3">
              <Shield className="w-4 h-4 text-lava mt-1 flex-shrink-0" />
              <div>
                <span className="text-heading font-medium">How we handle your answers.</span>{' '}
                Everything you enter is stored in your own Databricks workspace (Lakebase or Unity
                Catalog) and is visible only to members of the business unit and the app's
                administrators. Nothing is sent outside your workspace; AI features use your
                workspace's own model serving endpoints. Administrators can delete any submission.
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-navy-600 px-6 py-4">
        <div className="max-w-7xl mx-auto text-center text-xs text-slate-600">
          AI Value Flywheel · Powered by Databricks · Open-source reference app, not a supported Databricks product
        </div>
      </footer>

      {progressionCustomer && (
        <ProgressionPanel
          customerName={progressionCustomer}
          onClose={() => setProgressionCustomer(null)}
          onViewAssessment={onViewAssessment}
          onEditAndRerun={onEditAndRerun}
        />
      )}
      {showGuide && <UserGuideModal onClose={() => setShowGuide(false)} />}
    </div>
  );
};

function timeago(ts: string | null | undefined): string {
  if (!ts) return '';
  const t = new Date(ts).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function OutcomeCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center text-center p-4">
      <div className="w-10 h-10 rounded-lg bg-navy-700 border border-navy-500 flex items-center justify-center mb-3">
        {icon}
      </div>
      <div className="text-sm font-semibold text-heading mb-1">{title}</div>
      <div className="text-xs text-slate-500">{description}</div>
    </div>
  );
}
