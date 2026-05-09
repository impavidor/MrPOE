# Source Agent Registry Pattern

The app will need to query multiple data sources (poewiki, PoeDB, PoeAPI) as it grows, each with different domains and access patterns. Rather than hardcoding source-specific logic into the Orchestrator, we model each data source as a Source Agent that implements a shared interface (`receive(concepts, query) → Finding`). The Orchestrator dispatches to a registry of Source Agents and never calls any source directly. Routing is driven by a data table mapping information domains to Sources, not if/else logic in the Orchestrator.

We start with only the poewiki Source Agent, but the interface and registry are established from day one so that adding PoeDB or PoeAPI means implementing the interface and registering the agent — nothing else changes.

## Considered Options

- **Direct calls per source** — simpler to start, but bakes source-specific logic into the Orchestrator and requires rearchitecting when sources are added.
- **Always fan out to all sources** — simpler routing, but wastes LLM calls on sources that have no relevant content for a given Query. Unacceptable given the cost constraint.
