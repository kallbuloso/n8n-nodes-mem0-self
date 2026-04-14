# n8n-nodes-mem0-selfhosted

Community node for Mem0 Self-Hosted REST API in n8n.

## Safe Profile Endpoints

- `POST /memories` (store user + assistant interaction)
- `POST /search` (search scoped by `user_id` + `agent_id`)

This package intentionally does not expose destructive/admin operations in the node UI.

## Required Identifiers

- `user_id` is mandatory
- `agent_id` is mandatory
- `run_id` is optional

## Credential Defaults (Development)

- Base URL: `https://memor.curta.se`
- API Key: set in n8n credentials (no hardcoded default in production)

Header used by the node: `X-API-Key`.

## Production Notes

- Keep API keys only in n8n credential storage.
- Use `run_id` when you need strict session isolation.
- If `run_id` is omitted, memory context is shared across all sessions for the same `user_id + agent_id`.
