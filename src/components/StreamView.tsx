'use client';

import { useEffect, useRef, useState } from 'react';
import type { StreamCall } from '../lib/client/useStream';

const short = (id: string) => id.split('/').pop() ?? id;

function seconds(ms?: number): string {
  return ms === undefined ? '' : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

/** Follows the text to its end while the reader has not scrolled away from it. */
function Tail({ text, empty }: { text: string; empty: string }) {
  const box = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <div
      ref={box}
      className={`tail ${text ? '' : 'idle'}`}
      onScroll={event => {
        const el = event.currentTarget;
        stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {text || empty}
    </div>
  );
}

export function StreamView({ calls }: { calls: StreamCall[] }) {
  const [picked, setPicked] = useState('');
  // Until one is chosen, follow the newest call, so a run reads like a live feed.
  const call = calls.find(item => item.id === picked) ?? calls[calls.length - 1];

  if (!call) return <div className="tail idle">{' '}</div>;

  return (
    <div className="streamview">
      <div className="note">
        <select value={call.id} onChange={event => setPicked(event.target.value === calls[calls.length - 1].id ? '' : event.target.value)}>
          {calls.map(item => (
            <option key={item.id} value={item.id}>
              {item.state === 'live' ? '● ' : item.state === 'failed' ? '✕ ' : ''}
              {item.label} · {short(item.model)}
            </option>
          ))}
        </select>
        <span className="mono muted">
          {[
            call.effort,
            call.reasoningTokens ? `${call.reasoningTokens} thinking` : '',
            call.tokens ? `${call.tokens} out` : '',
            seconds(call.ms),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <div className="lane thinking">
        <h3 className="eyebrow">Reasoning</h3>
        <Tail text={call.reasoning} empty={call.state === 'live' ? '…' : ''} />
      </div>
      <div className="lane">
        <h3 className="eyebrow">Answer</h3>
        <Tail text={call.answer} empty={call.state === 'live' ? '…' : ''} />
      </div>
      {call.error ? <div className="note err">{call.error}</div> : null}
    </div>
  );
}
