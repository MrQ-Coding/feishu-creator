# feishu-creator

A clean TypeScript MCP server foundation for rebuilding Feishu automation step by step.

[中文说明](./README.zh-CN.md)

## Current Step

Step 1: runnable MCP baseline.

- Streamable HTTP endpoint: `/mcp`
- Health check endpoint: `/health`
- Built-in tools: `ping`, `auth_status`, `get_user_authorize_url`, `exchange_user_auth_code`, `set_user_tokens`, `set_auth_mode`, `create_feishu_document`, `get_feishu_document_info`, `get_feishu_document_blocks`, `delete_feishu_document`, `batch_delete_feishu_documents`, `update_feishu_block_text`, `batch_update_feishu_blocks`, `delete_feishu_document_blocks`, `batch_create_feishu_blocks`, `insert_before_heading`, `locate_section_range`, `replace_section_blocks`, `delete_by_heading`, `replace_section_with_ordered_list`, `generate_section_blocks`, `generate_rich_text_blocks`, `list_feishu_wiki_spaces`, `get_feishu_wiki_tree`, `search_feishu_documents`
- Runtime mode: `http` (default) or `stdio`
- Feishu auth config: `tenant` / `user`

## Run

```bash
npm install
npm run dev:http
```

or:

```bash
npm run dev:stdio
```

## User OAuth Auto Callback

In HTTP mode, OAuth callback endpoint is available:

- `http://localhost:<PORT>/callback`

Typical flow:

1. Call `get_user_authorize_url` with redirect URI set to `http://localhost:<PORT>/callback`.
2. Open returned `authorizeUrl` in browser and approve.
3. Browser redirects to `/callback`, server auto exchanges code, switches runtime auth mode to `user`, and writes tokens to `.env`.

If `.env` already contains `FEISHU_AUTH_TYPE=user` and `FEISHU_USER_REFRESH_TOKEN`, the service refreshes the user token on startup and writes the latest token pair back to `.env`.

## Feishu Auth Env

Required in both auth types:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_AUTH_TYPE=tenant|user`

Optional for user mode:

- `FEISHU_USER_ACCESS_TOKEN`
- `FEISHU_USER_REFRESH_TOKEN`
- `FEISHU_WIKI_DELETE_STRATEGY=clear_content|playwright`
- `FEISHU_UI_BASE_URL`
- `FEISHU_PLAYWRIGHT_HEADLESS`
- `FEISHU_PLAYWRIGHT_EXECUTABLE_PATH`
- `FEISHU_PLAYWRIGHT_USER_DATA_DIR`
- `FEISHU_PLAYWRIGHT_ACTION_TIMEOUT_MS`
- `FEISHU_PLAYWRIGHT_LOGIN_TIMEOUT_MS`

Where:

- `clear_content`: current default. Wiki-backed deletions fall back to clearing content.
- `playwright`: runs built-in Playwright automation inside this server process to delete the wiki node.

Playwright deletion notes:

- The service first reuses the signed-in Feishu web session and calls the internal web deletion API `/space/api/wiki/v2/tree/del_single_node/`. It falls back to menu-click UI automation only when that direct API path fails.
- The service first tries the system default browser. If that browser is not directly automatable, it falls back to common installed Chrome / Edge / Chromium / Firefox executables.
- `FEISHU_PLAYWRIGHT_EXECUTABLE_PATH` has the highest priority when you want to force a specific browser binary.
- Keep `FEISHU_PLAYWRIGHT_HEADLESS=true` as the default.
- `FEISHU_PLAYWRIGHT_ACTION_TIMEOUT_MS` defaults to `45000`; increase it if your network/UI loading is slow.
- If the headless delete flow detects an expired Feishu web session, the service first prepares a lightweight automation profile, then opens a visible browser for one-time manual login recovery, saves the refreshed session into `FEISHU_PLAYWRIGHT_USER_DATA_DIR`, closes the window, and retries deletion in headless mode.
- Browser session state is stored under `FEISHU_PLAYWRIGHT_USER_DATA_DIR`, so later runs keep reusing the same session.
- Repeated wiki deletions in the same server process reuse the same Playwright browser context. `batch_delete_feishu_documents` also reuses that shared session instead of relaunching the browser for each document.
- The service prefers bootstrapping a lightweight automation profile from the local system browser profile when one is available; otherwise it creates an empty lightweight profile and waits for you to sign in once.
- If you want to prepare the automation profile ahead of time, you can still bootstrap one from an already signed-in Chrome profile with:

```bash
npm run profile:bootstrap -- --source .playwright/system-chrome-clone-20260306-143253 --target .playwright/feishu-automation-profile
```

- After bootstrapping, point `FEISHU_PLAYWRIGHT_USER_DATA_DIR` to `.playwright/feishu-automation-profile`.
- If the runtime has no GUI, prepare that browser profile in advance. Otherwise wiki hard deletion will fail because there is no signed-in web session to reuse.
- If the system default browser is Safari or another unsupported target, the service keeps falling back to installed Chromium / Firefox browsers before trying the Playwright bundled browser.

Performance related:

- `FEISHU_MAX_CONCURRENCY`
- `FEISHU_REQUEST_MAX_RETRIES`
- `FEISHU_REQUEST_BACKOFF_BASE_MS`
- `FEISHU_DOC_INFO_CACHE_TTL_SECONDS`
- `FEISHU_DOC_BLOCKS_CACHE_TTL_SECONDS`
- `FEISHU_WIKI_SPACES_CACHE_TTL_SECONDS`
- `FEISHU_WIKI_TREE_CACHE_TTL_SECONDS`
- `FEISHU_WIKI_TREE_MAX_CONCURRENCY`
- `FEISHU_CACHE_MAX_ENTRIES`
- `FEISHU_CACHE_CLEANUP_INTERVAL_SECONDS`

## Next Suggested Step

Add more technical-document editing tools:

- tables, images, attachments, and diagram rendering
