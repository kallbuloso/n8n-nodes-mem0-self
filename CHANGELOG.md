# Changelog

All notable changes to this project are documented in this file.

This project follows Semantic Versioning (`MAJOR.MINOR.PATCH`).

## [0.2.9] - 2026-04-16

### Added
- `conversation_pairs` mode now supports strict buffer behavior plus semantic fallback.
- New parameter: `fallbackToSearchOnBufferMiss` (default: `true`) for `conversation_pairs`.

### Changed
- In `conversation_pairs`, buffer loading now uses strict scope first (`user_id + agent_id + run_id` when available) to avoid loading broad history.
- Buffer limit is enforced as `bufferLimit * 2` messages (user+assistant turns).

### Fixed
- Fixed behavior where buffer could appear to ignore `Buffer Limit (Interactions)` due to broad scope fallback.
- Added fallback to `POST /search` only when the query appears unrelated to buffer content.

---

## [0.2.8] - 2026-04-16

### Added
- New parameter: `memoryMode`:
  - `semantic_facts`
  - `conversation_pairs`
- New parameter: `bufferLimit` (default: `20`) for conversation context window in interactions.

### Changed
- `loadMemoryVariables` can now return chronological `human + ai` context in `conversation_pairs`.

### Fixed
- Improved compatibility for workflows that need conversational memory without a System Message in AI Agent.

---

## [0.2.7] - 2026-04-16

### Added
- New parameter: `searchMode` (`balanced | strict_facts | legacy`).
- New parameter: `maxContextChars` to cap retrieved context size before sending to the model.
- New parameter: `storeStrategy` (`conversation | facts_only`).
- New parameter: `searchFilters` (JSON) for metadata-filtered search payloads.
- New parameter: `allowEmptyContext` for strict/controlled fallback behavior.

### Changed
- Retrieval pipeline now supports:
  - semantic ranking + recency tie-break,
  - deduplication,
  - context character budgeting.
- Store metadata standardized (`source`, `role`, `channel`, `memory_type`).
- `infer` now actively affects store payload (`POST /memories`).

### Fixed
- Reduced noisy context growth while keeping retrieval compatibility.

---

## [0.2.6] - 2026-04-16

### Changed
- Search scope fallback cascade implemented:
  1. `user_id + agent_id + run_id`
  2. `user_id + agent_id`
  3. `user_id`

### Fixed
- Fixed empty `chat_history` scenarios in `loadMemoryVariables` when strict scope returned no results.
- Added stronger guardrails for query extraction and fallback query usage.

---

## [0.2.5] - 2026-04-15

### Added
- New parameter: `includeAssistantMemories` (default: `false`).

### Changed
- `POST /search` results now go through structured post-processing:
  - role-based filtering,
  - deduplication,
  - ordering improvements to reduce stale/conflicting memories.

### Fixed
- Improved factual recall quality for prompts like “qual o meu nome?” in noisy sessions.

---

## [0.2.4] - 2026-04-15

### Changed
- Retrieval switched to search-first behavior:
  - Persist with `POST /memories`
  - Retrieve with `POST /search`
- Removed dependency on `GET /memories` for semantic retrieval path.

### Fixed
- Reduced token overhead caused by loading large raw memory sets.

---

## [0.2.3] - 2026-04-15

### Changed
- Refactored memory object contract to align with n8n AI expectations (LangChain memory semantics).
- Focused implementation on Mem0 Self-Hosted OSS endpoints.

### Fixed
- HTTP payload handling hardening in API helper for JSON body requests.
- Improved compatibility between `Mem0Memory` and AI Agent runtime behavior.

---

## [0.2.2] - 2026-04-15

### Added
- Retrieval stability improvements with role-aware mapping and safety guardrails.

### Changed
- Default store behavior tuned for chat persistence reliability.

### Fixed
- Multiple integration issues around memory loading and save path.

---

## [0.2.1] - 2026-04-15

### Added
- Compatibility methods in chat history integration:
  - `addAIMessage`
  - `addMessage`
  - `addMessages`

### Changed
- Workflow example adjusted for community node type compatibility in n8n.

### Fixed
- Improved interoperability with AI Agent memory contract.

---

## [0.2.0] - 2026-04-15

### Added
- Initial `Mem0Memory` release focused on Mem0 Self-Hosted memory for n8n AI Agent.
- Package focus narrowed to `Mem0 Chat Memory` node for safe profile usage.
- MIT license and updated README for self-hosted usage.

### Changed
- Project scope shifted to `Mem0Memory` as the primary production target.

---

## Notes

- Versions prior to `0.2.0` are not part of the current maintained line.
- This changelog reflects published releases and implementation milestones from this repository workflow.
