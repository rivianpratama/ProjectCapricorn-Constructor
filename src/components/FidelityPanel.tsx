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

  const busy = state === 'running' || state === 'revising';
  return (
    <section className="panel">
      <div className="head">
        <h2 className="eyebrow">Fidelity</h2>
        <div className="row">
          {revised ? <span className="chip"><i style={{ background: 'var(--g)' }} />revised once</span> : null}
          <button
            className="small"
            disabled={busy || !pairs.length}
            onClick={() => {
              setState('running');
              void measure(files, true);
            }}
          >
            {state === 'running' ? 'Measuring…' : state === 'revising' ? 'Revising…' : result ? 'Measure again' : 'Measure'}
          </button>
        </div>
      </div>
      {result ? (
        <>
          <div className="tiles" style={{ border: 0, borderRadius: 0 }}>
            <div className="stat">
              <b>{result.likeness.realPicked}<small> / {result.likeness.total}</small></b>
              <span>real picked</span>
              <small className="sub">voice {result.likeness.voice} · move {result.likeness.move} · fit {result.likeness.emotion}</small>
            </div>
            <div className="stat">
              <b>{result.generalisation.score}<small> / 5</small></b>
              <span>unseen situations</span>
            </div>
            <div className="stat">
              <b>{Math.round(result.parroting.overlap * 100)}<small>%</small></b>
              <span>copied</span>
              <small className="sub">{Math.round(result.parroting.openerDistinctness * 100)}% distinct openers</small>
            </div>
          </div>
          {result.verdict.revise.length ? (
            <div className="note err">Still failing: {result.verdict.revise.join(', ')}</div>
          ) : null}
        </>
      ) : null}
      {error ? <div className="note err">{error}</div> : null}
    </section>
  );
}
