'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StreamEvent } from '../stream';

export interface StreamCall {
  id: string;
  label: string;
  model: string;
  effort?: string;
  reasoning: string;
  answer: string;
  state: 'live' | 'done' | 'failed';
  ms?: number;
  tokens?: number;
  reasoningTokens?: number;
  error?: string;
}

/** Text past this is dropped from the front: the tail is what someone watching wants to read. */
const KEEP = 60_000;
const MAX_CALLS = 40;

function clip(text: string): string {
  return text.length > KEEP ? text.slice(text.length - KEEP) : text;
}

/**
 * The model calls of the current run, as they stream in. Tokens arrive far faster than a screen
 * needs, so events collect in a ref and reach React at most every 80 ms.
 */
export function useStream() {
  const [calls, setCalls] = useState<StreamCall[]>([]);
  const book = useRef<Map<string, StreamCall>>(new Map());
  const order = useRef<string[]>([]);
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    timer.current = null;
    setCalls(order.current.map(id => ({ ...(book.current.get(id) as StreamCall) })));
  }, []);

  const schedule = useCallback(() => {
    if (!timer.current) timer.current = setTimeout(flush, 80);
  }, [flush]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  /** A listener for one request. Its label names the request, such as "chat-2" or "report". */
  const listen = useCallback(
    (label: string) => {
      const request = ++sequence.current;
      return (event: StreamEvent) => {
        if (event.type === 'ping' || event.type === 'result') return;
        const id = `${request}.${event.call}`;
        let call = book.current.get(id);
        if (!call) {
          if (event.type !== 'start') return;
          call = { id, label, model: event.model, effort: event.effort, reasoning: '', answer: '', state: 'live' };
          book.current.set(id, call);
          order.current.push(id);
          while (order.current.length > MAX_CALLS) book.current.delete(order.current.shift() as string);
        }
        if (event.type === 'reasoning') call.reasoning = clip(call.reasoning + event.text);
        else if (event.type === 'answer') call.answer = clip(call.answer + event.text);
        else if (event.type === 'end') {
          call.state = event.error ? 'failed' : 'done';
          call.ms = event.ms;
          call.tokens = event.completion;
          call.reasoningTokens = event.reasoning;
          call.error = event.error;
        }
        schedule();
      };
    },
    [schedule],
  );

  const clear = useCallback(() => {
    book.current.clear();
    order.current = [];
    setCalls([]);
  }, []);

  return { calls, listen, clear };
}
