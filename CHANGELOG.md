# Changelog

All notable changes to this project are documented in this file.

This project follows Semantic Versioning (`MAJOR.MINOR.PATCH`).

## [0.2.11] - 2026-04-16

### Added
- Comprehensive test suite validating all core corrections and node configuration.
- `TEST_REPORT.md` documenting full test coverage and compatibility matrix.
- Enhanced documentation of retrieval policies and memory modes.

### Fixed
- **CRITICAL**: Fixed `toLangchainMessage()` to include `additional_kwargs` and `response_metadata` in all message objects for proper LangChain compatibility with AI Agent.
- **CRITICAL**: Enhanced `extractResults()` to handle nested API response structures (`data.results`, `memories` arrays) for better Mem0 API compatibility.
- **CRITICAL**: Fixed return statement in `supplyData()` to properly set `memoryKey: 'chat_history'` for correct n8n AI system integration.
- Fixed Buffer Limit (Interactions) to retrieve latest interactions in correct chronological order (descending sort, then reverse to maintain order).
- Improved message object structure with LangChain-compliant attributes.

### Changed
- `toLangchainMessage()` now uses centralized `createMsg()` helper for consistent message creation.
- Memory wrapping in `supplyData()` now validates and normalizes the `memoryKey` property.
- Enhanced error handling in `extractResults()` for edge cases with different API response formats.

### Technical Details
- All messages now have: `content`, `additional_kwargs`, `response_metadata` properties.
- Supports API responses in formats: `[...]`, `{results: [...]}`, `{data: {results: [...]}}`, `{memories: [...]}`.
- Build verified: TypeScript compilation clean, no warnings, all dist files generated.
- All 12 unit + integration tests passing.
- Node now compliant with n8n AI Agent memory input expectations.

---

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
  - character budget enforcement.

### Fixed
- Improved compatibility with Mem0 Self-Hosted OSS API.

---

## [0.2.6] - 2026-04-15

### Added
- Initial release of `Mem0 Chat Memory` node for n8n AI Agent workflows.
- Support for `semantic_facts` memory mode.
- Integration with Mem0 Self-Hosted REST API (`/memories`, `/search`).
- Safe profile: non-destructive memory operations.

