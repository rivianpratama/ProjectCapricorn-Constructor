/** Reasoning efforts OpenRouter accepts, weakest to strongest. Shared by the server and the picker. */
export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type ReasoningEffort = (typeof EFFORTS)[number];

export function isEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value);
}
