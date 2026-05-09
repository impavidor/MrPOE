# PRD: PoE Assistant — v1

## Problem Statement

Path of Exile 1 players need quick, reliable answers to mechanics questions while playing. General-purpose AI assistants give plausible but unverifiable answers, and searching poewiki.net manually interrupts the flow of play. There is no conversational tool that grounds PoE mechanics answers directly in the wiki and lets players ask follow-up questions naturally.

## Solution

A chat-style web application where players ask Path of Exile 1 mechanics questions in natural language and receive answers grounded exclusively in poewiki.net content. The app shows its work in real time — which Concepts were identified, which Articles were fetched — so players can trust the source of every answer. Follow-up questions work naturally because the app maintains a Conversation of prior Q&A pairs to resolve references like "how does that scale with levels?".

## User Stories

1. As a PoE player, I want to ask a mechanics question in plain English, so that I don't have to know the exact wiki page title to find information.
2. As a PoE player, I want to see which game Concepts the app identified from my question, so that I can verify it understood what I was asking.
3. As a PoE player, I want to see which wiki Articles are being fetched, so that I can trust the source of the answer.
4. As a PoE player, I want the Answer to stream in progressively, so that I don't stare at a blank screen waiting.
5. As a PoE player, I want to ask follow-up questions without restating the full context, so that I can have a natural back-and-forth conversation.
6. As a PoE player, I want follow-up questions that reference "that" or "it" to be resolved correctly, so that the app understands what I mean.
7. As a PoE player, I want my Conversation to persist across page refreshes, so that I don't lose context when I accidentally close the tab.
8. As a PoE player, I want the app to still answer what it can when only some Concepts are missing, so that I get a partial answer rather than nothing.
9. As a PoE player, I want the app to tell me which Concept it couldn't find and ask me to clarify, so that I can recover without starting over.
10. As a PoE player, I want the app to ask for rephrasing when it can't find anything at all, so that I know the full question failed and why.
11. As a PoE player, I want the app to refuse off-topic questions with a PoE-flavored message, so that the experience stays fun even when I ask something out of scope.
12. As a PoE player, I want answers that only cover what I asked about, so that I'm not overwhelmed by irrelevant mechanic details from the same wiki page.
13. As a PoE player, I want the app to handle questions that span multiple Concepts (e.g. crit and ailments), so that I don't have to ask two separate questions.
14. As a PoE player, I want the app to be fast on repeat questions, so that cached answers feel instant.
15. As a PoE player, I want the interface to feel like a chat conversation, so that asking questions feels natural rather than like filling out a search form.

## Implementation Decisions

### Modules

**Concept Extractor**
A dedicated LLM agent with two closely related responsibilities: (1) detect whether the Query is about Path of Exile 1 mechanics, and (2) if so, resolve anaphoric references against prior Queries and return a structured list of Concepts, each annotated with the Domains it touches (e.g. `mechanics`, `items`, `market`). Receives only the Query sequence from the Conversation — not full Q/A pairs — since anaphoric references point back to what the user asked, not what the app answered. Its interface returns a discriminated union: `(query, priorQueries) → {outOfScope: true} | {concepts: {concept, domains[]}[]}`. Domain annotation drives deterministic routing downstream — this is the only place that reasons about scope and which Sources are relevant. Uses the cheapest available model via OpenRouter — extraction is a classification task, not a reasoning task. Testable in isolation with PoE query fixtures.

**Orchestrator**
Coordinates the full pipeline: invokes the Concept Extractor, inspects its result, and if `outOfScope: true`, returns a random refusal from the Refusal Pool immediately. Otherwise routes Concepts to registered Source Agents via the Source Agent Registry, collects Findings, and synthesizes an Answer. Streams pipeline steps (Concepts identified, Articles fetched) and the final Answer back to the frontend. Never parses raw Query text.

**Source Agent Registry**
A plugin registry mapping Source names to Source Agent implementations. Routing is driven by a data table mapping Domains to Sources — each annotated Concept fans out to every Source that owns one of its Domains. Adding a real Source (PoeDB, PoeAPI) means replacing its Stub Source Agent with a real implementation — the Orchestrator and registry are never modified. Interface: `register(source) / route(annotatedConcepts) → Map<sourceAgent, concepts[]>`.

