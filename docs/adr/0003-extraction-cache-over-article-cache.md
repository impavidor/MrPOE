# Cache extracted sections, not raw Article content

The app runs one LLM extraction call per (Concept, Article) pair on every request, even when the underlying Article content hasn't changed. On a cold query with 3 Concepts × 3 Articles each, that's 9 parallel LLM calls before Orchestrator synthesis — enough to breach Vercel Hobby's 10-second execution limit.

Rather than caching raw Article content (which only eliminates the MediaWiki fetch, not the extraction calls), we cache the extraction output keyed by `{concept}:{article_title}`. A cache hit skips both the Article fetch and the LLM extraction call. For repeat questions — common in PoE, where players ask about the same mechanics repeatedly — hot-path latency drops to MediaWiki searches + Orchestrator synthesis only.

On a cold miss the Agent fetches the Article directly from MediaWiki (no intermediate Article cache) and runs the extraction, then caches the result. Cold queries that time out still cache whatever extractions completed before the timeout — retries converge quickly because the cache is partially warmed by the failed run.

## Considered Options

- **Article cache (raw content)** — eliminates MediaWiki fetches on repeat queries, but LLM extraction still runs every time. Does not address the Hobby timeout risk.
- **Two-layer cache (Article cache + Extraction cache)** — eliminates both fetches and extraction calls on hot paths, and eliminates fetches on partial misses. More complex, more Redis storage. The marginal benefit of caching raw Article content is small since MediaWiki fetches are fast compared to LLM calls.
- **Extraction cache only** — eliminates LLM extraction calls on hot paths. Cold misses fetch directly from MediaWiki; raw content is never stored. Simpler than two layers with most of the benefit.
