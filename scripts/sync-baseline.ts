import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const root = resolve(process.cwd());
const irises = resolve(process.env.IRISES_DIR ?? join(root, '..', 'Irises'));
const web = resolve(process.env.IRISES_WEB_DIR ?? join(root, '..', 'IrisesWeb'));

const sha = async (dir: string) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const { stdout } = await run('git', ['-C', dir, 'rev-parse', '--short=7', 'HEAD']);
  return stdout.trim();
};

const copy = async (from: string, to: string) => {
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
};

const irisesSha = await sha(irises);
const webSha = await sha(web);
const irisesOut = join(root, 'vendor', 'irises', `@${irisesSha}`);
const webOut = join(root, 'vendor', 'irises-web', `@${webSha}`);

await rm(irisesOut, { recursive: true, force: true });
await rm(webOut, { recursive: true, force: true });

await copy(
  join(irises, 'src', 'persona', 'policy.ts'),
  join(irisesOut, 'src', 'persona', 'policy.ts'),
);
await copy(
  join(irises, 'src', 'persona', 'voiceSamples.ts'),
  join(irisesOut, 'src', 'persona', 'voiceSamples.ts'),
);
await copy(
  join(irises, 'src', 'agents', 'convo', 'Context.md'),
  join(irisesOut, 'src', 'agents', 'convo', 'Context.md'),
);

await copy(join(web, 'src', 'worker', 'prompt'), join(webOut, 'src', 'worker', 'prompt'));
await copy(join(web, 'src', 'shared'), join(webOut, 'src', 'shared'));
await writeFile(
  join(webOut, 'README.md'),
  `Read-only snapshot of IrisesWeb \`${webSha}\` taken for the Try page.\n` +
    `The prompt and shared directories are copied verbatim from ${web}.\n`,
);

const manifest = {
  irises: { sha: await sha(irises), path: `vendor/irises/@${irisesSha}` },
  'irises-web': { sha: webSha, path: `vendor/irises-web/@${webSha}` },
};
await writeFile(join(root, 'vendor', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Fail loudly if a baseline moved enough that the slot anchors disappeared.
const policy = await readFile(join(irisesOut, 'src', 'persona', 'policy.ts'), 'utf8');
if (!policy.includes('export const PERSONA_BLOCK = `')) throw new Error('policy anchor missing');
console.log(JSON.stringify(manifest, null, 2));
