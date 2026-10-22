'use client';

import type { ReactNode } from 'react';

export function Panel({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  summary?: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <section className={`panel ${open ? '' : 'closed'}`}>
      <button type="button" className="head toggle" onClick={() => onToggle(id)} aria-expanded={open}>
        <h2 className="eyebrow">{title}</h2>
        {!open && summary ? <span className="summary">{summary}</span> : <span style={{ flex: 1 }} />}
        <svg className={`chev ${open ? 'open' : ''}`} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? <div className="body">{children}</div> : null}
    </section>
  );
}

export function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ id: T; label: string }>;
}) {
  return (
    <div className="seg" role="tablist">
      {options.map(option => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          className={value === option.id ? 'active' : ''}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
