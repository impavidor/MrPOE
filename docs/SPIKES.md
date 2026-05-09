# Spikes

Proof-of-concept investigations that must be resolved before committing to an implementation.

---

## SPIKE-001: Article content format

**Question**: Which content format (wikitext, HTML, plain text extract) should the poewiki Source Agent fetch and pass to extraction LLM calls?

**Why it matters**: The format determines extraction prompt design, token budget math, and how much noise the LLM must filter. The wrong choice degrades Answer quality for the entire pipeline.

**Options**:
- `action=query&prop=revisions&rvprop=content` — **wikitext**: complete, structured, includes infobox template data (affix tiers, stat values). Noisy template markup but modern LLMs handle it well.
- `action=parse` — **HTML**: tag-heavy, moderate noise, no clear benefit over wikitext.
- `action=query&prop=extracts&explaintext=1` — **plain text**: clean prose, but strips all infobox data. Loses item stats, affix values, crit numbers — often exactly what mechanics questions need.

**Recommended starting point**: wikitext. PoE wiki pages are heavily template-driven; infobox data is load-bearing for mechanics answers. Fall back to HTML if extraction quality is poor.

**How to run**:
1. Fetch 3–5 representative poewiki pages (e.g. Critical Strike, Ailment, Flicker Strike) in all three formats.
2. Run an extraction prompt on each, targeting a specific mechanics question.
3. Compare: completeness of extracted sections, token count, noise level.

**Decision criterion**: format that yields the most complete, lowest-noise extraction for a mechanics question within the per-extraction token cap (2k tokens).

---

## SPIKE-002: MediaWiki search endpoint

**Question**: Which search endpoint should the poewiki Source Agent use — `action=opensearch` or `action=query&list=search` — and does either handle colloquial PoE terms well enough without Concept normalisation?

**Why it matters**: If the API can't match "crit" → "Critical Strike" or "dot multi" → "Damage over Time Multiplier", the Concept Extractor must normalise Concepts to canonical wiki titles before searching — adding complexity and a prompt engineering burden.

**Options**:
- `action=opensearch` — autocomplete-style, fast, title-only matching.
- `action=query&list=search` — full-text search across titles and page content, more likely to handle colloquial terms.

**Recommended starting point**: `action=query&list=search`. Full-text search is more likely to surface pages for shorthand terms.

**How to run**:
1. Query both endpoints with a set of colloquial PoE terms: "crit", "shock stacking", "dot multi", "ele pen", "mana leech".
2. Check whether the correct canonical page appears in the top 3 results for each term.
3. If `list=search` handles all terms: no Concept normalisation needed. If it misses more than 1–2 terms: add a normalisation step to the Concept Extractor prompt.

**Decision criterion**: endpoint that surfaces the correct canonical Article in the top 3 results for ≥80% of colloquial terms tested.
