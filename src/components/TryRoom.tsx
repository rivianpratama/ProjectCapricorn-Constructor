'use client';

import { useEffect, useRef, useState } from 'react';
import { api, keyStore, packStore } from '../lib/client/api';

interface Turn {
  role: 'them' | 'you';
  bubbles: string[];
  text?: string;
}

export function TryRoom() {
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [key, setKey] = useState('');
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFiles(packStore.get());
    setKey(keyStore.get());
    input.current?.focus();
  }, []);

  async function send() {
    const value = text.trim();
    if (!value || !files || sending) return;
    setText('');
    setError('');
    setSending(true);
    const history = turns.flatMap(turn => turn.bubbles.map(bubble => ({ role: turn.role, text: bubble })));
    setTurns(current => [...current, { role: 'them', bubbles: [value] }]);
    try {
      const response = await api<{ bubbles: string[] }>('/api/try', keyStore.get(), {
        files,
        text: value,
        history,
        seed: turns.length * 13 + 7,
      });
      setTurns(current => [...current, { role: 'you', bubbles: response.bubbles }]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'no reply');
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  if (!files) {
    return (
      <main>
        <p className="muted">No pack in this tab. <a href="/">Build one.</a></p>
      </main>
    );
  }

  return (
    <main>
      <h1>Try</h1>
      {!key ? (
        <div className="row" style={{ marginBottom: 16 }}>
          <input
            type="password"
            value={key}
            placeholder="sk-or-…"
            onChange={event => {
              setKey(event.target.value);
              keyStore.set(event.target.value);
            }}
            style={{ flex: 1 }}
          />
        </div>
      ) : null}

      <div className="stack" style={{ minHeight: 320 }}>
        {turns.map((turn, index) => (
          <div key={index} className="bubbles" style={{ alignItems: turn.role === 'them' ? 'flex-end' : 'flex-start' }}>
            {turn.bubbles.map((bubble, i) => (
              <div key={i} className={`bubble ${turn.role === 'them' ? 'mine' : ''}`}>{bubble}</div>
            ))}
          </div>
        ))}
        {sending ? <span className="muted">typing…</span> : null}
        {error ? <span className="bad">{error}</span> : null}
      </div>

      <div className="row" style={{ marginTop: 20 }}>
        <input
          ref={input}
          value={text}
          placeholder="say something"
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') void send();
          }}
          style={{ flex: 1 }}
        />
        <button className="primary" disabled={!text.trim() || sending} onClick={() => void send()}>Send</button>
      </div>
    </main>
  );
}
