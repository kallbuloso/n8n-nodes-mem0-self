# n8n-nodes-mem0-self

Community node package for **Mem0 Self-Hosted (OSS REST API)** memory in n8n AI workflows.

> This package is community-maintained and focused on Self-Hosted Mem0 deployments.

## Introduction

`n8n-nodes-mem0-self` provides a memory node for n8n AI Agent workflows with:

- persistent memory storage (`POST /memories`)
- semantic retrieval (`POST /search`)
- conversation-buffer retrieval (`GET /memories`)
- scoped isolation by `user_id`, `agent_id`, and optional `run_id`

Current memory node:

- `Mem0 Chat Memory` (`mem0Memory`)

## Quick Start (3 minutes)

1. Install via Community Nodes:
- `Settings -> Community Nodes -> Install`
- Package: `n8n-nodes-mem0-self`
- Restart n8n

2. Create credentials:
- `Credentials -> New -> Mem0 Self-Hosted API`
- `Base URL`: for example `http://localhost:8000`
- `API Key`: your Mem0 `X-API-Key`

3. Wire your workflow:
- Add `AI Agent`
- Connect your chat model to `ai_languageModel`
- Add `Mem0 Chat Memory` and connect to `ai_memory`

4. Configure identity:
- `User ID` (required)
- `Agent ID` (required)
- `Run ID` (recommended)

## Installation

### Community Nodes (recommended)

1. Open n8n
2. Go to `Settings -> Community Nodes`
3. Click `Install`
4. Enter `n8n-nodes-mem0-self`
5. Restart n8n

### Manual install

```bash
npm install n8n-nodes-mem0-self@latest
```

Restart n8n after installation.

## Credentials

Credential type: **Mem0 Self-Hosted API**

Required fields:

1. `Base URL`
- Example: `http://localhost:8000`
- Purpose: Mem0 REST API base endpoint

2. `API Key`
- Sent as `X-API-Key`
- Purpose: request authentication for Mem0

## Included Node

### Mem0 Chat Memory (`mem0Memory`)

Memory provider node for n8n AI Agent, with hybrid and semantic retrieval modes.

## Parameter Reference

### Identity and Scope

1. `User ID` (`userId`)
- Required: Yes
- Why: isolates memory by end user

2. `Agent ID` (`agentId`)
- Required: Yes
- Why: isolates memory by assistant/persona

3. `Run ID` (`runId`)
- Required: No (recommended)
- Why: session-level memory partitioning

### Retrieval Controls

1. `Top K` (`topK`)
- Max search results to retrieve

2. `Memory Mode` (`memoryMode`)
- `conversation_pairs`: recent conversation buffer + optional semantic fallback
- `semantic_facts`: semantic retrieval only

3. `Buffer Limit (Interactions)` (`bufferLimit`)
- Latest interaction pairs to load in conversation mode
- Effective message cap is `bufferLimit * 2`

4. `Fallback to Search on Buffer Miss` (`fallbackToSearchOnBufferMiss`)
- Enables semantic fallback when recent buffer is likely unrelated

5. `Conversation Retrieval Policy` (`conversationRetrievalPolicy`)
- `smart_fallback` (recommended)
- `search_first`
- `buffer_first`

6. `Search Query (Optional)` (`searchQuery`)
- Overrides extracted input query when provided

7. `Fallback Query` (`defaultQuery`)
- Used when no query can be extracted from input

8. `Search Mode` (`searchMode`)
- `balanced`
- `strict_facts`
- `all`
- `legacy` (compatibility)

9. `Max Context Characters` (`maxContextChars`)
- Hard cap for injected memory context size

10. `Rerank Results` (`rerank`)
- Enables Mem0 reranking during search

11. `Fields (Comma Separated)` (`fields`)
- Optional response field projection for search

12. `Search Filters (JSON)` (`searchFilters`)
- Optional Mem0 search filters payload

13. `Include Assistant Memories` (`includeAssistantMemories`)
- Include assistant-side memories in retrieval

14. `Allow Empty Context` (`allowEmptyContext`)
- Controls strict empty-context behavior

15. `Debug Memory Retrieval` (`debugMemory`)
- Adds retrieval diagnostics metadata for troubleshooting

### Storage Controls

1. `Store Strategy` (`storeStrategy`)
- `conversation`: store user + assistant turns
- `facts_only`: store user-side factual signals only

2. `Infer on Store (Legacy)` (`infer`)
- Optional Mem0 infer flag on writes

## Recommended Defaults

For production-first hybrid behavior:

1. `memoryMode = conversation_pairs`
2. `conversationRetrievalPolicy = smart_fallback`
3. `bufferLimit = 20`
4. `topK = 4..6`
5. `maxContextChars = 700..1200`
6. `searchMode = balanced`

## Examples

Ready-to-import examples are in:

- [examples/README.md](examples/README.md)
- [examples/mem0-chat-memory-hybrid-smart-fallback.workflow.json](examples/mem0-chat-memory-hybrid-smart-fallback.workflow.json)

## Testing

Validated in local package tests:

- `npm run build`
- `node test-integration.js`
- `node test-mem0-memory.js`

## Notes

- This package focuses on Mem0 Self-Hosted endpoints.
- To avoid unexpected memory mixing in production, always set stable `userId` and `agentId`, and prefer setting `runId`.

## License

MIT
