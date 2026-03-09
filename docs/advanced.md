# Advanced Usage (English)

This page contains operational details that are intentionally kept out of the top-level README.

## OAuth Callback Details

In HTTP mode, callback endpoint is:

- `http://localhost:<PORT>/callback`

Typical flow:

1. Call `get_user_authorize_url` with `redirectUri=http://localhost:<PORT>/callback`.
2. Open returned `authorizeUrl` in browser and approve.
3. Browser returns to `/callback` with `code` and `state`.
4. Service validates one-time `state`, exchanges code, switches to `user` mode, and writes tokens to `.env`.

If `.env` already has `FEISHU_AUTH_TYPE=user` and `FEISHU_USER_REFRESH_TOKEN`, service will proactively refresh token on startup when expiry metadata is missing or near expiration.

## HTTP `/mcp` Auth Header

When `MCP_HTTP_REQUIRE_AUTH=true`, include one of:

- `Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>`
- `x-mcp-token: <MCP_HTTP_AUTH_TOKEN>`

## Playwright Wiki Deletion Details

### Current Strategy

| Config | Value |
| --- | --- |
| `FEISHU_WIKI_DELETE_STRATEGY` | `playwright` |

### Deletion Path

1. Try direct internal API `/space/api/wiki/v2/tree/del_single_node/` using existing signed-in web session.
2. If direct API fails, fall back to UI automation.
3. If login is required in headless mode, run interactive recovery (if GUI is available), then retry headless deletion.

### Browser Selection Priority

| Priority | Rule |
| --- | --- |
| 1 | `FEISHU_PLAYWRIGHT_EXECUTABLE_PATH` if configured |
| 2 | System default browser if automatable |
| 3 | Installed Chrome / Edge / Chromium / Firefox |
| 4 | Playwright bundled Chromium fallback |

### Profile and Lock Behavior

| Item | Behavior |
| --- | --- |
| `FEISHU_PLAYWRIGHT_USER_DATA_DIR` relative path | Resolved relative to project root |
| Login session storage | Stored in `FEISHU_PLAYWRIGHT_USER_DATA_DIR` |
| Lock release timing | Persistent context is closed after each top-level delete call, so profile lock is released per call |

### Optional Profile Bootstrap

```bash
npm run profile:bootstrap -- --source .playwright/system-chrome-clone-20260306-143253 --target .playwright/feishu-automation-profile
```

After bootstrap, set `FEISHU_PLAYWRIGHT_USER_DATA_DIR=.playwright/feishu-automation-profile`.

## Performance Tuning Env

| Variable |
| --- |
| `FEISHU_MAX_CONCURRENCY` |
| `FEISHU_REQUEST_MAX_RETRIES` |
| `FEISHU_REQUEST_BACKOFF_BASE_MS` |
| `FEISHU_OAUTH_STATE_TTL_SECONDS` |
| `FEISHU_DOC_INFO_CACHE_TTL_SECONDS` |
| `FEISHU_DOC_BLOCKS_CACHE_TTL_SECONDS` |
| `FEISHU_WIKI_SPACES_CACHE_TTL_SECONDS` |
| `FEISHU_WIKI_TREE_CACHE_TTL_SECONDS` |
| `FEISHU_WIKI_TREE_MAX_CONCURRENCY` |
| `FEISHU_CACHE_MAX_ENTRIES` |
| `FEISHU_CACHE_CLEANUP_INTERVAL_SECONDS` |
