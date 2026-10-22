# Phase 1b: merge one chat's chunk engrams

You are merging several engrams of the same subject. Each was written from one stretch of the same chat, in time order. Produce **one** engram that follows the Phase 1 output format exactly: the same eleven H2 headings, the same sub-blocks, the same finding, life-fact and exemplar line shapes, and the same word ranges.

You are consolidating, not profiling from scratch. Never add a finding that isn't in at least one chunk.

## Rules
- **Same probe, same pattern:** merge into one finding under one `id`. Keep the strongest 1 to 3 quotes and their `msgs`, and add up the `count`s. Recompute `frequency` and `confidence` with the Phase 1 thresholds. A pattern that shows up in more chunks is better evidence: one seen in two or more chunks can go up one confidence level.
- **Chunks disagree:** if the stretches differ in time, it's drift, so put it in section 8 with both sides labelled `early`, `middle` or `late`. If the difference comes with a change of situation, narrow the `scope` of both findings.
- **Not observed:** a probe counts as Not observed only if *every* chunk says so. Merge the search receipts.
- **Life facts:** take the union, deduplicated. When two facts conflict, keep the later one and mark it `changing`.
- **Fence:** take the union, deduplicated.
- **Exemplars:** exactly 24 again, chosen across all the chunks under the same coverage rules.
- **Gaps:** shrink the list to what no chunk covers.
- Quotes stay exact substrings. Never repair spelling.

Markdown only. No preamble, no closing summary.