Three Source Agents are registered in v1:
- **poewiki Source Agent** — real implementation, owns `mechanics`
- **PoeDB Stub Source Agent** — stub, owns `items`; returns an empty Finding
- **PoeAPI Stub Source Agent** — stub, owns `market`; returns an empty Finding

**poewiki Source Agent**
The only real Source Agent in v1. Owns the `mechanics` Domain. Implements the shared Source Agent interface: `(concepts[], query) → Finding`. For each Concept, queries the MediaWiki search API to retrieve relevant Article titles (the wiki acts as the index — no LLM reasoning needed for page discovery). For each (Concept, Article title) pair, performs a cache lookup via the Article Cache — the cache handles deduplication naturally: first lookup fetches and stores, subsequent lookups for the same title are instant hits. Runs one parallel extraction call per (Concept, Article) pair — each call receives one Article, one Concept, and the Query, and returns only the sections relevant to that specific Concept. Two Concepts resolving to the same Article each get their own extraction call on the cached content, targeting different sections. No single LLM call ever receives more than one Article. Assembles all extractions into one structured Finding grouped by Concept and Article, preserving provenance so the Orchestrator knows which content belongs to which Concept. If the total Finding exceeds a configured token budget, falls back to a summarization pass to compress — summarization is the exception, not the default. Three configurable constants govern extraction volume:
- **Article cap per Concept** (default: 3) — search results beyond this are silently dropped.
- **Per-extraction token cap** (default: 2k tokens) — limits each individual Article/Concept extraction call.
- **Total Finding token cap** (default: 8k tokens) — if the concatenated Finding exceeds this, the Source Agent runs a summarization pass to compress before returning to the Orchestrator. Summarization is the exception, not the default.

**Article Cache**
Wraps Upstash Redis. Interface: `get(title) / set(title, content)`. Cache key is Article title. TTL is 2 weeks — PoE 1 wiki articles change only after patches. The only caching layer; there is no Answer cache.

**MediaWiki Client**
Thin, stateless wrapper around the poewiki.net MediaWiki API. Two operations: `search(concept) → title[]` and `fetch(title) → content`. Knows nothing about caching, LLMs, or Source Agents. Always called through the Article Cache, never directly. Two things are to be determined by spiking against real poewiki pages before committing to an implementation: (1) the optimal Article content format (wikitext, HTML, or plain text extract); (2) the optimal search endpoint (`action=opensearch` vs `action=query&list=search`) — specifically whether the API handles colloquial PoE terms ("crit", "shock stacking", "dot multi") well enough that the Concept Extractor does not need to normalize Concepts to canonical wiki titles before searching.

**Rate Limiter**
Protects the backend from abuse and uncontrolled LLM costs. Applied at the Vercel API route level before any LLM call is made. Implemented with `@upstash/ratelimit` on the same Upstash Redis instance as the Article Cache — no additional infrastructure. Rate limiting is per IP address (no user accounts exist). Limits are configurable constants (requests per window and window duration) to be tuned based on expected traffic and cost tolerance. When a request is rejected, the API returns HTTP 429 and the frontend shows a friendly message. The OpenRouter API key is a server-side Vercel environment variable — never exposed to the client.

**Refusal Pool**
Static module. Holds a curated list of PoE-flavored refusal messages (e.g. *"That would cost more Mirrors of Kalandra than exist in Standard."*). Interface: `getRandom() → string`. No LLM involved — purely pre-written strings.

**Conversation Store**
Persists the Conversation (Q&A pairs only — never Article or Finding content) to browser `localStorage`. Interface: `load() / save(conversation)`. Resets when storage is cleared. No server-side persistence. Enforces a configurable maximum turn count (default: 20) — older pairs are dropped when the cap is exceeded.

**Chat UI**
React frontend using Vercel AI SDK's `useChat` hook. Renders a scrolling chat thread of Query/Answer pairs. Shows pipeline steps in real time as the Orchestrator streams them: Concepts being identified, Articles being fetched. Final Answer streams in after Findings are synthesized. Pipeline steps are delivered as typed data stream parts via `sendDataStreamPart()` on the server and read from `useChat`'s `data` field on the client — all within a single HTTP streaming response, no separate SSE channel.

### Architecture

