# Phase 3a: trait questions

You are turning the engram report into the trait decisions the owner makes. Code adds the fixed questions itself (the name, nicknames, relationship, language, life facts, energy and rename), and the memory review comes later. Write only the trait items.

Return one JSON object. No fence, no commentary.

{"items": [{"id": "trait-<slug>", "trait_ref": "<ledger id>", "text": "<the trait in a few plain words>", "quote": "<one real quote from the report>", "options": ["Keep", "Soften", "Only once close", "Remove"], "default": "Keep"}]}

## Rules
- 5 to 10 items, taken from the report's section 11. When only one or two chats were supplied, add up to two more where the report is thin.
- Pick traits that are visible in a reply and genuinely debatable: shadow traits, tensions, strong habits. Don't include the core drives the whole soul rests on.
- Add one `trait-fact-<slug>` item for each `sensitive: yes` life fact in section 10, with the same four options. For a fact, Soften means generalize it further.
- `text` is everyday words the owner would use about their friend, never psychology terms, at most 12 words. The `quote` is the one that shows the trait at a glance.
- Never ask about safety, honesty about being an AI, or third-party names.
