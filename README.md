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

| Tool | Purpose |
| --- | --- |
| `create_feishu_document` | Create document in drive/wiki |
| `get_feishu_document_info` | Read basic document metadata |
| `get_feishu_document_blocks` | Read document blocks |
| `delete_feishu_document` | Delete one doc/wiki node |
| `batch_delete_feishu_documents` | Delete multiple docs/wiki nodes |

### Document Edit

| Tool | Purpose |
| --- | --- |
| `update_feishu_block_text` | Update one existing text-capable block |
| `batch_update_feishu_blocks` | Update multiple text-capable blocks |
| `delete_feishu_document_blocks` | Delete child blocks by index range |
| `batch_create_feishu_blocks` | Create child blocks in batch |
| `locate_section_range` | Locate section start/end by heading |
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

## Advanced Docs

- [Advanced usage (English)](./docs/advanced.md)
- [高级说明（中文）](./docs/advanced.zh-CN.md)
