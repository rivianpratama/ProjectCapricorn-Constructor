'use client';

import { useEffect, useRef, useState } from 'react';
import {
  answerInMs,
  joinRun,
  quietFor,
  rememberGap,
  type AffectState,
  type HookKind,
  type TurnInfo,
} from '../../vendor/irises-web/current-shared';
import { api, keyStore, packStore } from '../lib/client/api';
import { useModels } from '../lib/client/useModels';
import { KeyPanel, ModelsPanel, useOpenPanels } from './Settings';

/** The shape `/api/try` answers with: the bubbles, the state they left, and what they cost. */
interface Reply {
  bubbles: string[];
  status: { mood_label?: string; mood_shift?: string; hook_kind?: HookKind | null } | null;
  state: AffectState;
  turn: TurnInfo;
  usage: { prompt: number; completion: number };
}

interface Turn {
  role: 'them' | 'you';
  bubbles: string[];
  usage?: { prompt: number; completion: number };
}

interface HistoryItem {
  role: 'them' | 'you';
  text: string;
}

const SHIFT: Record<string, string> = { lifted: '\u2191', steady: '\u2192', dipped: '\u2193', broke: '\u21ca' };
const COUNT = new Intl.NumberFormat('en-US');
/** A reply with no bubbles is a real, quiet turn: it replays as the page's own empty marker. */
const NO_REPLY = '...';

