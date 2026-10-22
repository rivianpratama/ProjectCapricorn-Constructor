'use client';

import { useRef } from 'react';
import type { Draft } from '../lib/client/drafts';
import { RELATIONSHIPS, participantCount, rangeDates } from '../lib/client/drafts';

interface Props {
  draft: Draft;
  index: number;
  onChange: (draft: Draft) => void;
  onRemove: () => void;
  locked?: boolean;
}

export function ChatCard({ draft, index, onChange, onRemove, locked }: Props) {
  const dates = rangeDates(draft);
  return (
    <div className="chatcard">
      <div className="top">
        <div className="row" style={{ minWidth: 0, flexWrap: 'nowrap' }}>
          <span className="chip"><i style={{ background: 'var(--accent)' }} />chat-{index + 1}</span>
          <b title={draft.fileName}>{draft.fileName}</b>
        </div>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <span className="count">{draft.messages.length.toLocaleString()} msgs</span>
          <button className="small ghost close" onClick={onRemove} disabled={locked} aria-label={`Remove ${draft.fileName}`}>✕</button>
        </div>
      </div>
      <div className="inner">
        <div>
          <span className="lbl">Subject</span>
          <div className="pick">
            {draft.participants.map(name => (
              <button
                key={name}
                disabled={locked}
                className={draft.subject === name ? 'on' : ''}
                onClick={() => onChange({ ...draft, subject: name })}
              >
                {name}
                <span className="count">{participantCount(draft, name)}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <Sparkline draft={draft} onChange={onChange} />
          <div className="dates" style={{ marginTop: 8 }}>
            <span>{dates.start}</span>
            <span>{dates.end}</span>
          </div>
        </div>

        <div>
          <span className="lbl">Relationship</span>
          <div className="pick">
            {RELATIONSHIPS.map(relationship => (
              <button
                key={relationship}
                disabled={locked}
                className={draft.relationship === relationship ? 'on' : ''}
                onClick={() => onChange({ ...draft, relationship })}
              >
                {relationship}
              </button>
            ))}
          </div>
        </div>

        {draft.error ? <span className="err">{draft.error}</span> : null}
      </div>
    </div>
  );
}

function Sparkline({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<'from' | 'to' | null>(null);
  const count = draft.messages.length;
  const buckets = 72;
  const bars = density(draft, buckets);
  const max = Math.max(1, ...bars);
  const at = (event: React.PointerEvent) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return 0;
    return clamp(Math.round(((event.clientX - rect.left) / rect.width) * (count - 1)), 0, count - 1);
  };
  const move = (event: React.PointerEvent) => {
    if (!dragging.current) return;
    const value = at(event);
    if (dragging.current === 'from') onChange({ ...draft, from: Math.min(value, draft.to) });
    else onChange({ ...draft, to: Math.max(value, draft.from) });
  };
  const pct = (value: number) => (count <= 1 ? 0 : (value / (count - 1)) * 100);

  return (
    <div
      ref={track}
      style={{ position: 'relative', height: 44, touchAction: 'none', cursor: 'pointer', background: 'var(--well)', borderRadius: 6 }}
      onPointerMove={move}
      onPointerUp={() => {
        dragging.current = null;
      }}
      onPointerLeave={() => {
        dragging.current = null;
      }}
    >
      <div className="spark" style={{ position: 'absolute', inset: 0 }}>
        {bars.map((value, i) => (
          <i key={i} style={{ height: `${Math.max(6, (value / max) * 100)}%`, opacity: 0.5 }} />
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${pct(draft.from)}%`,
          right: `${100 - pct(draft.to)}%`,
          background: 'rgba(229,69,47,0.08)',
          borderLeft: '2px solid var(--accent)',
          borderRight: '2px solid var(--accent)',
        }}
      />
      {(['from', 'to'] as const).map(handle => (
        <div
          key={handle}
          role="slider"
          aria-label={handle === 'from' ? 'Start of range' : 'End of range'}
          aria-valuemin={0}
          aria-valuemax={count - 1}
          aria-valuenow={draft[handle]}
          tabIndex={0}
          onPointerDown={event => {
            dragging.current = handle;
            (event.target as HTMLElement).setPointerCapture(event.pointerId);
          }}
          onKeyDown={event => {
            const step = event.shiftKey ? 20 : 1;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              const delta = event.key === 'ArrowLeft' ? -step : step;
              if (handle === 'from') onChange({ ...draft, from: clamp(draft.from + delta, 0, draft.to) });
              else onChange({ ...draft, to: clamp(draft.to + delta, draft.from, count - 1) });
            }
          }}
          style={{
            position: 'absolute',
            top: -4,
            left: `calc(${pct(draft[handle])}% - 6px)`,
            width: 12,
            height: 52,
            cursor: 'ew-resize',
          }}
        >
          <i
            style={{
              display: 'block',
              width: 3,
              height: 44,
              margin: '6px auto 0',
              borderRadius: 2,
              background: 'var(--accent)',
            }}
          />
        </div>
      ))}
    </div>
  );
}

function density(draft: Draft, buckets: number): number[] {
  const out = new Array<number>(buckets).fill(0);
  const count = draft.messages.length;
  if (!count) return out;
  draft.messages.forEach((_, i) => {
    const bucket = Math.min(buckets - 1, Math.floor((i / count) * buckets));
    out[bucket] += 1;
  });
  return out;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
