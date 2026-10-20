# Capability matrix

The live version of this table is in the app under **Status → Capabilities**, computed from the server's `/api/status`
and the browser's actual APIs. This is the static reference.

| Capability | Without configuration | With configuration | Notes |
|---|---|---|---|
| Conversation | Demo brain — commands, skills, memory only; says it is not an LLM | Any OpenAI-compatible endpoint or Anthropic | Quality depends on the model |
| Streaming | No (demo answers in one piece) | Yes for OpenAI-compatible & Anthropic | Head metadata first, then text, then trailing metadata |
| Research | Unavailable (stated in reply) | Wikipedia (free) / SearXNG / Tavily | Sources shown with retrieval time; untrusted data |
| Memory | IndexedDB in this browser | — | Consent-based; off switch; delete removes records |
| Skill learning | Yes (procedural generator) | LLM can also author keyframes/compositions/expressions | Always validated; new skills need approval |
| Voice input | Browser-dependent (Chrome/Edge) | — | Optional review before sending |
| Voice output | Browser/OS voices | — | Approximate mouth shapes |
| Desktop notifications | Optional, permission-gated | — | Only when the tab is hidden; content-free |
| Model training | **Not available** | **Not available** | By design |
