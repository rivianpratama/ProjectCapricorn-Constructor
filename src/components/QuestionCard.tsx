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
    <div className="qcard">
      {item.quote ? <blockquote className="quote">“{item.quote}”</blockquote> : null}
      <div className="q">{item.text}</div>
      <div className="opts">
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
            type="text"
            className="grow"
            value={typed}
            placeholder={item.id === 'name' ? 'Name' : 'Nickname'}
            onChange={event => setTyped(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && typed.trim()) onAnswer(typed.trim());
            }}
          />
          <button className="primary" disabled={!typed.trim()} onClick={() => onAnswer(typed.trim())}>Use</button>
        </div>
      ) : null}
    </div>
  );
}
