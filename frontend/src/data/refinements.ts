/**
 * Refinements helpers — read-only accessors over `AssessmentAnswers.refinements`.
 *
 * The shape lives on `AssessmentAnswers` so it persists with the saved
 * assessment. Every scoring path (recommendations, strategic roadmap, value
 * engine, dependency resolution, data strategy) reads these accessors so a
 * refinement change in one place flows through the rest of the app
 * automatically.
 *
 * Scenario overlay: when `answers.activeScenarioId` is set and matches a
 * scenario in `answers.scenarios`, that scenario's refinements REPLACE the
 * base refinements for view + scoring purposes. Saving a scenario writes the
 * current live state out; loading a scenario rehydrates it.
 */
import type { AssessmentAnswers, RefinementAnswers, AssessmentScenario } from './questions';

/** Resolve the refinements to read at runtime — scenario override if active,
 *  otherwise the base `answers.refinements`. */
export function activeRefinements(answers: AssessmentAnswers): RefinementAnswers {
  if (answers.activeScenarioId) {
    const sc = (answers.scenarios || []).find(s => s.id === answers.activeScenarioId);
    if (sc?.refinements) return sc.refinements;
  }
  return answers.refinements || {};
}

export function getDiscardedSet(answers: AssessmentAnswers): Set<string> {
  return new Set(activeRefinements(answers).discardedUseCaseIds || []);
}

export function getOutOfScopeSet(answers: AssessmentAnswers): Set<string> {
  return new Set(activeRefinements(answers).outOfScopeUseCaseIds || []);
}

/** Union of discarded + out-of-scope. Both filter views identically; the
 *  distinction is purely about how the SA *thinks* about them and how they
 *  surface in the Refinements panel. */
export function getHiddenSet(answers: AssessmentAnswers): Set<string> {
  const out = new Set<string>();
  for (const id of activeRefinements(answers).discardedUseCaseIds || []) out.add(id);
  for (const id of activeRefinements(answers).outOfScopeUseCaseIds || []) out.add(id);
  return out;
}

export function getPinnedSet(answers: AssessmentAnswers): Set<string> {
  return new Set(activeRefinements(answers).pinnedUseCaseIds || []);
}

export function getBucketPins(answers: AssessmentAnswers): Record<string, number> {
  return activeRefinements(answers).bucketPins || {};
}

export function getNote(answers: AssessmentAnswers, ucId: string): string | undefined {
  return (activeRefinements(answers).notes || {})[ucId];
}

export function getValueOverride(answers: AssessmentAnswers, ucId: string):
  { annualValueLowMM?: number; annualValueHighMM?: number } | undefined {
  return (activeRefinements(answers).valueOverrides || {})[ucId];
}

/** Effective dependency list for a UC — catalog deps minus any `remove`
 *  override, plus any `add` override. The roadmap sequencer uses this when
 *  checking whether a UC's prerequisites are met. */
export function getEffectiveDependencies(answers: AssessmentAnswers, ucId: string, catalogDeps: string[]): string[] {
  const override = (activeRefinements(answers).dependencyOverrides || {})[ucId];
  if (!override) return catalogDeps;
  const removed = new Set(override.remove || []);
  const base = catalogDeps.filter(d => !removed.has(d));
  const added = (override.add || []).filter(d => !base.includes(d));
  return [...base, ...added];
}

// ─── Mutators — used by per-UC menus + the unified Refinements panel ────────


type SetRefinement = (next: RefinementAnswers) => void;

function _patch(answers: AssessmentAnswers, patch: Partial<RefinementAnswers>): RefinementAnswers {
  return { ...(answers.refinements || {}), ...patch };
}

/** Discard / undiscard. Idempotent. */
export function toggleDiscard(answers: AssessmentAnswers, ucId: string, set: SetRefinement): void {
  const cur = new Set(answers.refinements?.discardedUseCaseIds || []);
  if (cur.has(ucId)) cur.delete(ucId);
  else cur.add(ucId);
  set(_patch(answers, { discardedUseCaseIds: Array.from(cur) }));
}

export function setDiscarded(answers: AssessmentAnswers, ucIds: string[], set: SetRefinement): void {
  set(_patch(answers, { discardedUseCaseIds: Array.from(new Set(ucIds)) }));
}

/** Mark / unmark as out-of-scope. Idempotent. */
export function toggleOutOfScope(answers: AssessmentAnswers, ucId: string, set: SetRefinement): void {
  const cur = new Set(answers.refinements?.outOfScopeUseCaseIds || []);
  if (cur.has(ucId)) cur.delete(ucId);
  else cur.add(ucId);
  set(_patch(answers, { outOfScopeUseCaseIds: Array.from(cur) }));
}

/** Pin / unpin to top-of-recommendations. Idempotent. */
export function togglePin(answers: AssessmentAnswers, ucId: string, set: SetRefinement): void {
  const cur = new Set(answers.refinements?.pinnedUseCaseIds || []);
  if (cur.has(ucId)) cur.delete(ucId);
  else cur.add(ucId);
  set(_patch(answers, { pinnedUseCaseIds: Array.from(cur) }));
}

export function setBucketPin(answers: AssessmentAnswers, ucId: string, bucketIdx: number | null, set: SetRefinement): void {
  const cur = { ...(answers.refinements?.bucketPins || {}) };
  if (bucketIdx === null) delete cur[ucId];
  else cur[ucId] = bucketIdx;
  set(_patch(answers, { bucketPins: cur }));
}

