# n8n-nodes-mem0-self

Community node package for using **Mem0 Self-Hosted** as memory in n8n AI workflows.

This package currently provides one memory node:

- `Mem0 Chat Memory` (`mem0Memory`)

---

## Quick Start (3 minutes)

1. Install via n8n Community Nodes:
- Go to `Settings` -> `Community Nodes` -> `Install`
- Package: `n8n-nodes-mem0-self`
- Restart n8n

2. Create credentials:
- Open `Credentials` in n8n
- Create `Mem0 Self-Hosted API`
- Set `Base URL` (example: `http://localhost:8000`)
- Set `API Key` (`X-API-Key`)

3. Wire your workflow:
- Add `AI Agent`
- Connect your chat model to `ai_languageModel`
- Add `Mem0 Chat Memory` and connect it to `ai_memory`
- Set `User ID` and `Agent ID` (required), and `Run ID` (recommended)

4. Run a basic validation:
- Ask a message that contains a personal fact (for example, your name)
- Send another message asking the agent to recall it
- Confirm recall works and context size remains controlled by your chosen mode/settings

---

## Introduction

Mem0 is an intelligent memory layer for AI agents and applications.

This package provides custom n8n memory integration for Mem0 **Self-Hosted (OSS REST API)**, enabling persistent memory directly in n8n AI Agent workflows with:

1. Semantic memory retrieval (`POST /search`)
2. Conversation-pair buffering (`human + ai`)
3. Session/user/agent memory scoping
4. Token-aware context controls

---

## Overview

`Mem0 Chat Memory` is designed for n8n AI Agents and supports:

1. Storing memory with `POST /memories`
2. Retrieving memory with:
   - semantic search (`POST /search`)
   - conversation buffer mode (latest human+ai turns)
3. Scoped memory isolation by:
   - `user_id` (required)
   - `agent_id` (required)
   - `run_id` (optional but strongly recommended for session isolation)

It is built for Mem0 OSS/self-hosted REST API usage.

---

## Installation

## Community Nodes panel (recommended)

In n8n:

1. Go to `Settings` -> `Community Nodes`
2. Click `Install`
3. Enter package name: `n8n-nodes-mem0-self`
4. Confirm installation
5. Restart n8n

## Manual installation

Install the package in your n8n runtime environment:

```bash
npm install n8n-nodes-mem0-self@latest
```

Restart n8n after installation.

## Local development install

```bash
npm install
npm run build
```

If testing with local n8n, make sure this package is available in the n8n runtime environment, then restart n8n.

---

## n8n Setup

Typical workflow wiring:

1. Trigger node (`Manual Trigger`, `Chat Trigger`, etc.)
2. `AI Agent`
3. `Chat Model` node connected to Agent `ai_languageModel`
4. `Mem0 Chat Memory` connected to Agent `ai_memory`

Without the `ai_memory` connection, the AI Agent will not use this memory node.

---

## Credentials

Credential type: **Mem0 Self-Hosted API**

Required values:

1. `Base URL`
- Example: `http://localhost:8000`
- Purpose: base endpoint for Mem0 REST API

2. `API Key` (header: `X-API-Key`)
- Purpose: authenticates requests against your Mem0 server

---

## Included Nodes

This package currently includes:

1. `Mem0 Chat Memory`
- n8n AI memory provider for Mem0 Self-Hosted
- Supports semantic memory retrieval and conversation-pair buffering
- Connects directly to AI Agent via `ai_memory`

Note:

1. This package is focused on Self-Hosted memory workflows.
2. It does not expose Mem0 Cloud credential flow in this package line.

---

## Node Parameters (Detailed)

Below is a complete reference for every field in `Mem0 Chat Memory`.

## Identity and Scope

### `User ID` (`userId`)
- Required: **Yes**
- What it is: unique identifier of the end user.
- Why it exists: isolates memory by user.
- Importance: **Critical**. Incorrect value can mix memory between users.

### `Agent ID` (`agentId`)
- Required: **Yes**
- What it is: identifier of the agent/persona using memory.
- Why it exists: isolates memory per assistant/agent.
- Importance: **Critical**.

### `Run ID` (`runId`)
- Required: **No**
- What it is: session/conversation identifier.
- Why it exists: allows per-session memory partitioning.
- Importance: **High** for multi-session use cases.
- Recommendation: set this for strict conversation boundaries.

## Retrieval Controls

### `Top K` (`topK`)
- Required: **No** (default provided)
- What it is: max number of relevant memory items to retrieve in search mode.
- Why it exists: controls retrieval size and token usage.
- Importance: **High** for cost/performance tuning.

### `Memory Mode` (`memoryMode`)
- Required: **No**
- Options:
  - `semantic_facts`: semantic retrieval focused on relevant facts.
  - `conversation_pairs`: chronological conversation retrieval (`human + ai`).
- Why it exists: supports different memory strategies for different workflows.
- Importance: **High** (primary behavior selector).

