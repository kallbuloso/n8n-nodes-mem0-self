# Changelog

All notable changes to this project are documented in this file.

This project follows Semantic Versioning (`MAJOR.MINOR.PATCH`).

## [0.3.0] - 2026-04-18

### Added
- Reintroduced **hybrid memory retrieval** for `Mem0 Chat Memory`:
  - recent conversation buffer (`GET /memories`)
  - semantic fallback (`POST /search`)
- Added/restored node parameters for hybrid behavior:
  - `memoryMode` (`conversation_pairs`, `semantic_facts`)
  - `bufferLimit`
  - `fallbackToSearchOnBufferMiss`
  - `conversationRetrievalPolicy` (`smart_fallback`, `search_first`, `buffer_first`)
  - `debugMemory`
- Added examples folder with importable n8n workflow:
  - `examples/mem0-chat-memory-hybrid-smart-fallback.workflow.json`
  - `examples/README.md`

### Changed
- Buffer retrieval now prioritizes the **latest interactions** (`slice(-maxMessages)`) with chronological output.
- Added continuity behavior for `run_id` sessions:
  - load recent messages from current run
  - if insufficient, backfill recent context from same `user_id + agent_id` (without `run_id`).
- Updated memory write metadata source to `n8n_mem0_memory_hybrid`.
- Improved semantic retrieval diagnostics and error propagation.

### Fixed
- Fixed assistant-memory filtering behavior:
  - when `includeAssistantMemories = false`, only `user/human` memories are kept.
- Removed silent search failure behavior; now raises explicit `NodeOperationError` if all scope candidates fail.
- Restored `legacy` search strategy compatibility for existing workflows/tests.

### Validation
- `npm run build` passed.
- `node test-integration.js` passed.
- `node test-mem0-memory.js` passed.

---

## [0.2.x] - 2026-04-15 to 2026-04-17

### Summary
- Initial Self-Hosted Mem0 memory node release.
- Search and context controls (`topK`, `searchMode`, `maxContextChars`, `searchFilters`, `storeStrategy`).
- Iterative fixes for n8n AI Agent compatibility and memory key handling.
- Earlier sliding-window implementation introduced in `0.2.13` and later replaced by the current hybrid model in `0.3.0`.
