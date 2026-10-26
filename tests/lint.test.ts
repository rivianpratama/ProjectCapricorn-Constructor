import { describe, expect, it } from 'vitest';
import { lintSoul } from '../src/lib/soul/lint';

const base = (persona: string) => ({ 'iris.persona': `## Who is typing, in every lane\n${persona}` });
const chatTalk = (text: string) => lintSoul(base(text)).filter(issue => issue.rule === 'no-chat-talk');

describe('no-chat-talk', () => {
  it('lets ordinary speech about reports and parents through', () => {
    expect(chatTalk('You read the report on the news and ask your parents for advice.')).toEqual([]);
  });

  it('flags build vocabulary and names the phrase', () => {
    const [issue] = chatTalk('Built from the engram of someone real.');
    expect(issue.detail).toContain('engram');
  });
});

describe('originality', async () => {
  const { copiedShare, lintOriginality } = await import('../src/lib/soul/lint');
  const { baseSlots } = await import('../src/lib/soul/base');
  const base = baseSlots();

  it('measures Iris sentences kept word for word', () => {
    expect(copiedShare(base['web.persona'], base['web.persona'])).toBe(1);
    expect(copiedShare('You go quiet when someone laughs at a worry you meant seriously.', base['web.persona'])).toBe(0);
  });

  it('flags Iris with a new bio pasted on top', () => {
    const lazy = { ...base, 'web.persona': base['web.persona'].replace('twenty-one', 'twenty-six') };
    const rules = lintOriginality(lazy, base).map(issue => `${issue.slot} ${issue.rule}`);
    expect(rules).toContain('web.persona copied-from-iris');
    expect(rules).toContain('iris.persona copied-from-iris');
    expect(rules).toContain('iris.persona iris-residue');
    expect(rules).toContain('web.how copied-from-iris');
    const web = lintOriginality(lazy, base).find(issue => issue.slot === 'web.persona')!;
    expect(web.detail).toContain('Rewrite these first, "');
  });

  it('lets a residue term through when the report gives it to the child', () => {
    const soul = { 'web.persona': '## Who you are\n\nYou live in Jakarta and draw for a living.' };
    expect(lintOriginality(soul, base)).toHaveLength(1);
    expect(lintOriginality(soul, base, 'lives near Pulomas, Jakarta')).toEqual([]);
  });
});

describe('depth', async () => {
  const { lintDepth } = await import('../src/lib/soul/lint');
  const { baseSlots } = await import('../src/lib/soul/base');
  const base = baseSlots();

  it('sends back a slot far thinner than Iris, and passes one at her depth', () => {
    const thin = { ...base, 'web.persona': '## Who you are\n\nYou are Capri.' };
    expect(lintDepth(thin, base).map(issue => `${issue.slot} ${issue.rule}`)).toEqual(['web.persona too-thin']);
    expect(lintDepth(base, base)).toEqual([]);
  });
});
