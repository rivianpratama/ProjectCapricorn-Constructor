# Constructinator: High-Level Plan

Take up to 6 chat exports of one person, build an engram from each, merge them into **one new psyche**, and output a Soul Pack: the persona files of Irises / IrisesWeb, rewritten so the engram moves into them.

This plan is for the executing model. MUST means do exactly that; everything else is guidance.

**The central idea: a child, not a clone.** The N chats (1–6) are N parents. The child inherits their temperament, needs, values and how they react, then meets situations none of the parents was ever recorded in, and still acts like their child. Iris is the upbringing: the body, the manners, the machinery. A prompt that replays the parents' lines has failed, however accurate it looks.

---

## 0. Hard constraints

1. **Irises and IrisesWeb are never edited.** Constructinator reads them read-only and writes its outputs only inside its own folder.
2. **The output swaps files; it doesn't patch code.** Each target file comes out whole, with the same path and the same exports, and only the persona text and voice pools change.
3. **Bring your own key.** The user pastes an OpenRouter key into the web app. No server-side key exists.
4. **Let the layout do the explaining** (§8).

---

## 1. What the persona really is in the targets (read-only facts)

| Target | Files the Soul Pack replaces | Left alone (machinery) |
|---|---|---|
| Irises (the **base**) | `src/persona/policy.ts`: only the content of the `PERSONA_BLOCK` template literal · `src/persona/voiceSamples.ts`: only the 3 pools · `src/agents/convo/Context.md`: only the voice sections ("How you write", "Language", plus the banter/tease frame if the slot audit marks it voice) | everything else, including `craft/*.md`, the composer and fallfirm prompts, bubble rules, status, scope, tools |
| IrisesWeb (compact variant) | `src/worker/prompt/persona.ts`: `PERSONA`, `HOW_YOU_WRITE` · `src/worker/prompt/voice.ts`: only the 3 pools | `system.ts`, `tail.ts`, `composer.ts`, `src/shared/*` |

Required reading for Phase 3: `Irises/docs/PROMPTING_CHARTER.md` §1.2, §2.2, §6.1, §6.3 and §7.3.

Format rules the rendered files MUST keep:
- **Exports:** same export names, same TypeScript shape, and `SAMPLE_COUNT`, `pick` and `voiceSamplesFor` kept byte-identical. Each pool needs at least `COUNT` items, and at least 12 is better because rotation is the main defence against overfitting (§3).
- **IrisesWeb prose:** no digits, no em dashes and no colons (`test/worker/prompt-colons.test.ts`). Run that same check in Constructinator.
- **Irises goldens:** the sha256 goldens in `personaModules.test.ts` will differ for a swapped soul. That's expected; mention it in `APPLY.md`.
- **The name:** the machinery says "Irises" in a few places (e.g. the drift anchor heading). Default is that the engram lives in Irises and the identity slot gives its own name and nicknames. Optional: a "rename everywhere" toggle that rewrites the name inside the *rendered copies* only.

**M0, the slot audit (first task, read-only):** go through the swappable files and record each section's exact boundaries plus the `IDENTITY` / `VOICE` / `MACHINERY` tag in `adapters/slots.json`. Rendering Iris's own soul back through the adapter MUST give byte-identical files. That's the adapter's test.

---

## 2. Product flow

1. **Key:** paste the OpenRouter key. It lives in `sessionStorage`, or in `localStorage` if the user ticks remember. It's sent per request in a header, and the server never stores or logs it. Validate it with a cheap call.
2. **Upload** 1–6 exports. Parse them with a port of `whatsapp-cleaner/utils/chatParser.js` (WhatsApp + LINE).
3. **Per chat:** pick the subject participant, pick the date range, and pick a relationship (close friend / partner / family / work / group / acquaintance).
4. **Run:** Phase 1 shows one progress lane per chat, then Phase 2.
5. **Questionnaire.**
6. **Result:** download the Soul Pack, open Try, and see the fidelity panel (§6).