export function TryRoom() {
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [key, setKey] = useState('');
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState<AffectState | null>(null);
  const [info, setInfo] = useState<TurnInfo | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const modelState = useModels();
  const panels = useOpenPanels({ key: false, models: true });

  // The demo page's waiting: a run of theirs, and the quiet it needs before she answers.
  const run = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activity = useRef(0);
  const gaps = useRef<number[]>([]);
  const sentAt = useRef<number | null>(null);
  const drafting = useRef(false);
  const busy = useRef(false);
  const history = useRef<HistoryItem[]>([]);
  const shown = useRef<Turn[]>([]);
  const live = useRef<AffectState | null>(null);

  useEffect(() => {
    setFiles(packStore.get());
    setKey(keyStore.get());
    input.current?.focus();
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns, sending]);
  useEffect(() => {
    return () => clearTimeout(timer.current);
  }, []);

  function push(turn: Turn): void {
    shown.current = [...shown.current, turn];
    setTurns(shown.current);
  }

  /** Waits out the quiet window IrisesWeb waits out, with the rhythm it learned from them. */
  function arm(): void {
    clearTimeout(timer.current);
    if (!run.current.length || busy.current) return;
    const now = Date.now();
    const wait = answerInMs({
      lastActivityAt: activity.current,
      now,
      drafting: drafting.current,
      quietMs: quietFor(gaps.current),
    });
    timer.current = setTimeout(() => void flush(), wait);
  }

  async function flush(): Promise<void> {
    clearTimeout(timer.current);
    const runTexts = run.current;
    if (!runTexts.length || busy.current || !files) return;
    run.current = [];
    const message = joinRun(runTexts);
    busy.current = true;
    setSending(true);
    setError('');
    const past = history.current;
    history.current = [...past, { role: 'them', text: message }];
    try {
      const reply = await api<Reply>('/api/try', keyStore.get(), {
        files,
        text: message,
        state: live.current,
        history: past,
      });
      live.current = reply.state;
      setState(reply.state);
      setInfo(reply.turn);
      push({ role: 'you', bubbles: reply.bubbles, usage: reply.usage });
      history.current = [...history.current, { role: 'you', text: reply.bubbles.join('\n') || NO_REPLY }];
    } catch (failure) {
      history.current = past;
      setError(failure instanceof Error ? failure.message : 'no reply');
    } finally {
      busy.current = false;
      setSending(false);
      input.current?.focus();
      arm();
    }
  }

  function submit(): void {
    const value = text.trim();
    if (!value || !files) return;
    setText('');
    push({ role: 'them', bubbles: [value] });
    run.current = [...run.current, value];
    activity.current = Date.now();
    sentAt.current = Date.now();
    drafting.current = false;
    arm();
  }

  /** A keystroke while the run waits: they are not done, so the wait restarts. */
  function typed(value: string): void {
    setText(value);
    if (!run.current.length) return;
    const now = Date.now();
    if (sentAt.current !== null) {
      gaps.current = rememberGap(gaps.current, now - sentAt.current);
      sentAt.current = null;
    }
    drafting.current = value.trim().length > 0;
    activity.current = now;
    arm();
  }

  function clear(): void {
    clearTimeout(timer.current);
    run.current = [];
    gaps.current = [];
    sentAt.current = null;
    drafting.current = false;
    history.current = [];
    shown.current = [];
    live.current = null;
    setTurns([]);
    setState(null);
    setInfo(null);
    setError('');
  }

  const header = (
    <header className="masthead">
      <div className="wordmark">
        <h1>Constructinator</h1>
      </div>
      <div className="row">
        <span className={`status ${sending ? 'painting' : ''}`}><i /> {sending ? 'typing' : files ? 'ready' : 'no pack'}</span>
        <a className="iconbtn" href="/" style={{ textDecoration: 'none' }}>← Workbench</a>
      </div>
    </header>
  );

  if (!files) {
    return (
      <main className="wrap">
        {header}
        <section className="panel">
          <div className="body">
            <b>No pack in this tab.</b>
            <div style={{ height: 12 }} />
            <a href="/"><button className="primary">Open the workbench</button></a>
          </div>
        </section>
      </main>
    );
  }

  const trail = state?.hookTrail ?? [];
  const cap = info?.bubbleCap ?? 0;

  return (
    <main className="wrap">
      {header}
      <div className="grid">
        <div className="stack rail">
          <KeyPanel value={key} onChange={setKey} open={panels.open.key || !key} onToggle={panels.toggle} />
          <ModelsPanel state={modelState} open={panels.open.models} onToggle={panels.toggle} only="strong" />
          <div className="actions">
            <button className="ghost" disabled={!turns.length || sending} onClick={clear}>Clear chat</button>
          </div>
        </div>

        <div className="stack work">
          <section className="panel fill">
            <div className="head">
              <h2 className="eyebrow">Chat</h2>
            </div>
            <div className="scroll">
              <div className="chat">
                {turns.map((turn, index) => (
                  <div key={index} className={`bubbles ${turn.role}`}>
                    {turn.bubbles.map((bubble, i) => <div key={i} className="bubble">{bubble}</div>)}
                    {turn.role === 'you' && turn.usage && (turn.usage.prompt || turn.usage.completion) ? (
                      <span className="tokens">↑ {COUNT.format(turn.usage.prompt)} · ↓ {COUNT.format(turn.usage.completion)}</span>
                    ) : null}
                  </div>
                ))}
                {sending ? <span className="muted">typing…</span> : null}
                {error ? <span className="err">{error}</span> : null}
                <div ref={end} />
              </div>
            </div>

            <div className="state">
              {state?.moodLabel ? <span className="mood">{state.moodLabel}</span> : null}
              {state?.moodLabel ? <span className="shift">{SHIFT[state.moodShift] ?? SHIFT.steady}</span> : null}
              {trail.length ? (
                <span className="hooks">
                  {trail.map((kind, index) => (
                    <span key={`${index}-${kind}`} className={kind ? 'hook' : 'hook off'}>{kind ?? '·'}</span>
                  ))}
                </span>
              ) : null}
              {cap ? (
                <span className="caps">
                  {[0, 1, 2].map(index => <i key={index} className={index < cap ? 'dot on' : 'dot'} />)}
                </span>
              ) : null}
            </div>

            <div className="composer">
              <input
                ref={input}
                type="text"
                className="grow"
                value={text}
                placeholder="Say something"
                onChange={event => typed(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') submit();
                }}
              />
              <button className="primary" disabled={!text.trim() || !key} onClick={submit}>Send</button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
