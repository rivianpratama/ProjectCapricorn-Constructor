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
