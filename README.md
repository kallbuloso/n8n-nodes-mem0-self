# n8n-nodes-mem0-self

Community node for Mem0 Self-Hosted memory in n8n.

## Included Node

- `Mem0 Chat Memory` (`mem0Memory`)

This package is focused on AI Agent memory usage (safe profile) and intentionally avoids admin/destructive operations.

## What It Does

- Stores conversation turns in Mem0 using `POST /memories`
- Retrieves contextual memory using `POST /search`
- Scopes memory by:
  - `user_id` (required)
  - `agent_id` (required)
  - `run_id` (optional)

## Credential Setup

Credential type: `Mem0 Self-Hosted API`

- Base URL default: `http://localhost:8000`
- Header auth: `X-API-Key`

## Safe Profile Notes

- `clear()` is non-destructive (no-op) in this node.
- If `run_id` is omitted, memory context is shared across sessions for the same `user_id + agent_id`.
- Keep API keys only in n8n credential storage.

## Build

```bash
npm install
npm run build
```

## License

MIT
