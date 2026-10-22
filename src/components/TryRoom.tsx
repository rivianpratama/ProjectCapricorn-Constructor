'use client';

import { useEffect, useRef, useState } from 'react';
import { api, keyStore, packStore } from '../lib/client/api';
import { useModels } from '../lib/client/useModels';
import { KeyPanel, ModelsPanel, useOpenPanels } from './Settings';

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
  const end = useRef<HTMLDivElement>(null);
  const modelState = useModels();
  const panels = useOpenPanels({ key: false, models: true });

  useEffect(() => {
    setFiles(packStore.get());
    setKey(keyStore.get());
    input.current?.focus();
  }, []);

  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [turns, sending]);

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

  return (
    <main className="wrap">
      {header}
      <div className="grid">
        <div className="stack rail">
          <KeyPanel value={key} onChange={setKey} open={panels.open.key || !key} onToggle={panels.toggle} />
          <ModelsPanel state={modelState} open={panels.open.models} onToggle={panels.toggle} only="strong" />
          <div className="actions">
            <button className="ghost" disabled={!turns.length || sending} onClick={() => { setTurns([]); setError(''); }}>Clear chat</button>
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
                  </div>
                ))}
                {sending ? <span className="muted">typing…</span> : null}
                {error ? <span className="err">{error}</span> : null}
                <div ref={end} />
              </div>
            </div>
            <div className="composer">
              <input
                ref={input}
                type="text"
                className="grow"
                value={text}
                placeholder="Say something"
                onChange={event => setText(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') void send();
                }}
              />
              <button className="primary" disabled={!text.trim() || sending || !key} onClick={() => void send()}>Send</button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
