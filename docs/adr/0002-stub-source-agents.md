# Stub Source Agents for unbuilt data sources

The app needs to route Concepts across three Domains (mechanics, items, market) from day one, but only the poewiki Source Agent is built in v1. Rather than leaving PoeDB and PoeAPI unregistered until they are implemented, we register Stub Source Agents for their Domains immediately. A stub fulfills the Source Agent interface and returns an "unsupported" Finding — no data fetching, no LLM calls. This keeps the routing table complete and lets the Orchestrator give users honest, domain-aware responses ("suffix data isn't supported yet") instead of silently ignoring the items or market dimension of a query.

## Considered Options

- **Leave future Domains unregistered** — simpler in the short term, but the Orchestrator would silently drop items/market Concepts with no user-visible explanation. Routing logic would also need to change when real Source Agents are added.
- **Route all unrecognised Concepts to poewiki as fallback** — poewiki would return irrelevant or empty Findings for items/market Concepts, and the Orchestrator would have no signal that the domain is unsupported rather than just unfound.
