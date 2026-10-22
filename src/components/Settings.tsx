'use client';

import { useState } from 'react';
import { api, keyStore } from '../lib/client/api';
import type { useModels } from '../lib/client/useModels';
import { ModelPicker } from './ModelPicker';
import { Panel } from './ui';

export function useOpenPanels(initial: Record<string, boolean>) {
  const [open, setOpen] = useState(initial);
  return { open, toggle: (id: string) => setOpen(current => ({ ...current, [id]: !current[id] })) };
}

export function KeyPanel({
  value,
  onChange,
  open,
  onToggle,
  disabled,
}: {
  value: string;
  onChange: (key: string) => void;
  open: boolean;
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(() => keyStore.remembered());
  const [state, setState] = useState<'idle' | 'checking' | 'ok' | 'bad'>('idle');

  async function check() {
    if (value.trim().length < 20) return;
    setState('checking');
    try {
      await api('/api/key', value, {});
      setState('ok');
      keyStore.set(value, remember);
    } catch {
      setState('bad');
    }
  }

  const summary = state === 'bad' ? 'key rejected' : value ? (state === 'ok' ? 'key verified' : 'key set') : 'no key yet';

  return (
    <Panel id="key" title="OpenRouter key" open={open} onToggle={onToggle} summary={summary}>
      <div className="field">
        <label htmlFor="key">API key</label>
        <div className="row">
          <input
            id="key"
            className="mono grow"
            type={show ? 'text' : 'password'}
            value={value}
            disabled={disabled}
            placeholder="sk-or-…"
            autoComplete="off"
            spellCheck={false}
            onChange={event => {
              onChange(event.target.value);
              setState('idle');
              keyStore.set(event.target.value, remember);
            }}
            onBlur={() => void check()}
          />
          <button className="small ghost" type="button" onClick={() => setShow(v => !v)}>
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        {state === 'bad' ? <span className="hint err">Rejected</span> : null}
      </div>
      <label className="check" htmlFor="remember">
        <input
          id="remember"
          type="checkbox"
          checked={remember}
          onChange={event => {
            setRemember(event.target.checked);
            keyStore.set(value, event.target.checked);
          }}
        />
        <span>Remember</span>
      </label>
    </Panel>
  );
}

export function ModelsPanel({
  state,
  open,
  onToggle,
  disabled,
  only,
}: {
  state: ReturnType<typeof useModels>;
  open: boolean;
  onToggle: (id: string) => void;
  disabled?: boolean;
  only?: 'strong';
}) {
  const { models, defaults, loading, failed, choice, update } = state;
  const short = (id: string) => id.split('/').pop() ?? id;
  const strong = choice.strong || defaults.strong;
  const cheap = choice.cheap || defaults.cheap;
  return (
    <Panel
      id="models"
      title="Models"
      open={open}
      onToggle={onToggle}
      summary={only ? short(strong) : `${short(cheap)} · ${short(strong)}`}
    >
      {!only ? (
        <ModelPicker
          id="model-cheap"
          label="Bulk"
          value={choice.cheap}
          fallback={defaults.cheap}
          models={models}
          loading={loading}
          disabled={disabled}
          onChange={value => update({ cheap: value })}
        />
      ) : null}
      <div style={{ height: only ? 0 : 14 }} />
      <ModelPicker
        id="model-strong"
        label={only ? 'Model' : 'Synthesis'}
        value={choice.strong}
        fallback={defaults.strong}
        models={models}
        loading={loading}
        disabled={disabled}
        onChange={value => update({ strong: value })}
      />
      {failed ? <span className="hint err" style={{ display: 'block', marginTop: 10 }}>Catalogue unavailable. Paste a vendor/model id.</span> : null}
    </Panel>
  );
}