export function setNote(answers: AssessmentAnswers, ucId: string, text: string | null, set: SetRefinement): void {
  const cur = { ...(answers.refinements?.notes || {}) };
  if (!text || !text.trim()) delete cur[ucId];
  else cur[ucId] = text;
  set(_patch(answers, { notes: cur }));
}

export function setValueOverride(
  answers: AssessmentAnswers,
  ucId: string,
  override: { annualValueLowMM?: number; annualValueHighMM?: number } | null,
  set: SetRefinement,
): void {
  const cur = { ...(answers.refinements?.valueOverrides || {}) };
  if (override === null) delete cur[ucId];
  else cur[ucId] = override;
  set(_patch(answers, { valueOverrides: cur }));
}

export function setDependencyOverride(
  answers: AssessmentAnswers,
  ucId: string,
  override: { add?: string[]; remove?: string[] } | null,
  set: SetRefinement,
): void {
  const cur = { ...(answers.refinements?.dependencyOverrides || {}) };
  if (override === null) delete cur[ucId];
  else cur[ucId] = override;
  set(_patch(answers, { dependencyOverrides: cur }));
}

// ─── Scenario helpers ──────────────────────────────────────────────────────


export function getActiveScenario(answers: AssessmentAnswers): AssessmentScenario | null {
  if (!answers.activeScenarioId) return null;
  return (answers.scenarios || []).find(s => s.id === answers.activeScenarioId) || null;
}

// ─── Scenario CRUD ─────────────────────────────────────────────────────────

type SetAnswers = (next: AssessmentAnswers) => void;

function _genScenarioId(): string {
  return `scn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Snapshot the current base refinements as a new named scenario. Optionally
 *  capture the roadmap-control dials (horizon / investment / SI selection /
 *  accelerator toggle) so re-activating the scenario restores them too.
 *  The new scenario becomes the active one. Returns the new scenario id. */
export function saveScenarioFromCurrent(
  answers: AssessmentAnswers,
  name: string,
  set: SetAnswers,
  opts?: { description?: string; controls?: AssessmentScenario['controls'] },
): string {
  const id = _genScenarioId();
  const scn: AssessmentScenario = {
    id,
    name: name.trim() || 'Untitled scenario',
    description: opts?.description?.trim() || undefined,
    createdAt: new Date().toISOString(),
    refinements: { ...(answers.refinements || {}) },
    controls: opts?.controls,
  };
  set({
    ...answers,
    scenarios: [...(answers.scenarios || []), scn],
    activeScenarioId: id,
  });
  return id;
}

export function deleteScenario(answers: AssessmentAnswers, scenarioId: string, set: SetAnswers): void {
  const remaining = (answers.scenarios || []).filter(s => s.id !== scenarioId);
  const nextActive = answers.activeScenarioId === scenarioId ? null : answers.activeScenarioId;
  set({ ...answers, scenarios: remaining, activeScenarioId: nextActive });
}

export function renameScenario(answers: AssessmentAnswers, scenarioId: string, name: string, set: SetAnswers): void {
  const next = (answers.scenarios || []).map(s =>
    s.id === scenarioId ? { ...s, name: name.trim() || s.name } : s
  );
  set({ ...answers, scenarios: next });
}

/** Activate a scenario (or pass `null` to return to the base assessment). */
export function setActiveScenario(answers: AssessmentAnswers, scenarioId: string | null, set: SetAnswers): void {
  set({ ...answers, activeScenarioId: scenarioId });
}

/** Duplicate a scenario, append " (copy)" to its name, and activate the copy. */
export function duplicateScenario(answers: AssessmentAnswers, scenarioId: string, set: SetAnswers): string | null {
  const src = (answers.scenarios || []).find(s => s.id === scenarioId);
  if (!src) return null;
  const id = _genScenarioId();
  const copy: AssessmentScenario = {
    ...src,
    id,
    name: `${src.name} (copy)`,
    createdAt: new Date().toISOString(),
    refinements: src.refinements ? { ...src.refinements } : undefined,
    controls: src.controls ? { ...src.controls } : undefined,
  };
  set({
    ...answers,
    scenarios: [...(answers.scenarios || []), copy],
    activeScenarioId: id,
  });
  return id;
}

/** "Promote" a scenario into the base: copy its refinements onto
 *  `answers.refinements` and clear the active scenario id. Leaves the scenario
 *  itself in place so the user can still go back. */
export function commitScenarioToBase(answers: AssessmentAnswers, scenarioId: string, set: SetAnswers): void {
  const src = (answers.scenarios || []).find(s => s.id === scenarioId);
  if (!src) return;
  set({
    ...answers,
    refinements: { ...(src.refinements || {}) },
    activeScenarioId: null,
  });
}

/** Count of every kind of refinement currently in effect. Drives the
 *  "Refinements (N)" header pill. */
export function countRefinements(answers: AssessmentAnswers): number {
  const r = activeRefinements(answers);
  return (r.discardedUseCaseIds?.length || 0)
    + (r.outOfScopeUseCaseIds?.length || 0)
    + (r.pinnedUseCaseIds?.length || 0)
    + Object.keys(r.bucketPins || {}).length
    + Object.keys(r.notes || {}).length
    + Object.keys(r.valueOverrides || {}).length
    + Object.keys(r.dependencyOverrides || {}).length;
}
