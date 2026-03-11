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

### Immediate Verification Semantics

- Post-delete verification treats both a normal not-found response and Feishu `code=1770003` / `resource deleted` as successful deletion confirmation.
- In the current service result shape, that should appear as `postDeleteCheck.verifiedDeleted=true`.

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

## Section Copy / Move

- `copy_section` copies the full section range including the heading block.
- `move_section` performs copy-then-delete with rollback if source deletion fails.
- Destination can be selected by `targetIndex` or by `targetSectionHeading` / `targetHeadingPath`.
- If no target anchor is provided, the copied section is appended to `targetParentBlockId` (or the target document root).
- Moving a section to a heading inside the same source section is rejected to avoid self-overlap.
- Any trailing non-heading block under the same parent, including images, still belongs to that section until the next heading.
- When images are present, transfer uses media reconstruction: download source bytes, then re-upload into the target document. The copied image block gets a new file token.
- `preview_edit_plan` warns when a section contains images or nested child blocks. Treat that warning as a performance/behavior hint, not as a hard failure.
- Image reconstruction depends on the active auth context being able to download the source media. A restricted auth mode can still block this path.

## Validating Local Code Changes

When you change the service implementation itself, do not assume an already-running MCP process has picked up the new code.

1. Restart the MCP server before validating through an external client.
2. Or call the local service layer directly for integration checks.
3. In validation notes, state whether the evidence came from MCP tool calls, local scripts, or code reading.
