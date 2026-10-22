'use client';

import { useRef, useState } from 'react';
import type { QuestionItem } from '../lib/schema/questionnaire';

interface Props {
  item: QuestionItem;
  onAnswer: (value: string) => void;
}

const TYPE_OPTIONS = new Set(['Use a new name', 'I will type one']);

export function QuestionCard({ item, onAnswer }: Props) {
  const [typed, setTyped] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const typeable = item.id === 'name' || item.id === 'nicknames';

  return (
    <div className="card stack">
      {item.quote ? <span className="muted">“{item.quote}”</span> : null}
      <b>{item.text}</b>
      <div className="row">
        {item.options.map(option => (
          <button
            key={option}
            onClick={() => {
              if (typeable && TYPE_OPTIONS.has(option)) {
                input.current?.focus();
                return;
              }
              onAnswer(option);
            }}
          >
            {option}
          </button>
        ))}
      </div>
      {typeable ? (
        <div className="row">
          <input
            ref={input}
            value={typed}
            placeholder={item.id === 'name' ? 'name' : 'nickname'}
            onChange={event => setTyped(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && typed.trim()) onAnswer(typed.trim());
            }}
            style={{ flex: 1 }}
          />
          <button disabled={!typed.trim()} onClick={() => onAnswer(typed.trim())}>use</button>
        </div>
      ) : null}
    </div>
  );
}