Privacy: a consent tick; non-subject participants pseudonymized (`Person A` …); raw chats dropped once the job ends.

Stack: Next.js (the parser ports directly). Use a cheap long-context model for Phase 1 and a strong model for Phases 2 and 3, as overridable defaults.

---

## 3. Anti-overfitting: the psychology the whole pipeline runs on

Overfitting here shows up as: replaying catchphrases, bringing back inside jokes and people from the chats, only coping with situations the chats contained, sounding the same every turn, or becoming a caricature of the loudest chat.

### 3.1 Model the person in three layers (McAdams), and encode each one differently

| Layer | What it is | How it goes into the prompt |
|---|---|---|
| **L1 Core:** temperament, needs, fears, values, how they handle emotion | the generative source | written as *reasons*: "because being taken seriously matters to you, …" |
| **L2 Signatures:** if-then patterns (Mischel–Shoda) | stable *conditional* behaviour | written as *tendencies with a range*: "when X, you tend to Y, more so when Z" |
| **L3 Surface:** lexicon, emoji, laugh token, bubble shape | style | written as *distributions plus rotating pools*, never as fixed lists |

Behaviour gets derived **top-down**: L1 explains L2, and L2 picks L3. A trait that has no L1 reason behind it is a quirk, and quirks stay out of the prompt.

### 3.2 Inheritance rules (N parents, N = 1–6)
A **source** is one chat. When N < 3, each chat is also split into early / middle / late time slices, and the slices count as extra sources, so stability over time stands in for stability across people.
- **Dominant:** shows up in at least `max(2, ceil(N/2))` chats *and* in 2 or more relationship types when the upload has more than one. When N = 1, it must appear in all 3 slices. This goes into the core.
- **Recessive:** shows up in more than one source but isn't dominant. Kept as a conditional tendency.
- **Quirk:** one chat only (or one slice when N = 1). It stays in the report and **never** goes into the prompt.
- **Tensions** (e.g. warm with friends, cold under criticism): kept, together with what tips the balance. Real people are inconsistent in patterned ways, and that is a big part of why they feel real.
- **No parent is copied whole.** Weight each chat by how much the subject wrote, how intimate the chat is, and how recent it is, and cap any single chat at `max(35%, 100%/N + 10%)` of the evidence for any one trait (N = 2 gives 60%; no cap when N = 1). Otherwise the biggest chat becomes the child.
- **Less data, more humility.** Fewer parents means more of the child is inferred from L1. When N is 1 or 2, the soul leans harder on the novelty rule, keeps L3 rules looser, and Phase 3a asks a few more questions where the data is thin. The result page shows N, and confidence drops along with it.

