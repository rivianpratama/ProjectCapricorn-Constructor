<div align="center">

# Constructor

**Turn multiple chat exports into one new AI persona**

Drop WhatsApp or LINE chats and get a SOUL.MD persona files you can drop into your agents.<br>

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)
![OpenRouter](https://img.shields.io/badge/OpenRouter-any%20model-e5452f)
![Tests](https://img.shields.io/badge/tests-vitest-6e9f18?logo=vitest&logoColor=white)

</div>

> **Inspiration.** The idea comes from **Project Capricorn (Capri)**, the personality construct in *Cyberpunk: Edgerunners 2* that is made of many digitized human psyches combined into one. Read about it on the [Cyberpunk wiki](https://cyberpunk.fandom.com/wiki/Capri). This project is a fan-inspired experiment and is not affiliated with CD PROJEKT RED, Studio Trigger or Arasaka.

## Features

- **Many chats, one psyche.** Combine one to six chats into a single new persona. The chats are the parents and the persona is their child: it inherits temperament, needs, values and reactions, not their exact lines.
- **WhatsApp and LINE.** Drop `.txt` exports. Pick the subject, the date range and the relationship for each chat.
- **Any OpenRouter model.** Search the full catalogue, or paste any `vendor/model` id. Choose one model for bulk reading and another for writing.
- **Bring your own key.** Your key goes straight to OpenRouter through the app's API routes. It is never stored on a server or logged.
- **Soul Pack output.** Download a zip with `SOUL.md`, `ENGRAM_REPORT.md`, the rewritten [Irises](https://github.com/criblaurens/Irises) persona files, and an `APPLY.md` copy guide.
- **Fidelity check.** Replays held-out replies through the pack, has a judge pick the real one, scores unseen situations and copying, and revises a failing pack once.
- **Try room.** Chat with the finished pack at `/try`.

## Quick start

Requires Node.js 20+.

```bash
git clone https://github.com/rivianpratama/ProjectCapricorn-Constructor
cd Constructinator
npm install
npm run dev
```

Open <http://localhost:3000>, then:

1. Paste your OpenRouter key.
2. Pick the **Bulk** and **Synthesis** models.
3. Drop your chat exports and confirm everyone in them agreed.
4. Press **Build engrams**, answer the questions, then download the pack.

## How it works

```
chat exports ─▶ engram per chat ─▶ merged report ─▶ questionnaire ─▶ soul ─▶ Soul Pack
   (parse,       (Bulk model)      (Synthesis)      (you answer)   (Synthesis)  (zip)
 pseudonymise)
```

| Step | What happens |
|---|---|
| Parse | Reads WhatsApp or LINE exports, computes stats, holds out real replies for testing |
| Pseudonymise | Replaces names before anything leaves the browser |
| Engram | One analysis per chat: one shot for the whole chat, or chunks for long chats, with verbatim evidence for every finding |
| Merge | Combines the engrams into one report of drives and traits |
| Questionnaire | You decide the name, nicknames and which traits stay |
| Compose | Writes the soul, renders the target files and lints every slot |
| Fidelity | Scores likeness, generalisation and copying on the held-out pairs |

The full design, including why the output is a child and not a clone, is in [PLAN.md](PLAN.md).

## Models

| Setting | Used for | Default |
|---|---|---|
| Bulk | Per-chat engrams, merges, fidelity generation | `deepseek/deepseek-v4.1-flash` |
| Synthesis | Report, questions, soul, fidelity judging, `/try` | `anthropic/claude-sonnet-5.5` |

The pipeline expects JSON and fixed markdown sections, so pick models that follow formats well. Your choice is saved in the browser. Change the server defaults with environment variables:

```bash
OPENROUTER_MODEL_CHEAP=deepseek/deepseek-v4.1-flash
OPENROUTER_MODEL_STRONG=anthropic/claude-sonnet-5.5
```

## Soul Pack

The pack replaces whole files at the same path with the same exports, fully compatible with [Irises](https://github.com/criblaurens/Irises). Irises is never edited by this project.

```
soul-pack/
├── SOUL.md
├── ENGRAM_REPORT.md
├── APPLY.md            copy table and the host tests that need updating
└── irises/…
```

`npm run sync:baseline` refreshes the pinned snapshots in `vendor/`.

## Privacy

- Your key is sent in an `x-openrouter-key` header per request. "Remember" keeps it in `localStorage`; otherwise it stays in the tab.
- Names are pseudonymised in the browser before chats are sent to a model. Raw transcripts are dropped once the pack is built.
- Chat text goes to the models you choose on OpenRouter, under their terms. Only use chats where everyone agreed.

## Project structure

```
app/                 pages and API routes (one per phase, plus key, models, try, fidelity)
src/components/      workbench, chat cards, model picker, try room
src/lib/chats/       parsing, stats, held-out pairs, n-gram index
src/lib/schema/      engram, report, questionnaire and soul parsers
src/lib/soul/        slot adapter, renderer, pack, lints
src/lib/fidelity/    prompt reproduction and scoring
prompts/             phase prompts, as plain system prompts
adapters/            slot map for the target files
tests/               vitest suite
vendor/              read-only snapshots pinned by SHA
```

## Development

```bash
npm test          # vitest
npm run build     # production build
npm run check     # both
```

Building with an AI agent? Read [AGENTS.md](AGENTS.md) first.

## Credits

- **Project Capricorn** from *Cyberpunk: Edgerunners 2* for the idea of one psyche made from many.
- Model access through [OpenRouter](https://openrouter.ai).
