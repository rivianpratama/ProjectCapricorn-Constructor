import type { RefusalReason } from './types';

export const REFUSALS: Record<RefusalReason, string[][]> = {
  session: [
    ['okayyy that was all my demo messages for you', 'the full me live on github, you can run me yourself there'],
    ['and that is the end of my demo quota for you', 'grab the whole me on github, no limits there'],
  ],
  ip: [
    ['this wifi already talk to me a lot today', 'come back tomorrow or grab me on github'],
  ],
  global: [
    ['sooo many people talking to me today, i am out of breath', 'try again tomorrow, or run me yourself from github'],
  ],
  burst: [
    ['woah slow down', 'one at a time pleaseee'],
    ['hold onnn', 'you are typing faster than me'],
  ],
};

export const FLOOR_LINE = 'couldnt get that one just now, something on my end acted up';

export const ERROR_LINES: string[][] = [[FLOOR_LINE]];

export function pickLine<T>(pool: readonly T[], rand: () => number = Math.random): T {
  return pool[Math.floor(rand() * pool.length) % pool.length];
}