- Frontend: React 19 + TypeScript, deployed to Vercel
- Backend: Vercel serverless functions (API routes)
- LLM: OpenRouter via Vercel AI SDK — cheapest capable model for Concept Extractor, slightly better model for Orchestrator synthesis
- Cache: Upstash Redis (Article Cache only)
- Source Agent tooling: Vercel AI SDK `tool()` calls — not MCP servers

### Pipeline per turn

1. Frontend sends Query + Conversation to the Vercel API route
2. Concept Extractor receives Query + prior Queries (not full Q/A pairs), returns `{outOfScope: true} | {concepts: [...]}`
3. If `outOfScope`, Orchestrator returns a random refusal from the Refusal Pool immediately — no further LLM calls
4. Orchestrator streams "Concepts identified: X, Y" to frontend
5. Source Agent Registry routes Concepts to the poewiki Source Agent
6. poewiki Source Agent queries MediaWiki search API per Concept (parallel), fetches all Articles in parallel via Article Cache, runs one parallel extraction LLM call per Article, concatenates extractions into one Finding
7. Orchestrator streams "Fetched Articles: A, B, C" to frontend
8. Orchestrator synthesizes Finding + Conversation into Answer, streams to frontend
9. Frontend appends Query/Answer pair to Conversation, saves to localStorage

### Caching

| Layer | Key | Value | TTL |
|-------|-----|-------|-----|
| Article Cache | Article title | Full wiki page content | 2 weeks |

Search results (Concept → Article titles) may be cached separately from Article content as a future optimisation.

## Testing Decisions

A good test covers external behaviour only — what goes in and what comes out — not implementation details like which internal function was called or how many times.

Modules to test:

- **MediaWiki Client** — unit tests: given a Concept string, assert correct API URLs are constructed and responses are parsed into the expected shape. Mock the HTTP layer only.
- **Article Cache** — unit tests: assert cache hits return stored content, cache misses fall through, TTL is set correctly. Use a real Upstash test instance or an in-memory Redis mock.
- **Concept Extractor** — two test layers: (1) CI fixtures using recorded LLM responses — fast, deterministic, free; assert the discriminated union shape, anaphoric resolution, and domain annotation for known Queries. (2) A manual eval suite (`npm run eval`) that runs against the real model on demand — run before any prompt change to catch annotation or scope regressions. The eval suite covers two categories: concept extraction (vague Concepts, cross-domain Queries, anaphoric follow-ups) and scope detection (clearly off-topic queries, PoE 2 questions, and borderline cases like "what's the best build" vs. "what's the best build for Kitava's fight").
- **poewiki Source Agent** — integration tests: given Concepts and a Query, assert the Finding contains only relevant content and not noise from unrelated Article sections.
- **Source Agent Registry** — unit tests: assert routing table maps Concepts to the correct Source Agent; assert registering a new Source does not affect existing routing.
- **Conversation Store** — unit tests: assert save/load round-trips correctly, assert Finding content is never persisted.

No tests for the Refusal Pool (static strings) or Chat UI (visual, test manually).

## Out of Scope

- Path of Exile 2 mechanics
- PoeDB as a Source (item data, affixes, suffixes)
- PoeAPI as a Source (live market data, exchange rates)
- User accounts or server-side Conversation persistence
- Answer caching (only Article content is cached)
- Vector embeddings or semantic search
- MCP server integration
- Multi-language support

### Answer Voice

The Orchestrator always answers as a knowledgeable Path of Exile expert — including when it has no answer. It must never cite, mention, or reference poewiki, any Source, or stub status in the Answer text. Sources and stubs are implementation details invisible to the user. Wrong: *"The wiki doesn't rank classes by best."* Wrong: *"Suffix data isn't supported yet."* Right: *"There's no single best class for spell casting."* Right: *"Sorry, I don't know anything about suffixes."*

## Further Notes

- The Source Agent Registry and shared Source Agent interface are established in v1 even though only one Source exists. This is intentional — see `docs/adr/0001-source-agent-registry.md`.
- "RAG" should not appear in code or docs. The pattern used here is fetch-then-generate.
- The Refusal Pool messages should reference PoE 1 lore and in-game items/characters (Kitava, Mirrors of Kalandra, the Shaper, Eternal Labyrinth, etc.).
