/**
 * Blend presets — module-level cache + hook. Same pattern as the industries
 * cache so any component that opens the blend picker has the latest list.
 */
import { useSyncExternalStore } from 'react';
import type { BlendPreset } from '../components/IndustryBlendPicker';

let _presets: BlendPreset[] = [];
const _listeners = new Set<() => void>();

function notify(): void {
  for (const fn of _listeners) try { fn(); } catch { /* swallow */ }
}

export function setBlendPresets(list: BlendPreset[]): void {
  _presets = list || [];
  notify();
}

export function getBlendPresets(): BlendPreset[] {
  return _presets;
}

function _subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

export function useBlendPresets(): BlendPreset[] {
  return useSyncExternalStore(_subscribe, getBlendPresets, getBlendPresets);
}
