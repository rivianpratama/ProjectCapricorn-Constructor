'use client';

import { useEffect, useState } from 'react';
import type { ModelInfo } from '../../components/ModelPicker';
import { modelStore, type ModelChoice } from './api';

interface Defaults {
  cheap: string;
  strong: string;
}

/** OpenRouter's catalogue plus the user's persisted choice. The choice is empty when the server default applies. */
export function useModels() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaults, setDefaults] = useState<Defaults>({ cheap: 'google/gemini-2.5-flash', strong: 'anthropic/claude-sonnet-4.5' });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [choice, setChoice] = useState<ModelChoice>({ cheap: '', strong: '', effortCheap: '', effortStrong: '' });

  useEffect(() => {
    setChoice(modelStore.get());
    let live = true;
    fetch('/api/models')
      .then(response => (response.ok ? response.json() : Promise.reject(new Error('list failed'))))
      .then((data: { models: ModelInfo[]; defaults: Defaults }) => {
        if (!live) return;
        setModels(data.models);
        setDefaults(data.defaults);
      })
      .catch(() => live && setFailed(true))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  function update(next: Partial<ModelChoice>) {
    setChoice(current => {
      const merged = { ...current, ...next };
      modelStore.set(merged);
      return merged;
    });
  }

  return { models, defaults, loading, failed, choice, update };
}
