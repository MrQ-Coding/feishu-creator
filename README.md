# feishu-creator

TypeScript MCP server for Feishu document/wiki automation.

[中文说明](./README.zh-CN.md)

## Quick Start

| Step | Action | Command / Value |
| --- | --- | --- |
| 1 | Install dependencies | `npm install` |
| 2 | Prepare env file | `cp .env.example .env` |
| 3 | Start in default mode (`stdio`) | `npm run dev` |
| 4 | Start in HTTP mode | `npm run dev:http` |

`npm run dev` and `npm run start` default to `stdio` unless `MCP_MODE` or CLI args override it.

## Required Env

| Variable | Required When | Default | Description |
| --- | --- | --- | --- |
| `FEISHU_APP_ID` | Always | - | Feishu app id |
| `FEISHU_APP_SECRET` | Always | - | Feishu app secret |
| `FEISHU_AUTH_TYPE` | Always | - | `tenant` or `user` |
| `MCP_HTTP_BIND_HOST` | HTTP mode | `127.0.0.1` | MCP HTTP bind host |
| `MCP_HTTP_REQUIRE_AUTH` | HTTP mode | `true` | Require auth header for `/mcp` |
| `MCP_HTTP_AUTH_TOKEN` | HTTP mode + `MCP_HTTP_REQUIRE_AUTH=true` | - | Bearer token for `/mcp` |

## Common Optional Env

| Variable | Default | Description |
| --- | --- | --- |
| `FEISHU_USER_ACCESS_TOKEN` | - | User access token for `user` auth mode |
| `FEISHU_USER_REFRESH_TOKEN` | - | User refresh token for `user` auth mode |
| `FEISHU_USER_ACCESS_TOKEN_EXPIRES_AT` | - | Access token expiry timestamp |
| `FEISHU_USER_REFRESH_TOKEN_EXPIRES_AT` | - | Refresh token expiry timestamp |
| `FEISHU_WIKI_DELETE_STRATEGY` | `playwright` | Current supported value is `playwright` |
| `FEISHU_UI_BASE_URL` | Feishu default | Feishu web base URL |
| `FEISHU_PLAYWRIGHT_HEADLESS` | `true` | Run browser in headless mode |
| `FEISHU_PLAYWRIGHT_EXECUTABLE_PATH` | - | Pin browser executable |
| `FEISHU_PLAYWRIGHT_USER_DATA_DIR` | project config value | Browser profile dir |
| `FEISHU_PLAYWRIGHT_ACTION_TIMEOUT_MS` | `45000` | Action timeout |
| `FEISHU_PLAYWRIGHT_LOGIN_RECOVERY_MODE` | `on_demand` | `on_demand` or `interactive_first` |
| `FEISHU_PLAYWRIGHT_LOGIN_TIMEOUT_MS` | project config value | Interactive login timeout |

## Smoke Check

| Check | Tool | Example Input |
| --- | --- | --- |
| Service reachable | `ping` | `{ "message": "hello" }` |
| Auth status | `auth_status` | `{}` |
| Token fetch path | `auth_status` | `{ "fetchToken": true }` |
| Real doc read | `get_feishu_document_info` | `{ "documentId": "<docx_id_or_url>" }` |

## Tool Catalog

### Auth & Runtime

| Tool | Purpose |
| --- | --- |
| `ping` | Connectivity check |
| `auth_status` | Inspect auth mode and token cache |
| `get_user_authorize_url` | Build OAuth authorize URL |
| `exchange_user_auth_code` | Exchange OAuth code for user token |
| `set_user_tokens` | Set user access/refresh token at runtime |
| `set_auth_mode` | Switch runtime auth mode |

### Document Core

This server is wiki-first. It does not expose standalone Drive browsing/search tools; retained Drive usage is limited to folder-based creation compatibility and internal APIs still required by document search fallback, image upload, and delete-flow landing checks.

