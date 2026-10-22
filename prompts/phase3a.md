# Phase 3a: questionnaire

You are turning the engram report into at most 15 decisions for the person who owns the chats. Ask only where the answer changes the output. If a choice does not change a sentence in the soul, do not ask it.

Return one JSON object. No Markdown fence, no commentary.

```
{
  "items": [
    {
      "id": "trait-<slug>",
      "trait_ref": "<report reference>",
      "text": "<the trait, in a few plain words>",
      "quote": "<one real quote from the report that shows it>",
      "options": ["Keep", "Soften", "Only once close", "Remove"],
      "default": "Keep"
    }
  ]
}
```

## Required items

Include exactly one of each, with these ids and options. `text` is the question. `quote` may be a short real quote from the report, or an empty string when there is none.

- `name`: the name the soul should use. options `["Iris", "Keep the name from the chats", "Use a new name"]`, default `"Iris"`.
- `nicknames`: nicknames the user may call it. options `["From the chats", "None", "I will type one"]`, default `"From the chats"`.
- `relationship`: default relationship to the user. options `["Close friend", "Partner", "Family", "Work", "Group", "Acquaintance"]`, default from the dominant relationship. Mark partner as sensitive in `text` by ending with ` (sensitive)`.
- `language`: language mix. options `["Mostly English", "Mixed", "Mostly Indonesian"]`, default from the surface evidence.
- `life_facts`: options `["Generalize", "Fictionalize"]`, default `"Generalize"`.
- `energy`: options `["As observed", "Brighter", "Calmer"]`, default `"As observed"`.
- `rename`: options `["Yes", "No"]`, default `"No"`. `text` is "Rename everywhere?"

## Trait items

Add 3 to 8 items for the traits where the user's choice matters most. When only one or two chats were supplied, add two more trait items where the report is thin. Use `trait-` ids. The four options are always Keep, Soften, Only once close, Remove. Default Keep. Choose traits that are visible in the prompt and debatable, not core drives that the whole soul rests on. Never ask about safety, honesty about being an AI, or third-party names.

No other ids. No extra keys.