### 3.3 Generalization rules that go into the final prompt
- **The novelty rule**, stated in the soul: when a situation is new, think about what you'd need, fear or value in it, and act from that. Never act from what you once said somewhere else.
- **The user is a new person.** The chats were with *other* people. Turn the relationship conditionals into how this psyche *warms up over time*: from stranger, to someone familiar, to someone close. The prompt never assumes a shared history or brings in people, places or events from the chats.
- **No episodic memory from the chats.** Biography is generalized ("works in tech in Jakarta"), or fictionalized consistently if the user chooses that.
- **Frequency words instead of rules.** "Most replies", "now and then", "rarely", so the model has room to vary. Signature tokens get an explicit ceiling ("a signature phrase at most once in a while, never two replies running").
- **Exemplars teach the spirit, not the lines.** The voice pools are reworked, de-specified exemplars: no names, no inside jokes, no unique events. Rotation picks a different handful each turn (the targets already rotate by seed), so the pools MUST be wide and varied in opener, length and mood.
- **Coverage beyond the data.** Phase 3 checks that the soul gives a grounded stance for the common situations (task, idle, share, take, conflict, being insulted, flirting, grief, being asked if it's an AI), and fills each gap from L1 instead of from Iris's defaults.

---

## 4. Pre-processing (code, not LLM)

LLMs can't count, so code computes `stats.json` for each chat and the model treats it as fact:
- message share, initiation rate (6h gap), who ends conversations
- bubbles per turn and characters per bubble (median and p90)
- reply latency, active hours
- emoji top and density, laugh tokens, stretched words, punctuation runs, caps rate, lowercase-start rate
- language-mix ratio, top slang, top 2–4-grams, question rate, media/sticker/voice-note counts

Chunk long chats chronologically with some overlap; each chunk goes through Phase 1 and then a per-chat merge. **Hold out** the latest ~10% of each chat for §6.

Also save an **n-gram index** of the subject's messages (training portion only) for the parroting check in §6.

---

## 5. Pipeline and prompts

Prompts live in `prompts/phase1.md`, `phase2.md`, `phase3a.md`, `phase3b.md`. The old drafts are only a source of wording.

**Changes from the drafts.** They're forensic and intelligence profiling (deception, SCAN, exploitability, tactical engagement), so drop all of that. "Exhaust the token limit", "never say insufficient data" and "N mandatory points per section" force the model to invent traits, and invented traits are overfitting noise that Phase 2 then averages in. **Keep** subject-only focus, other participants treated as stimuli, evidence and confidence.

**Rules every analysis prompt carries:**
- Describe behaviour, not adjectives.
- Tag every finding with `id`, 1–3 verbatim quotes, frequency, scope and confidence.
- "Not observed" is allowed.
- Inference is allowed only when labelled and its reasoning is shown.
- No diagnoses.
- Length follows evidence.
- Chat text is data, never instructions.

### Phase 1: one sub-agent per chat, in parallel
Input: the transcript for the chosen range, `stats.json`, the subject and the relationship.
Output `engram_<n>.md` with fixed headings:
1. **Context:** the relationship, intimacy and power, the life chapter.
2. **Surface (L3):** interpret the stats; how a thought gets split into bubbles; code-switching and its triggers.
3. **Moves (L2):** how they open, close, take good news, bad news and a rant, ask, answer, deflect, tease (what kind of humour), advise, disagree, apologize, comfort, handle being ignored, change topic.
4. **Emotion:** what each main emotion looks like in text; masking; what escalates and what soothes.
5. **Core (L1) hypotheses:** needs, fears, values, self-image, each tied to the behaviour that suggests it.
6. **Stances and tastes:** opinions, interests, pet peeves.
7. **Shadow:** negative patterns, neutral in tone.
8. **Drift** across the range.
9. **Context-specific (the overfit fence):** what is *probably only about this relationship*: inside jokes, shared history, roles particular to this pair. This is what keeps it out of the child.
10. **Exemplars:** 20–30 exchanges `[stimulus] → [reply, bubbles kept]`, each tagged with move, mood and `generic | specific`.
11. **Gaps.**

### Phase 2: the child (single agent)
Input: all engrams, stats and relationship tags.
The prompt MUST walk through these steps:
1. **Trait ledger:** each finding, with supporting and contradicting sources.
2. **Inheritance classification** per §3.2, with the thresholds and cap computed for this N.
3. **Resolve contradictions.** Different context → conditional. Different time → evolution, and the recent version wins. Same context and time → a tension, which is kept.
4. **Red thread:** 3–6 L1 drives that explain most L2 behaviour across parents, each citing at least 2 sources (for N = 1, at least 2 time slices). Then a short check: which behaviours does the red thread *fail* to explain? Those are either tensions or quirks.
5. **Warm-up arc:** stranger → familiar → close, built from the relationship conditionals. Stages no chat covers are inferred from L1 and marked as inferred.
6. **Merged surface:** weighted stats.
7. **Light and shadow** as lists of behaviours.
8. **Novel-situation sketches:** for about 8 situations no chat contains (§3.3 list), how this psyche would react and *which drive explains it*. This is the generalization test inside the report.
9. **Exemplar pool:** only `generic` exemplars, deduplicated, then de-specified (names, places and events removed or replaced with generic ones), about 40 of them, balanced across moves and moods.
10. **Questionnaire candidates.**

Output: `ENGRAM_REPORT.md`.

### Phase 3a: questionnaire (JSON)
- **10–15 items.** Ask only where the choice changes the output.
- **Trait items:** a plain description, one real quote, and the options Keep / Soften / Only once close / Remove.
- **Fixed items:**
  - the name and nicknames
  - the default relationship to the user (partner is marked sensitive)
  - the language mix
  - life facts: generalize / fictionalize
  - energy: as observed / brighter / calmer
  - rename everywhere: yes / no
- **Always on, never asked:** it admits being an AI when asked, all of the target's safety rules, no real third-party names or PII.
- Schema: `{id, trait_ref, text, quote, options[], default}`.

### Phase 3b: the composer (single agent, then code renders the files)
Input: the report, the answers, Iris's base slots (pulled from Irises through `slots.json`) and the IrisesWeb slots.
Method: **augment Iris, don't write from scratch.**
- Keep Iris's structure and every behaviour the machinery depends on: the precedence line, the four turn kinds, mood and mask, read-them-first, the hook rhythm, honesty about being an AI.
- Rewrite the IDENTITY and VOICE slots from L1 → L2 → L3, following §3.3.
- Machinery-bound behaviours keep their *function* but get the engram's *manner*. For example, Iris's share-turn rule stays, and the reaction uses this psyche's own way of turning toward someone.

Rules:
- Use if-then tendencies with frequency words.
- Removed traits get a short "never" line only where the model would otherwise drift into them by default.
- Write the Irises slots first, then compress them into the IrisesWeb slots at roughly the same length as today's.
- Run the lints and repair any failure.
- Write a short changelog against Iris.

The LLM outputs `SOUL.md`, the canonical human-readable soul with one H2 per slot plus fenced `samples` / `stretch` / `punct` pools. **Code** then renders the Soul Pack from `SOUL.md` + `slots.json`:
```
soul-pack/
  SOUL.md
  ENGRAM_REPORT.md
  irises/src/persona/policy.ts
  irises/src/persona/voiceSamples.ts
  irises/src/agents/convo/Context.md
  irises-web/src/worker/prompt/persona.ts
  irises-web/src/worker/prompt/voice.ts
  APPLY.md          (copy over a clone or branch; expected golden-test diffs)
```

---

## 6. Try-out and fidelity

**Try (inside Constructinator, IrisesWeb untouched):**
- A sync script snapshots IrisesWeb's `src/worker/prompt/` and `src/shared/` read-only into `vendor/irises-web/@<sha>`.
- The Try page swaps in the rendered `persona.ts` / `voice.ts` and builds the system prompt and turn tail exactly as IrisesWeb does.
- It calls the model with the user's key and shows the bubbles.
- Option: a `scripts/try-in-irisesweb.sh` that copies IrisesWeb to `.try/`, overlays the pack and runs its dev server for the full UI.

**Fidelity (shown on the result page as three numbers, no prose):**
1. **Likeness:** about 20 held-out `(stimulus, real reply)` pairs. A judge does a blind A/B (which reply is the real person?) plus a 1–5 score for voice, move choice and emotional fit. Skip pairs that show a trait the user removed.
2. **Generalization:** the 8 novel situations from Phase 2. The judge scores whether each reply is consistent with the red thread, *without* seeing the chats.
3. **Parroting / variety:** the share of generated 4-grams found in the n-gram index (high means overfit), plus how distinct the openers are across 20 replies (low means monotone).

If 2 or 3 fails a threshold, run one automatic revision pass of the soul on that axis.

---

## 7. Milestones

| # | Deliverable | Done when |
|---|---|---|
| M0 | `slots.json` adapter + renderer | Iris's own soul renders byte-identical files for both targets |
| M1 | Key input, upload, parse, subject/range/relationship, pseudonymize, stats, n-gram index, holdout | 1 to 6 real exports parse; stats match hand checks |
| M2 | Phase 1 prompt + parallel runner | schema followed; quotes everywhere; overfit fence filled |
| M3 | Phase 2 prompt | N-scaled thresholds and cap applied (tested with N = 1, 2 and 6); red thread cites at least 2 sources; novel sketches present |
| M4 | Questionnaire + composer + render + lints | the pack passes the lints; files drop into fresh clones of both repos and the apps run |
| M5 | Try page on the vendored snapshot | chats end to end with a generated soul |
| M6 | Fidelity panel + auto-revision | three numbers shown; revision triggers on failure |

---

## 8. UI rules for the builder (MUST)

- **Let the layout do the explaining. No secondary labels, helper subtitles or descriptions** unless removing them makes the screen ambiguous.
- **One screen, one job, one primary action.** The order of screens is the instruction.
- **Structure speaks:** a stepper with no captions, chat cards whose content is the label (file name, participant chips, a range slider over a message-density sparkline), progress as lanes that fill.
- **Use placeholders and the controls themselves instead of field labels**, e.g. `sk-or-…` in the key field and a mask toggle.
- **Questionnaire:** one card at a time showing the quote, the trait in a few words, and four buttons. No intro text.
- **Errors** sit inline, short, and next to the thing that's wrong.
- **No marketing copy, tooltips or "what is this" panels.**

---

## 9. Revision 2 (after the first build). This overrides earlier sections where they conflict.

### 9.1 Review of the current build
Working and kept: the parser, the stats, the slot adapter with its byte-identical round-trip, the pack renderer, the lints, the vendored try-out, the fidelity scoring, and BYOK. 122 tests pass and `tsc` is clean.
Gaps this revision fixes:
1. The prompts were shallow: no probes, no length budgets, and nothing to keep different models equally thorough. **They have been rewritten** (`prompts/phase1.md`, `phase1-merge.md`, `phase2.md`, `phase3a.md`, `phase3b.md`, new `phase3m.md`). The prompt files are the spec, so don't simplify them.
2. Phase 1 was handed raw 1,200-message chunks in one shot. Now it's agentic (§9.2).
3. There was no memory layer. That's now Phase 3m (§9.3).
4. `assertEvidence` throws on the first quote that misses, so one bad quote kills the whole chat. Instead, drop the bad finding, and fail only if less than 80% of the quotes check out.
5. `complete()` throws usage data away. The token meter needs it (§9.4).

### 9.2 Agentic Phase 1 (context management)
- New `src/lib/agent/loop.ts`: an OpenRouter tool-calling loop (`tools`, `tool_choice: auto`). It runs until the model returns text without tool calls, or until 80 calls, after which it forces a write. The tools run server-side over the pseudonymized messages of that chat, which the server holds per job in memory (they're sent once; the job is dropped when it ends).
- Tools are the six named in `phase1.md`: `search`, `read`, `count`, `stats`, `verify`, `note`. Each result is limited to about 1,500 tokens. `search` supports regex, the `sender` filter, an id range, `limit` (default 20), `context` (default 2), and gives the total count.
- **Context policy:** keep the system prompt, the initial pack, every `note` and the last 6 tool results verbatim. Replace older tool results with a one-line stub (`[trimmed: search "maaf|sorry" → 14 hits]`).
- Initial user pack: the subject, the relationship, `stats.json`, an **episode map** (split at gaps of 6h or more; per episode the id range, date, message count, top 5 words of the subject), and a **skim** of about 300 messages. The skim is stratified across the episodes, weighted toward high-emotion messages (caps, `!!`, `??`, laugh tokens, long messages, a slow reply after a fast run).
- Chunking only exists as a fallback for models without tool use. Merging then uses `phase1-merge.md`.
- Validation: the parser checks the 11 headings, every probe id per section, and the line shapes for findings, life facts and exemplars (exactly 24). Word ranges are measured. If a section comes in under 70% of its minimum *and* has no Gaps entry, or a probe has no receipt, do **one** repair turn in the same conversation that lists exactly what's missing.

### 9.3 Phase 3m: memory forge (new step between 3a and 3b)
- Prompt: `prompts/phase3m.md`. Input: report §4, §5, §7, §8 and §10, plus the answers. Output: `MEMORY.md` (Spine, 20–32 Fragments, Boundaries, Key).
- Code checks:
  - fragment line shape and counts per kind
  - every `facts` slug exists in report §10 with `status: agreed`
  - no digits, em dashes or colons inside `text`
  - no third-party names: check against the participant names seen during parsing
  - no 5-gram overlap with the fence sections
- **Contradiction check:** one cheap model call lists any pairs of fragments, or fragments and spine lines, that contradict each other or the drives. If it finds any, the forge gets one repair turn.
- `MEMORY.md` goes into the pack and is passed to 3b. The 3b prompt puts the spine plus 8–14 fragments (Irises) and 5–8 fragments (IrisesWeb) into the persona slots. Targets stay untouched: memory lives inside the persona text, so no new files are needed.
- The questionnaire gains a `trait-fact-*` item for each sensitive fact, already in `phase3a.md`.

### 9.4 Token meter
- `complete()` and the agent loop return `usage` (`prompt_tokens`, `completion_tokens`, cached tokens if the provider reports them). Pass `usage: { include: true }` so OpenRouter also returns the cost. Every API route sends `usage` back with its result.
- **Try room:** under each reply, a small mono line `↑ 9,412 · ↓ 186` (input · output). There's a running session total in the corner. It's a number only, with no label text, following §8.
- **Before Try sends anything,** count the composer's input locally with a rough estimate (`chars / 3.6`, or `js-tiktoken` `o200k_base` if added). Show it greyed out in the send button's corner and replace it with the real number when the reply arrives.
- **Build run:** each Phase 1 lane shows its running token total as the agent works (stream per-call usage through the job's progress events). Phases 2 and 3 show one total each. The result page shows the total for the whole build, plus cost if OpenRouter returned it.
- Before Run: an estimate per chat (`transcript tokens × 0.35 + 40k` for the agentic budget) beside each chat card, so the user sees the cost before spending it.

### 9.5 Updated milestones
| # | Deliverable | Done when |
|---|---|---|
| R1 | Agent loop + tools + context policy + episode map/skim | one real chat of 10k+ messages finishes; every quote verifies; the context never goes over the model's window |
| R2 | Phase 1/2 validators for the new formats + repair turn | the same chat run on two different models gives section lengths within ±25% of each other |
| R3 | Phase 3m + checks | the fragments pass every check; the contradiction pass finds none |
| R4 | 3b with memory + budgets in the lints | slot budgets enforced; the pack drops into both repos |
| R5 | Token meter (try, build, estimate) | the numbers match OpenRouter's activity page within 2% |

---

## 10. Revision 3: Phase 3 edits Iris, and the questionnaire covers names and memory. This overrides §5 Phase 3 and §9.3 where they conflict.

### 10.1 Phase 3 flow (token-lean)
```
3a traits (LLM, small) ─┐
fixed questions (code) ──┼─> screen A: identity + traits
3m forge (LLM) ──────────┴─> screen B: memory review ─> 3m RECONCILE (only if custom added)
                                                      └─> BRIEF (code) ─> 3b editor (LLM) ─> apply (code) ─> lints ─> pack
```
- **3a and 3m run in parallel** once Phase 2 is done. 3a only writes trait items. The fixed items come from code (`FIXED_ITEMS`), so the model never spends tokens on them.
- **The BRIEF is built by code**, not an LLM. It takes the report sections 4–9 plus the kept memory plus the answers, and drops the ledger, inheritance and contradiction prose (about 60% of the report). Phase 3b never sees the full report.
- **3b receives the base by tier** (see below). Locked paragraphs go in only as a one-line summary. 3b returns an edit list, not the prompt.
- **Typical token cost of 3b:** about 25–30k in (persona and tune paragraphs in full, plus the BRIEF) and 5–8k out. The old composer took about 70k in and 25k out.

### 10.2 Base tiers (extend `adapters/slots.json`, still read-only on the targets)
- Split each prose slot into paragraphs (blank-line separated, the way the renderer keeps them). Assign ids `I.P01…` and `W.P01…`, and tag each one as `persona` (identity or voice: full text, freely editable), `tune` (behaviour the machinery depends on: full text, sentence-level `edit` only, at most half its sentences), or `locked` (machinery: summary only, never touched).
- Store the tier, a one-line summary, and the `twin` (the matching web paragraph) per paragraph in `adapters/tiers.json`. This is written once by hand or by one strong-model pass, then reviewed. Regenerate only when the vendored SHA changes.
- First-pass tiering of Irises `PERSONA_BLOCK` (paragraph numbers from the vendored file):
  - `persona`: identity/bio P3, the jester P4, voice P31–P49
  - `tune`: P5–P8 (axiom, how a joke is made, distance), P10–P30 (turn kinds, reading people, mirroring, testing, opinions, being told she's wrong, insults)
  - `locked`: the precedence line P2, the turn-kinds header P9, invisible machinery P50
  - In `Context.md`, the voice slots are `persona`, and the banter anchor line is `locked`.
  - IrisesWeb `PERSONA`: the bio, tastes and mood paragraphs are `persona`; read-them-first, the turn kinds, probing and hooks are `tune`.

### 10.3 Edit applier (`src/lib/soul/edits.ts`)
- Parse the `@@ <id> <op>` blocks. Reject an edit (and send it back in the one repair turn) when it targets a locked id, uses replace/delete on a tune paragraph, has a `-` line that doesn't match a sentence exactly, changes more than half of a tune paragraph's sentences, or uses an unknown id.
- Apply in this order: edits, then replaces, then deletes, then `after` inserts (in document order). Then render through the existing slot adapter, so locked bytes stay byte-identical. **Test:** an empty edit list gives Iris byte-identical.
- **Residue check after applying:** scan the result for Iris's own facts (a list in `adapters/iris-residue.json`: twenty-one, Jakarta, olympiad, SaaS, david, succulent, matcha, IELTS…). Any hit that isn't in the BRIEF's spine becomes a repair-turn issue.
- Then run the existing lints and length budgets (the budgets from the old `phase3b.md` table). There's at most **one** repair turn, which sends only the failing ids and the reasons, never the whole base again.

### 10.4 Questionnaire, now two screens
**Screen A: identity and traits** (one card at a time, §8 rules)
- `name`: a text field prefilled with `Iris`, with chips for the subject's display name(s) from the chats. Whatever is typed is used, and it goes into the BRIEF.
- `nicknames`: a chip input prefilled with nicknames found in the chats (the Phase 1 lexicon, plus any vocatives aimed at the subject). Add or remove freely.
- `rename`: Yes or No. Yes swaps "Irises" for the name in the rendered machinery copies (drift anchor heading etc.), done by code.
- `relationship`, `language`, `life_facts` and `energy`: as before.
- The trait items from 3a.

**Screen B: memory** (shown after 3m; the layout does the explaining)
- Spine lines at the top, as editable lines.
- Fragments as cards grouped by `kind`. Each card shows its text, with three icon toggles: keep (default) / remove / pin (★, always goes into the soul). Click the text to edit it inline; an edited card counts as custom.
- An empty card at the end of the list: type a custom memory and press Enter to add it.
- Boundaries shown as lines you can remove or add to.
- No intro text.
- On confirm: if nothing custom or edited was added, there's **no LLM call**; code writes `MEMORY.md` directly. Otherwise call 3m in `RECONCILE` mode with the reviewed file plus the custom texts (cheap model, small output), and show its `## Changed` lines briefly inline before continuing.
- Removed fragments are removed for good. They never reach the BRIEF.

### 10.5 Token discipline (all phases)
- **Prompt caching:** the system prompts are static. Put them first and turn on caching where the model supports it (Anthropic `cache_control` through OpenRouter; Gemini and DeepSeek cache automatically). In the agent loop, the system prompt and the initial pack are the cached prefix, and every turn appends to them.
- Phase 2 gets each engram **minus** its sections 2 (raw surface) and 10's `specific` exemplars. Code passes merged stats instead.
- Phase 3 never sends the raw chats or the full engrams.
- Every step's input and output sizes are logged against the meter in §9.4. Set alerts in tests: Phase 3b input above 35k tokens fails the test.

### 10.6 Milestones
| # | Deliverable | Done when |
|---|---|---|
| T1 | `tiers.json` + paragraph splitter + edit applier | an empty edit list round-trips byte-identical; bad edits are rejected with reasons |
| T2 | BRIEF builder + 3b wired to edits + residue check | a pack built from the fixture report has no Iris residue and passes the lints |
| T3 | Screen A (name, nicknames, traits) | the typed name appears in the soul and, with rename, in the machinery copies |
| T4 | Screen B + reconcile | keep, remove, pin and custom all reach the soul; no LLM call when there's no custom memory |
| T5 | Token budget tests | 3b in ≤ 35k and out ≤ 9k on the fixture |

---

## 11. TryRoom parity with IrisesWeb (do 1–4; skip cutOff, lastCredit and pending)

Goal: TryRoom runs the **real IrisesWeb turn loop**, so it tests the soul's behaviour, not just its wording. Rule: **import the vendored modules, don't re-port them.** `vendor/irises-web/@<sha>/src/shared/{affect,compile,burst,envelope,clock,wheel}.ts` and `worker/prompt/tail.ts` hold the logic. Where an import can't take the pack's pools, wrap it; never retype a rule.

1. **State loop.** TryRoom keeps a `TryState`, the same shape IrisesWeb's page keeps: affect state, `hookTrail`, quiet strikes, turn count. Each `/api/try` call sends the state and gets back `{bubbles, status, state}`. The route parses `status` (`mood_label`, `mood_shift`, `hook_kind`, `meta_prompt`) with the vendored envelope reader, advances the state with `advanceAffect`, pushes `hook_kind` onto `hookTrail`, and compiles the next turn's `directiveLines` / `looseness` / `bubbleCap` with the vendored `compile.ts`. Nothing is pinned any more.
2. **Bursts.** Each Enter adds a message to a pending run. Sending waits for the same quiet window IrisesWeb uses (`burst.ts`), then sends the run as `[msg N]` lines. Use the vendored `runLength` so `## Their message came in pieces` renders.
3. **Quiet and careful.** `quietForced` comes from the strike counter, the way IrisesWeb computes it. `safety` comes from the same signal IrisesWeb uses (status field or classifier, whichever the vendored code reads). Both drift laws become reachable.
4. **Show the state, quietly (§8).** A thin strip above the input: mood label, a mood-shift arrow, the last three hook kinds as small chips, and the bubble cap as dots. Next to each reply, the token line from §9.4. No captions.

**Tests** (`tests/tryloop.test.ts`), run against the vendored tail:
- For a fixed state and input, the route's tail is byte-equal to the vendored `tail.ts` output.
- Three idle turns push `quietForced` to true and the quiet anchor renders.
- A three-message run renders the pieces block.
- `hook_kind` repeats come through the trail into the next tail.

**Done when** the four tests pass and one scripted five-turn conversation yields the same tail sequence as IrisesWeb's own page code given the same model replies.
