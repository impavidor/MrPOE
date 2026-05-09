# PoE Assistant

A conversational assistant that answers questions about **Path of Exile 1** game mechanics. Uses a multi-agent pipeline to investigate one or more Sources and synthesize Findings into an Answer. Path of Exile 2 is out of scope.

## Language

**Query**:
A natural language question about Path of Exile mechanics submitted by the user.
_Avoid_: prompt, message, input

**Concept**:
A Path of Exile game term or topic extracted from a Query by the Concept Extractor, annotated with one or more Domains. Each Concept is dispatched to Source Agents for investigation. A single Concept may resolve to more than one Article if the topic spans multiple wiki pages.
_Avoid_: keyword, topic, entity, tag

**Concept Extractor**:
A dedicated LLM agent with two closely related responsibilities: (1) detect whether the Query is about Path of Exile 1 mechanics, and (2) if so, resolve anaphoric references against prior Queries and return a structured list of Concepts — each annotated with the domains it touches. Receives only the Query sequence from the Conversation (not full Q/A pairs) — anaphoric references point back to what the user asked, not what the app answered. Always uses the cheapest available model. Its interface returns a discriminated union: `(query, priorQueries) → {outOfScope: true} | {concepts: {concept, domains[]}[]}`. Domain annotation drives deterministic routing. The Concept Extractor is the only place that reasons about scope and which Sources are relevant.
_Avoid_: parser, NER, keyword extractor

**Orchestrator**:
The parent LLM agent that coordinates the full pipeline: receives the Concept Extractor's result, and if `outOfScope: true`, returns a random refusal from the Refusal Pool immediately. Otherwise routes Concepts to Source Agents and synthesizes all Findings into an Answer. Never parses raw Query text — always works from structured Concepts.
_Avoid_: parent agent, main agent, coordinator

**Source Agent**:
A component specialized for one Source. Fulfills a shared interface: `(concepts[], query) → Finding`. Receives only the Concepts whose Domains map to its Source. Returns a Finding the Orchestrator synthesizes into an Answer. All Source Agents are interchangeable from the Orchestrator's perspective — the Orchestrator never calls a Source Agent directly, only through the registry.
_Avoid_: sub-agent, child agent, worker

**Stub Source Agent**:
A Source Agent implementation for a Domain that is architecturally registered but not yet built. Returns a Finding immediately with `status: "not_supported"` for every Concept — no data fetching, no LLM calls. Allows the full routing architecture to be live from day one. The Orchestrator responds in expert voice — e.g. *"Sorry, I don't know anything about suffixes."* — never mentioning stubs or implementation details. Replaced by a real Source Agent when the underlying data source is integrated.

**Source**:
A registered data provider the Orchestrator can route Concepts to. Each Source has exactly one Source Agent and a defined domain of information it owns.
_Avoid_: data source, provider, backend, integration

**Domain**:
A category of information that maps to exactly one Source. Concepts are annotated with one or more Domains by the Concept Extractor. The Source Agent Registry routes each Concept to every Source that owns one of its Domains — a Concept touching multiple Domains fans out to multiple Sources.

Known Domains and their owning Sources:

| Domain | Description | v1 Implementation | Future Implementation |
|--------|-------------|-------------------|-----------------------|
| `mechanics` | Game rules, skill interactions, status effects, passive tree, ascendancy mechanics, boss mechanics | poewiki Source Agent (real) | poewiki Source Agent |
| `items` | Structured modifier/affix data, base types, item tiers | Stub Source Agent | PoeDB Source Agent |
| `market` | Live pricing, exchange rates, trade values | Stub Source Agent | PoeAPI Source Agent |

Known Sources:
- **poewiki** — owns `mechanics` _(v1 — only real Source Agent in scope)_
- **PoeDB** — will own `items` _(future)_
- **PoeAPI** — will own `market` _(future)_

**Article**:
A poewiki.net wiki page retrieved via the MediaWiki API. The unit of content fetched by the poewiki Source Agent. The optimal content format (wikitext, HTML, or plain text extract) is to be determined empirically — the poewiki Source Agent normalizes whichever format is used before returning a Finding. Articles are never cached directly; only the extracted sections are cached.
_Avoid_: page, document, content, resource

**Finding**:
Structured JSON produced by a Source Agent and returned to the Orchestrator. Preserves provenance — sections are grouped by Concept and by Article — so the Orchestrator knows exactly which content belongs to which Concept when synthesizing an Answer. The Source Agent is responsible for normalizing the raw content from its data source into this form — the Orchestrator never receives raw wiki markup, HTML, or unprocessed API responses.

Schema:
```json
{
  "source": "poewiki",
  "concepts": [
    {
      "concept": "Critical Strike",
      "status": "found",
      "articles": [
        { "title": "Critical Strike", "url": "https://www.poewiki.net/wiki/Critical_Strike", "sections": ["..."] },
        { "title": "Critical Strike Multiplier", "url": "https://www.poewiki.net/wiki/Critical_Strike_Multiplier", "sections": ["..."] }
      ]
    },
    {
      "concept": "SomeMadeUpThing",
      "status": "not_found",
      "articles": []
    }
  ]
}
```

Concept `status` values:
- `found` — articles were fetched successfully
- `not_found` — Source Agent is real but found no articles for this Concept; Orchestrator asks user to clarify
- `not_supported` — Source Agent is a Stub; Orchestrator responds in expert voice without mentioning stubs

Two configurable token thresholds apply:
- **Per-extraction cap** (default: 2k tokens): limits the output of each individual Article/Concept extraction call. Keeps individual LLM calls lean.
- **Total Finding cap** (default: 8k tokens): limits the total Finding before it reaches the Orchestrator. If exceeded, the Source Agent runs a summarization pass to compress. Summarization is the exception, not the default.

