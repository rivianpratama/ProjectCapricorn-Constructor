# Constructinator

Build one new psyche from up to six chat exports, then render it into Irises and IrisesWeb as a Soul Pack.

```
npm install
npm run dev
```

Open the page, paste an OpenRouter key, drop one to six WhatsApp or LINE exports, choose the subject and the range for each, then build. The app runs one engram per chat, merges them into a report, asks a short questionnaire, and renders the pack. Download it as a zip or try it against the vendored IrisesWeb prompt.

The key travels in the `x-openrouter-key` header for each request. It is never written to disk or logged, and it is checked with one cheap call before use.

## Layout

- `prompts/` the phase prompts, as plain system prompts
- `src/lib/chats/` parsing, stats, held-out pairs, n-gram index
- `src/lib/schema/` engram, report, questionnaire and soul parsers
- `src/lib/soul/` slot adapter, renderer, pack, lints
- `src/lib/fidelity/` IrisesWeb prompt reproduction and scoring
- `app/api/` one route per phase, plus key check, try and fidelity
- `soul-pack/` generated output, gitignored
- `vendor/` read-only snapshots pinned by SHA

## Pack

`soul-pack/` holds `SOUL.md`, `ENGRAM_REPORT.md`, the five target files, and `APPLY.md` with the copy table and the host tests that need updating. Each target file is replaced whole at the same path, with the same exports.

Irises and IrisesWeb are never edited. `npm run sync:baseline` refreshes the snapshots. `npm run try:irisesweb` copies IrisesWeb at HEAD into `.try/`, overlays the pack, and runs its dev server.

## Checks

```
npm test
npm run build
```

The tests cover byte-for-byte slot round-trips, parsing both export formats, stats, the four schema contracts, prompt structure, pack rendering, and the IrisesWeb tail reproduction.
