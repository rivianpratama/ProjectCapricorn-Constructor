import type { Pack } from './pack';

export interface ApplyInput {
  pack: Pack;
  changelog: string[];
  n: number;
  targetShas: Record<string, string>;
}

const COPIES: Array<[string, string]> = [
  ['soul-pack/irises/src/persona/policy.ts', 'Irises/src/persona/policy.ts'],
  ['soul-pack/irises/src/persona/voiceSamples.ts', 'Irises/src/persona/voiceSamples.ts'],
  ['soul-pack/irises/src/agents/convo/Context.md', 'Irises/src/agents/convo/Context.md'],
  ['soul-pack/irises-web/src/worker/prompt/persona.ts', 'IrisesWeb/src/worker/prompt/persona.ts'],
  ['soul-pack/irises-web/src/worker/prompt/voice.ts', 'IrisesWeb/src/worker/prompt/voice.ts'],
];

export function renderApply(input: ApplyInput): string {
  const { pack, changelog, n, targetShas } = input;
  const lines: string[] = [];
  lines.push('# Apply this pack');
  lines.push('');
  lines.push(`Built from ${n} chat${n === 1 ? '' : 's'}, against Irises \`${targetShas.irises ?? '?'}\` and IrisesWeb \`${targetShas['irises-web'] ?? '?'}\`.`);
  lines.push('');
  lines.push('## Copy');
  lines.push('');
  lines.push('| from | to |');
  lines.push('| --- | --- |');
  for (const [from, to] of COPIES) lines.push(`| \`${from}\` | \`${to}\` |`);
  lines.push('');
  lines.push('Each file is swapped whole, at the same path, with the same exports. Only persona text and voice pools differ.');
  lines.push('');
  lines.push('## Changelog against Iris');
  lines.push('');
  for (const line of changelog) lines.push(`- ${line}`);
  lines.push('');
  lines.push('## Tests to expect');
  lines.push('');
  lines.push('- `IrisesWeb/test/worker/prompt-colons.test.ts` forbids colons in the persona blocks and asserts the current Jakarta line. Update that assertion to whatever life facts this pack uses, and keep the colon ban.');
  lines.push('- `IrisesWeb/test/worker/prompt-colons.test.ts` also forbids Indonesian surface words. If this child actually code-switches, relax that list to the words this child really uses rather than deleting the test.');
  lines.push('- `IrisesWeb/test/worker/system.test.ts` checks section order, the no-digit rule, the no-dash rule, the `- mad covers hurt, hostile, angry` line and the thirty thousand character ceiling. All five hold in this pack.');
  lines.push('- `Irises/test/persona/personaModules.test.ts` holds golden hashes of the persona modules. Re-record them, since the persona is meant to change.');
  lines.push('');
  if (pack.issues.length || pack.poolIssues.length) {
    lines.push('## Lint warnings');
    lines.push('');
    for (const issue of pack.issues) lines.push(`- ${issue.slot}: ${issue.rule} (${issue.detail})`);
    for (const issue of pack.poolIssues) lines.push(`- ${issue.pool}: ${issue.detail}`);
    lines.push('');
  }
  return lines.join('\n');
}