| Tool | Purpose |
| --- | --- |
| `create_feishu_document` | Create document in wiki, or under a Drive folder when `folderToken` is provided |
| `get_feishu_document_info` | Read basic document metadata |
| `get_feishu_document_blocks` | Read document blocks |
| `delete_feishu_document` | Delete one doc/wiki node |
| `batch_delete_feishu_documents` | Delete multiple docs/wiki nodes |
| `import_markdown_to_feishu` | Import minimal Markdown into a document |
| `export_feishu_document_to_markdown` | Export document content to minimal Markdown |

### Document Edit

| Tool | Purpose |
| --- | --- |
| `update_feishu_block_text` | Update one existing text-capable block |
| `batch_update_feishu_blocks` | Update multiple text-capable blocks |
| `delete_feishu_document_blocks` | Delete child blocks by index range |
| `batch_create_feishu_blocks` | Create child blocks in batch |
| `locate_section_range` | Locate section start/end by heading |
| `copy_section` | Copy a section within/across documents |
| `move_section` | Move a section within/across documents |
| `preview_edit_plan` | Preview a semantic edit plan without mutating the document |
| `insert_before_heading` | Insert blocks before heading |
| `replace_section_blocks` | Replace section content |
| `delete_by_heading` | Delete section by heading |
| `replace_section_with_ordered_list` | Replace section with ordered list |
| `generate_section_blocks` | Generate heading/paragraph/list section |
| `generate_rich_text_blocks` | Generate rich text block set |

### Wiki & Search

| Tool | Purpose |
| --- | --- |
| `list_feishu_wiki_spaces` | List visible wiki spaces |
| `get_feishu_wiki_tree` | Read wiki node tree |
| `search_feishu_documents` | Search docs/wiki nodes by keyword |

## Text Update Payload

For `update_feishu_block_text` and `batch_update_feishu_blocks`:

| Format | Status | Example |
| --- | --- | --- |
| Object array | Preferred | `[{ "text": "Hello world" }]` |
| String array | Backward compatible (auto-normalized) | `["Hello world"]` |

## Inline Code In Rich Text

Text fields in `generate_section_blocks`, `generate_rich_text_blocks`, `replace_section_blocks`, `insert_before_heading`, and `replace_section_with_ordered_list` support lightweight inline-code parsing:

- Wrap code spans in backticks, for example ``Run `npm run build` ``.
- Only inline code spans are parsed; the input is not treated as a full Markdown document.
- `code` blocks are still written verbatim, so backticks inside them are not reinterpreted as inline styles.

## Markdown Import And Export

The initial Markdown workflow is intentionally lightweight rather than fully lossless.

- Import supports headings, paragraphs, ordered lists, bullet lists, quotes, fenced code blocks, and inline code spans.
- Export supports the same block set and also renders common inline styles like bold, italic, strikethrough, inline code, and underline (`<u>...</u>`).
- Nested lists, tables, attachments, and other advanced Feishu-only blocks are not preserved yet.

## Operational Notes

- `create_feishu_document` is wiki-first in normal usage. Pass `wikiContext.spaceId` for new wiki pages, or `folderToken` only when you intentionally need Drive-folder compatibility.
- Do not use `search_feishu_documents` as the first verifier for a page you just created or deleted. Prefer `get_feishu_document_info` or `get_feishu_wiki_tree` first, then search later if needed.
- After `delete_feishu_document` or `batch_delete_feishu_documents`, immediate verification may return a regular not-found response or Feishu `code=1770003` / `resource deleted`. Both should be treated as successful deletion confirmation, and current service code reports that as `postDeleteCheck.verifiedDeleted=true`.
- `copy_section` and `move_section` operate on the full resolved section range, including trailing non-heading blocks such as images.
- When a transferred section contains images, the service now downloads the source media bytes and re-uploads them into the target document. Copied images receive new file tokens and may take longer than text-only transfers.
- `preview_edit_plan` is the safest way to confirm section boundaries before a cross-document copy or move, especially when the section may include images or nested child blocks.
- If you just changed the server code, restart the MCP process before validating behavior from an external client. A long-running process will not pick up repo edits automatically.

## Advanced Docs

- [Advanced usage (English)](./docs/advanced.md)
- [高级说明（中文）](./docs/advanced.zh-CN.md)
