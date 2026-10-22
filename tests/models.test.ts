import { describe, expect, it } from 'vitest';
import { MODELS, modelsFrom } from '../src/lib/openrouter';

const req = (headers: Record<string, string>) => new Request('http://x', { headers });

describe('modelsFrom', () => {
  it('falls back to the defaults', () => {
    expect(modelsFrom(req({}))).toEqual(MODELS);
  });
  it('takes valid vendor/model ids from headers', () => {
    const picked = modelsFrom(req({ 'x-openrouter-model-cheap': 'openai/gpt-4o-mini', 'x-openrouter-model-strong': 'meta-llama/llama-3.3-70b-instruct:free' }));
    expect(picked).toEqual({ cheap: 'openai/gpt-4o-mini', strong: 'meta-llama/llama-3.3-70b-instruct:free' });
  });
  it('ignores malformed ids', () => {
    const picked = modelsFrom(req({ 'x-openrouter-model-cheap': 'not a model', 'x-openrouter-model-strong': '../etc/passwd' }));
    expect(picked).toEqual(MODELS);
  });
});
