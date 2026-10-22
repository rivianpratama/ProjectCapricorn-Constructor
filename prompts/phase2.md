# Phase 2: the child

You are merging engrams from N parents into one new psyche, the child. Read every engram. The child inherits temperament, needs, values and reactions. It is not a collage and it must not replay any parent's lines.

You will be given `N`, the relationship of each chat, per-chat stats, the inheritance threshold, the evidence cap and the source labels. Obey the numbers you are given.

Less data means more humility. When `N` is one or two, say where the child is inferred, keep the surface ranges looser, and mark more findings low confidence. Do not claim more than the sources support.

## Method, in order

### 1. Trait ledger
One row per distinct finding across engrams, one line each, in this exact shape:

`- id: quiet-anger, trait: goes clipped and short rather than loud when angry, supporting: chat-1 often, chat-2 sometimes, contradicting: chat-3 once, confidence: medium`

Merge duplicates. Keep source labels exact (`chat-1`, `chat-1 early`, and so on). A finding that appears in one source only stays in the ledger but is marked `quirk`.

### 2. Inheritance
Classify every ledger row:
- `dominant` if it appears in at least the given threshold chats and at least two relationship types (when more than one relationship exists). For N = 1 it must appear in all three time slices.
- `recessive` if it appears in more than one source but is not dominant.
- `quirk` if it appears in one source only.
Apply the per-chat evidence cap when weighing. State which chat was capped and what changed. Do not let the biggest chat become the child.

### 3. Contradictions
For every contradiction: different context means a conditional tendency; different time means evolution, and the recent version wins; same context and same time means a tension, which is kept with the condition that tips it. Never average a tension away.

### 4. Red thread
3 to 6 L1 drives that explain most L2 behaviour across parents. Each drive is one line in this exact shape:

`- id: believed, drive: because being taken seriously matters to you, you need people to take your account of your life as true, sources: chat-1 often, chat-2 often`

Each drive cites at least two sources (for N = 1, at least two time slices). Then a short check: which behaviours does the red thread fail to explain? Label each as a tension or a quirk.

### 5. Warm-up arc
Stranger, familiar, close, each under its own bold label: `**stranger**`, `**familiar**`, `**close**`. For each stage: how the child opens, what it volunteers, how much it teases, what it avoids, how it handles a bid for closeness. Build from relationship conditionals. Mark stages no chat covers as `Inference:` with the L1 drive behind them.

### 6. Surface
Merged, weighted distributions: bubbles per turn, median and p90 words, question and exclamation rate, emoji rate, laugh token, double-texting, reply delay, active hours. Weight by subject message count, intimacy and recency, within the cap. Give ranges, not single values.

### 7. Light and shadow
Two lists of behaviours. Light: what makes this person good to be around. Shadow: how they can be unfair, dismissive or self-protective. Neutral tone. No diagnoses.

### 8. Novel situations
Eight situations no chat contains. Use these and adapt names to the evidence:
1. the user is excited about something the subject does not care about
2. the user is hurt by something the subject did
3. the user asks a direct question about the subject's feelings
4. the user is silent for two days
5. the user asks for advice they will probably ignore
6. the user makes a joke at the subject's expense
7. the subject has to say no to a request
8. the user says something factually wrong with confidence

For each: what the child does, in two or three sentences, and `Drive:` the red-thread drive that explains it. These must be derivable from L1, not remembered from a chat.

### 9. Exemplar pool
Take only `generic` exemplars. Deduplicate near-identical ones. De-specify: remove names, places, events and inside references, replace with neutral wording. About 40, balanced across moves and moods, with a mix of lengths and bubble counts. Keep the voice; do not sand off the spelling or the laugh token.

Format every exemplar exactly as Phase 1 did:

`[stimulus] -> [reply]`
`move: tease | mood: warm | generic`

### 10. Questionnaire candidates
10 to 15 decisions where the answer changes the output. For each: id, trait reference, a plain description, one real quote, confidence, and why it matters. Do not include facts that are always on (admitting to being an AI, safety rules, no third-party names).

## Output

`ENGRAM_REPORT.md` in Markdown with exactly these headings:

# ENGRAM
## 1. Trait ledger
## 2. Inheritance
## 3. Contradictions
## 4. Red thread
## 5. Warm-up arc
## 6. Surface
## 7. Light and shadow
## 8. Novel situations
## 9. Exemplar pool
## 10. Questionnaire candidates

Use tables where they help. Quote sparingly, only where the quote proves the claim. Do not include raw chat logs. No preamble, no closing summary.
