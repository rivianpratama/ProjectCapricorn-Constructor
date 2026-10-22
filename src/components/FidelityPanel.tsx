'use client';

import { useState } from 'react';
import { api, keyStore } from '../lib/client/api';
import type { HeldOutPair } from '../lib/chats/types';

interface Likeness {
  realPicked: number;
  total: number;
  voice: number;
  move: number;
  emotion: number;
  skipped: number;
}

interface FidelityResponse {
  likeness: Likeness;
  generalisation: { score: number; judged: number; missed: string[] };
  parroting: { overlap: number; openerDistinctness: number; openers: string[] };
  verdict: { likeness: boolean; generalisation: boolean; parroting: boolean; revise: Array<'generalisation' | 'parroting'> };
}

interface Props {
  files: Record<string, string>;
  drives: string[];
  pairs: HeldOutPair[];
  subjectMessages: string[];
  sketches: string[];
  removedTraits: string[];
  onRevise: (fixes: string[]) => Promise<Record<string, string> | null>;
}

const FIXES = {
  generalisation:
    'The eight novel situations did not follow from the drives. Rewrite the L1 and L2 sections so every unseen situation has a reason to act, and state the novelty rule plainly.',
  parroting:
    'The soul parrots the parents and opens every reply the same way. Replace copied phrasing with the underlying reason, widen the opener range and cut anything that only makes sense as a replay.',
};

export function FidelityPanel({ files, drives, pairs, subjectMessages, sketches, removedTraits, onRevise }: Props) {
  const [state, setState] = useState<'idle' | 'running' | 'revising' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<FidelityResponse | null>(null);
  const [error, setError] = useState('');
  const [revised, setRevised] = useState(false);

  async function measure(current: Record<string, string>, allowRevision: boolean) {
    setError('');
    try {
      const response = await api<FidelityResponse>('/api/fidelity', keyStore.get(), {
        files: current,
        drives,
        pairs: pairs.map(pair => ({ stimulus: pair.stimulus, reply: pair.reply })),
        subjectMessages,
        sketches,
        removedTraits,
      });
      if (allowRevision && response.verdict.revise.length && !revised) {
        setState('revising');
        const next = await onRevise(response.verdict.revise.map(axis => FIXES[axis]));
        if (!next) throw new Error('revision failed');
        setRevised(true);
        return measure(next, false);
      }
      setResult(response);
      setState('done');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'measurement failed');
      setState('error');
    }
  }

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>Fidelity</b>
        <button
          disabled={state === 'running' || state === 'revising' || !pairs.length}
          onClick={() => {
            setState('running');
            void measure(files, true);
          }}
        >
          {state === 'running' ? 'measuring' : state === 'revising' ? 'revising' : 'Measure'}
        </button>
      </div>

      {result ? (
        <>
          <div className="tiles">
            <div className="tile">
              <b>{result.likeness.realPicked}/{result.likeness.total}</b>
              <span className="muted">real picked</span>
              <span className="muted">voice {result.likeness.voice} · move {result.likeness.move} · fit {result.likeness.emotion}</span>
            </div>
            <div className="tile">
              <b>{result.generalisation.score}/5</b>
              <span className="muted">unseen situations</span>
            </div>
            <div className="tile">
              <b>{Math.round(result.parroting.overlap * 100)}%</b>
              <span className="muted">copied · {Math.round(result.parroting.openerDistinctness * 100)}% openers</span>
            </div>
          </div>
          {result.verdict.revise.length ? (
            <span className="bad">still failing: {result.verdict.revise.join(', ')}</span>
          ) : null}
          {revised ? <span className="muted">revised once</span> : null}
        </>
      ) : null}

      {error ? <span className="bad">{error}</span> : null}
    </div>
  );
}
