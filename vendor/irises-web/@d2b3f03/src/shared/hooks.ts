import type { HookKind } from './types';

export function pushHook(trail: readonly (HookKind | null)[], kind: HookKind | null): (HookKind | null)[] {
  return [...trail, kind].slice(-3);
}

/** Irises' kill switch: three hooked replies in a row force the next one quiet. */
export function quietForced(trail: readonly (HookKind | null)[]): boolean {
  return trail.length >= 3 && trail.slice(-3).every(k => k !== null);
}
