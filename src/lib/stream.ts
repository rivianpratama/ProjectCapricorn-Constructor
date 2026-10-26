/**
 * What a streamed request sends the browser, one JSON object per line. `call` numbers the model
 * calls inside one request: a route may make several (a retry, a repair turn).
 */
export type StreamEvent =
  | { type: 'start'; call: number; model: string; effort?: string }
  | { type: 'reasoning'; call: number; text: string }
  | { type: 'answer'; call: number; text: string }
  | { type: 'end'; call: number; ms: number; completion?: number; reasoning?: number; finish?: string; error?: string }
  | { type: 'ping' }
  | { type: 'result'; status: number; body: unknown };