### `Buffer Limit (Interactions)` (`bufferLimit`) *(shown when `memoryMode=conversation_pairs`)*
- Required: **No** (default `20`)
- What it is: number of latest user+assistant interactions to load.
- Technical behavior: each interaction is two messages, so max messages = `bufferLimit * 2`.
- Why it exists: prevents loading full conversation history by default.
- Importance: **High** for token control.

### `Fallback to Search on Buffer Miss` (`fallbackToSearchOnBufferMiss`) *(shown when `memoryMode=conversation_pairs`)*
- Required: **No** (default `true`)
- What it is: if buffer seems unrelated to current query, fallback to semantic search.
- Why it exists: combines low-cost recent context with semantic recovery when needed.
- Importance: **High** for recall quality.

### `Search Mode` (`searchMode`)
- Required: **No**
- Options:
  - `balanced` (recommended): factual prioritization + safe fallback behavior.
  - `strict_facts`: stricter factual preference.
  - `legacy`: compatibility behavior.
- Why it exists: controls post-processing strategy for search results.
- Importance: **Medium/High**.

### `Max Context Characters` (`maxContextChars`)
- Required: **No** (default `700`)
- What it is: max total characters injected into AI memory context.
- Why it exists: direct cap on memory payload size (and token growth).
- Importance: **High** for predictable token usage.

### `Default Query` (`defaultQuery`)
- Required: **No**
- What it is: fallback search query when no user input can be extracted.
- Why it exists: avoids empty retrieval queries in edge workflows.
- Importance: **Medium**.

### `Rerank` (`rerank`)
- Required: **No** (default `false`)
- What it is: enables Mem0 reranking on search.
- Why it exists: can improve relevance in some datasets.
- Importance: **Situational** (quality vs latency/cost tradeoff).

### `Fields (Comma Separated)` (`fields`)
- Required: **No**
- What it is: optional fields sent in search payload.
- Why it exists: advanced response shaping/customization.
- Importance: **Advanced usage**.

### `Include Assistant Memories` (`includeAssistantMemories`)
- Required: **No** (default `false`)
- What it is: include assistant-generated memory entries in retrieval.
- Why it exists: some scenarios need full dialog context; others prefer user facts only.
- Importance: **Medium**.

### `Search Filters (JSON)` (`searchFilters`)
- Required: **No**
- What it is: JSON filters passed to Mem0 `POST /search`.
- Why it exists: metadata-filtered retrieval (precision control).
- Importance: **High** for advanced production tuning.
- Note: invalid JSON returns a validation error.

### `Allow Empty Context` (`allowEmptyContext`)
- Required: **No** (default `false`)
- What it is: allows returning empty context without aggressive fallback.
- Why it exists: explicit control over strict retrieval behavior.
- Importance: **Medium**.

## Storage Controls

### `Store Strategy` (`storeStrategy`)
- Required: **No**
- Options:
  - `conversation` (compatible default): store user and assistant turns.
  - `facts_only`: store user-side factual signals only.
- Why it exists: lets you choose between conversational trace and lower-noise factual memory.
- Importance: **High** for long-term memory quality.

### `Infer on Store` (`infer`)
- Required: **No** (default `false`)
- What it is: passes infer flag to Mem0 on memory write.
- Why it exists: enables Mem0 inference/extraction workflows where appropriate.
- Importance: **Situational**.

---

## Recommended Configurations

## A) Low-token factual memory

Use:

1. `memoryMode = semantic_facts`
2. `searchMode = balanced`
3. `topK = 3..6`
4. `maxContextChars = 500..900`
5. `storeStrategy = facts_only`
6. `includeAssistantMemories = false`

## B) Recent conversation memory

Use:

1. `memoryMode = conversation_pairs`
2. `bufferLimit = 10..20`
3. `fallbackToSearchOnBufferMiss = true`
4. `storeStrategy = conversation`

---

## Troubleshooting

### 1) `chat_history` is empty

Check:

1. `userId` and `agentId` values are correct and consistent.
2. `runId` matches the same session where memory was stored.
3. `searchFilters` is valid and not overly restrictive.
4. `allowEmptyContext` behavior matches your expectations.

### 2) Token usage is too high

Tune:

1. Lower `topK`
2. Lower `maxContextChars`
3. Use `facts_only`
4. Use `conversation_pairs` + smaller `bufferLimit`

### 3) Memory quality is noisy

Try:

1. `searchMode = balanced` or `strict_facts`
2. `includeAssistantMemories = false`
3. `storeStrategy = facts_only`
4. Add `searchFilters` based on metadata

---

## Safety Notes

1. Keep API keys only in n8n credentials.
2. Use stable ID design (`userId`, `agentId`, `runId`) to avoid context leakage.
3. This node is intended for safe memory operations in normal workflow usage.

---

## Changelog

See detailed release history in:

- [CHANGELOG.md](./CHANGELOG.md)

---

## License

MIT