_Avoid_: result, chunk, excerpt, response

**Answer**:
The LLM-generated response the Orchestrator produces by synthesizing all Findings in the context of the Query and Conversation.
_Avoid_: response, reply, output, result

**Conversation**:
The ordered sequence of Query/Answer pairs for a session. Contains only Queries and Answers — never Article or Finding content. Persisted in browser storage; resets when storage is cleared. Capped at a configurable maximum number of turns (default: 20); older pairs are dropped when the cap is exceeded to keep LLM context bounded.
_Avoid_: chat history, thread, session, context

## Relationships

- A **Query** yields one or more **Concepts**
- The **Orchestrator** routes **Concepts** to one or more **Sources**
- Each **Source Agent** fetches Articles for all its Concepts in parallel, then returns one **Finding** per turn to the **Orchestrator**
- A **Finding** from the poewiki **Source Agent** is derived from one or more **Articles**
- Extracted sections for a (Concept, Article) pair are cached in the **Extraction Cache** keyed by `{concept}:{article_title}` with a 2-week TTL; raw Article content is never cached
- A cache hit skips both the Article fetch and the LLM extraction call; a cache miss fetches the Article and runs extraction, then caches the result
- Extractions that complete before a request timeout are cached, so a failed cold query partially warms the cache — retries converge quickly
- An **Answer** is generated from all **Findings** plus the current **Conversation**
- **Findings** and **Articles** are never stored in the **Conversation**
- A **Conversation** grows by one Query/Answer pair per turn, up to the configured cap

## Example dialogue

> **Dev:** "When the user asks 'how does crit multiplier interact with ailments?', what happens?"
> **Domain expert:** "The Concept Extractor returns two Concepts — `Critical Strike` and `Ailment`, both tagged `mechanics` — and the Orchestrator routes both to the poewiki Source Agent. The Source Agent queries the MediaWiki search API for each Concept; the wiki returns `Critical Strike` and `Critical Strike Multiplier` for the first Concept. The Source Agent fetches all three Articles in parallel, then runs one parallel extraction call per Article — each call sees only one Article and the Query, returns only the relevant sections. No single LLM call sees more than one Article. The three extractions are concatenated into one Finding. The Orchestrator synthesizes the Finding into an Answer."

> **Dev:** "The user asks a follow-up: 'how does that scale with levels?'"
> **Domain expert:** "The Orchestrator looks at the Conversation and resolves 'that' to the previous Query's subject — the interaction between `Critical Strike` and `Ailment`. It extracts both Concepts, since both are needed to answer the follow-up. The Source Agent queries the wiki for each, fetches their Articles (likely cache hits since both were just fetched), extracts the sections relevant to level scaling, and returns a curated Finding. The Orchestrator synthesizes the Finding into an Answer."

> **Dev:** "Do we store the Finding in the Conversation?"
> **Domain expert:** "No. Only the Query and Answer go into the Conversation. Findings are discarded after each Answer is generated."

## Behaviors

**Answer voice**: The Orchestrator always answers as a knowledgeable Path of Exile expert — including when it has no answer. It never cites, mentions, or references poewiki or any Source in the Answer text. Sources and stubs are implementation details invisible to the user. *"Sorry, I don't know anything about suffixes."* not *"Suffix data isn't supported yet."* *"There's no single best class for spell casting."* not *"The wiki doesn't rank classes."*

**Chat UI**: The interface is a scrolling chat thread (Query/Answer pairs). The Answer streams in progressively as the Orchestrator synthesizes it. Concepts, Articles, and Sources are internal implementation details — never surfaced in the UI.

**Out-of-scope refusal**: When a Query falls outside Path of Exile 1 mechanics, the Orchestrator detects this and returns a random pre-written message from the Refusal Pool. No LLM generation occurs for the refusal itself — the Orchestrator detects scope, then the reply is pulled from a static curated pool (e.g. *"That would cost more Mirrors of Kalandra than exist in Standard."*). The refusal pool is curated, not LLM-generated.

**Missing Article recovery**: When a Source Agent cannot find an Article for a Concept, the app does not answer from LLM training knowledge. Behavior depends on how many Concepts failed:
- **Partial failure** (some Concepts resolved, some did not): the Orchestrator answers with the Findings it has and calls out the missing Concept inline — e.g. *"I couldn't find anything for 'Ailment' — could you clarify what you mean?"* It never suggests specific alternatives it cannot ground in a Finding.
- **Total failure** (no Concepts resolved): the Orchestrator does not attempt an Answer. It tells the user nothing was found and asks for rephrasing or clarification.

In both cases, the goal is to recover the Conversation, not terminate it. The app never answers from LLM training knowledge when Articles are missing.

**Rate limiting**: Requests are rate-limited per IP address before any LLM call is made. When the limit is exceeded the user sees a friendly message. Limits are configurable and tuned to keep LLM costs bounded.

**Source Agent tooling**: Source Agents are implemented as Vercel AI SDK `tool()` calls — not as MCP servers. MCP is for extending existing AI assistants (Claude Desktop, Claude Code); this app uses LLMs as internal components. The Source Agent interface maps directly to Vercel AI SDK tools and works across all OpenRouter models that support function calling.

## Flagged ambiguities

- "RAG" was used informally — resolved: this project uses fetch-then-generate (no vector store, no embeddings). The term RAG should not appear in code or docs.
- "POEDB" was mentioned as a future Source — resolved: three Sources are planned (poewiki, PoeDB, PoeAPI). All three Domains are registered in v1; poewiki has a real Source Agent, PoeDB and PoeAPI have Stub Source Agents.
