# HTTP Multi-User Recipes

Use this reference when the user wants to deploy `feishu-creator` as a shared HTTP MCP service and needs to distinguish different end users safely.

## Current Runtime Status

The current HTTP runtime now supports **session-scoped Feishu auth context** when the caller provides user-specific headers during MCP session initialization.

- `MCP_HTTP_AUTH_TOKEN` only protects access to the MCP endpoint itself
- each MCP HTTP session gets its own `AppContext`
- that session owns its own `FeishuAuthManager`
- `set_user_tokens`, `exchange_user_auth_code`, and `set_auth_mode` now mutate the session-local runtime auth state, not another session's state

As a result, the current server is now safe for:

- one user per service instance
- multiple users on one shared instance **when** the outer caller injects the correct per-user Feishu token material at session init
- one automation identity in `tenant` mode

What still does **not** exist yet:

- built-in database lookup from your own `app_user_id` to stored Feishu OAuth records
- built-in gateway integration for your own login system
- built-in persistent style-profile index beyond what you save back into Feishu

## Recommended Multi-User Model

Split identity into three layers:

1. **App user identity**
- Provided by the outer product or gateway
- Example: your own JWT subject, account ID, or session user ID
- Purpose: answer "who is calling the MCP service?"

2. **Feishu user authorization**
- Stored after Feishu OAuth binding
- Example: access token, refresh token, token expiry, optional Feishu open ID / union ID
- Purpose: answer "which Feishu user should this request act as?"

3. **Business ownership**
- Used by style profiles, saved drafts, and other per-user artifacts
- Recommended key: `owner_id = your_app_user_id`
- Purpose: answer "who owns this generated artifact?"

## Recommended Request Flow

Use this shape for a shared HTTP deployment:

1. User logs into your product.
2. Your product authenticates the user and issues its normal app session or JWT.
3. The user binds Feishu through OAuth once.
4. Your backend stores the user's Feishu refresh token under the app user ID.
5. Each MCP request arrives with the app user identity already established by your gateway.
6. Your gateway or backend resolves the app user ID to that user's Feishu token material.
7. The service creates or selects a user-scoped auth context for this request.
8. The request runs against Feishu using that user's token, not a global shared token.

## Session Init Headers

The current HTTP implementation supports these headers on MCP initialize:

- `x-app-user-id`
- `x-feishu-auth-type`
- `x-feishu-user-access-token`
- `x-feishu-user-refresh-token`
- `x-feishu-user-access-token-expires-at`
- `x-feishu-user-refresh-token-expires-at`

Recommended usage:

- authenticate the caller in your own gateway first
- look up the caller's Feishu OAuth record in your backend
- inject the relevant headers only when creating the MCP HTTP session
- reuse that MCP session for subsequent tool calls

## What To Store

Minimum server-side record:

```json
{
  "app_user_id": "user_123",
  "feishu_auth_type": "user",
  "feishu_access_token": "...",
  "feishu_refresh_token": "...",
  "feishu_access_token_expires_at": 1773656549,
  "feishu_refresh_token_expires_at": 1776250000,
  "feishu_open_id": "ou_xxx_optional"
}
```

For style profiles and other per-user outputs, store a separate ownership record:

```json
{
  "owner_id": "user_123",
  "profile_kind": "deep-explainer",
  "document_id": "docx_xxx",
  "updated_at": "2026-03-16"
}
```

## Recommended Feishu Profile Save Format

When storing a style profile back into Feishu, prefer a machine-readable header:

```markdown
---
profile_version: 1
owner_id: user_123
owner_source: app-auth
profile_kind: deep-explainer
sample_docs:
  - docx_1
  - docx_2
updated_at: 2026-03-16
confidence: medium
---
```

This allows later retrieval through document search plus Markdown export.

## Practical Deployment Guidance

- If you need server mode **today**, prefer one service instance per user or one shared `tenant` automation identity.
- If you need true multi-user behavior, add user-scoped auth resolution before exposing the service as a shared endpoint.
- Do not ask end users to provide raw account passwords in MCP config.
- Prefer OAuth and refresh-token storage over password-style credentials.
- Treat `MCP_HTTP_AUTH_TOKEN` as transport access control only, not end-user identity.

## Implementation Direction

The clean direction is:

- keep HTTP transport auth at the gateway layer
- pass app user identity into the request handling layer
- resolve Feishu token material per app user
- build a user-scoped `AppContext` or user-scoped auth facade
- avoid mutating one global auth state for all requests

If the user asks whether the current code already supports user isolation, answer precisely:

- **yes** for session-scoped isolation when the outer caller injects per-user headers
- **not yet** for full built-in account lookup and token management inside `feishu-creator` itself
