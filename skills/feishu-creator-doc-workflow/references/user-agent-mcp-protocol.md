# User Agent -> MCP Protocol

Use this reference when the caller is a user-controlled agent, local companion app, or upstream gateway that wants to call `feishu-creator` in HTTP mode without letting `feishu-creator` become the long-term OAuth/token owner.

## Role Split

Recommended split of responsibility:

- **User system / local agent**
  - completes Feishu OAuth
  - refreshes Feishu tokens
  - injects the current user's token material when creating the MCP session
- **feishu-creator**
  - uses those tokens to call Feishu APIs
  - reads sample documents
  - generates style profiles and drafted documents
  - saves profiles and drafts back into the user's own Feishu space

## Session Contract

The caller should provide user-scoped headers only when establishing the MCP HTTP session.

Supported headers:

- `x-app-user-id`
- `x-feishu-auth-type`
- `x-feishu-user-access-token`
- `x-feishu-user-refresh-token`
- `x-feishu-user-access-token-expires-at`
- `x-feishu-user-refresh-token-expires-at`

Guidance:

- `x-app-user-id` is your own stable business identifier, not a Feishu password or login name
- `x-feishu-auth-type` should usually be `user` for personal-style workflows
- expiry headers use unix seconds
- after MCP initialize succeeds, continue reusing the same MCP session ID for follow-up tool calls

## Minimal Initialize Example

```http
POST /mcp
Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>
Content-Type: application/json
x-app-user-id: user_123
x-feishu-auth-type: user
x-feishu-user-access-token: <access_token>
x-feishu-user-refresh-token: <refresh_token>
x-feishu-user-access-token-expires-at: 1773656549
x-feishu-user-refresh-token-expires-at: 1776250000

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "your-agent",
      "version": "1.0.0"
    }
  }
}
```

## Follow-Up Calls

After initialize:

- reuse the returned MCP session
- keep sending normal MCP requests with `mcp-session-id`
- do not rotate end-user token headers mid-session unless you are intentionally creating a new session for a different user

## Recommended Save-Back Pattern

For user-owned outputs, prefer saving back into the user's own Feishu content tree:

- style profile docs
- style guide updates
- drafted technical notes
- rewritten versions of existing docs

This keeps the user in control of the resulting content and avoids turning `feishu-creator` into a profile database.

## Style Profile Default

For `feishu-style-extract`, prefer this default:

1. read the user's sample documents
2. generate the profile draft
3. ask for confirmation
4. save the approved profile back into the user's Feishu doc

Suggested titles:

- `✍️ 写作风格画像 - 深度讲解型`
- `✍️ 写作风格画像 - 工作记录型`

## Writing Flow Default

For `feishu-doc-writer`, prefer this default when style reuse matters:

1. find an approved style profile in the user's Feishu docs
2. read the profile back with `export_document_to_markdown`
3. apply the `风格指纹` as drafting constraints
4. save the new draft back into the user's Feishu docs

## Security Notes

- Do not ask end users to place raw account passwords in MCP config
- Treat `MCP_HTTP_AUTH_TOKEN` as service access control only
- Keep long-term token storage in the user system or user-side gateway when possible
- If the caller does not want to hand over refresh tokens, it may inject short-lived access tokens and recreate sessions as needed
