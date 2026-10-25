'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface ModelInfo {
  id: string;
  name: string;
  context: number;
  promptPrice: number | null;
  completionPrice: number | null;
}

interface Props {
  id: string;
  label: string;
  hint?: string;
  value: string;
  fallback: string;
  models: ModelInfo[];
  loading: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}

const SHOWN = 60;
const VALID_MODEL_ID = /^[\w.~:\-]+\/[\w.~:\-]+$/;

function price(value: number | null): string {
  if (value === null) return '?';
  if (value === 0) return 'free';
  return `$${value < 1 ? value.toFixed(2) : value.toFixed(value < 10 ? 2 : 0)}`;
}

function ctx(tokens: number): string {
  if (!tokens) return '';
  return tokens >= 1_000_000 ? `${+(tokens / 1_000_000).toFixed(1)}M ctx` : `${Math.round(tokens / 1000)}k ctx`;
}

/** Searchable OpenRouter model combobox. Any `vendor/model` id can be typed, so new models work before the list shows them. */
export function ModelPicker({ id, label, hint, value, fallback, models, loading, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const effective = value || fallback;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? models.filter(model => model.id.toLowerCase().includes(q) || model.name.toLowerCase().includes(q))
      : models;
    return matched.slice(0, SHOWN);
  }, [models, query]);

  const typed = query.trim();
  const custom = typed && VALID_MODEL_ID.test(typed) && !models.some(model => model.id === typed) ? typed : '';
  const rows = custom ? [{ id: custom, name: '', context: 0, promptPrice: null, completionPrice: null }, ...results] : results;

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    setQuery('');
  }

  function commitTypedOrBest() {
    const t = query.trim();
    if (!t) {
      setOpen(false);
      setQuery('');
      return;
    }
    if (VALID_MODEL_ID.test(t)) {
      pick(t);
      return;
    }
    const matched = models.find(m => m.id.toLowerCase() === t.toLowerCase() || m.name.toLowerCase() === t.toLowerCase());
    if (matched) {
      pick(matched.id);
      return;
    }
    if (rows.length > 0 && rows[hi]) {
      pick(rows[hi].id);
      return;
    }
    setOpen(false);
    setQuery('');
  }

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) {
        commitTypedOrBest();
      }
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open, query, rows, hi]);

  useEffect(() => setHi(0), [query]);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="picker" ref={box}>
        <input
          id={id}
          type="text"
          className="mono"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={open ? query : effective}
          placeholder={effective || fallback}
          onFocus={() => {
            setQuery('');
            setOpen(true);
          }}
          onChange={event => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setHi(index => Math.min(rows.length - 1, index + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHi(index => Math.max(0, index - 1));
            } else if (event.key === 'Enter') {
              if (open) {
                event.preventDefault();
                commitTypedOrBest();
              }
            } else if (event.key === 'Tab') {
              if (open && query.trim()) {
                commitTypedOrBest();
              } else {
                setOpen(false);
              }
            } else if (event.key === 'Escape') {
              setOpen(false);
              setQuery('');
            }
          }}
        />
        {open ? (
          <div className="list" id={`${id}-list`} role="listbox">
            {loading ? <div className="empty">Loading…</div> : null}
            {!loading && !rows.length ? (
              <div className="empty">No match</div>
            ) : null}
            {rows.map((model, index) => (
              <button
                key={model.id}
                type="button"
                role="option"
                aria-selected={model.id === effective}
                className={`opt ${index === hi ? 'hi' : ''} ${model.id === effective ? 'sel' : ''} ${model.id === custom ? 'custom' : ''}`}
                onMouseEnter={() => setHi(index)}
                onMouseDown={event => {
                  event.preventDefault();
                  pick(model.id);
                }}
              >
                <span className="id">{model.id}</span>
                <span className="meta">
                  {model.context ? <span>{ctx(model.context)}</span> : null}
                  {model.promptPrice !== null ? <span>{price(model.promptPrice)} in · {price(model.completionPrice)} out</span> : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {hint ? <span className="hint">{hint}</span> : null}
      {value ? (
        <button type="button" className="small ghost" style={{ alignSelf: 'flex-start' }} onClick={() => onChange('')}>
          Reset to default
        </button>
      ) : null}
    </div>
  );
}
