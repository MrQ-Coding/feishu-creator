# feishu-creator

TypeScript MCP server for Feishu document/wiki automation.

[中文说明](./README.zh-CN.md)

## 1. Three Things To Know First

1. This is an MCP server, not a web app. You use it from an MCP client.
2. Keep `MCP_MODE=auto` by default: normal usage still runs through `stdio`, and you only switch to `HTTP` when you explicitly pass `--http`. That keeps day-to-day usage simple and avoids editing `.env` back and forth.
3. For a beginner, "it works" means you can complete `ping`, `auth_status`, and `get_feishu_document_info` in order, not just start the process.

## 2. Shortest Successful Path

### 2.1 Prerequisites

- Node.js `>= 20.17.0`
- A Feishu app `app id` / `app secret`
- A real Feishu document URL or `docx_id` you can access

### 2.2 Create A Feishu App

Before using the tool, create a Feishu app:

- Sign in to the [Feishu Open Platform](https://open.feishu.cn/app?lang=en-US).
- Open the console and create a new app.
- Copy the App ID and App Secret. You will use them for API authentication.
- Add the permissions your use case needs. In practice, enabling the non-review scopes up front usually avoids a second setup pass.
- Under Security Settings, add the redirect URL `http://localhost:3333/callback`. This avoids the OAuth terminal login issue described in the official FAQ: [How to resolve the authorization page 20029 error](https://open.feishu.cn/document/faq/trouble-shooting/how-to-resolve-the-authorization-page-20029-error).

### 2.3 Hand Off Detailed Setup And Initialization To The Feishu Doc Workflow

The top-level README only keeps the shortest path. If you explicitly ask Codex to install, initialize, configure, or wire up `feishu-creator`, the upgraded `feishu-creator-doc-workflow` skill now tries to do the long setup work automatically:

- install dependencies
- prepare `.env`
- build `dist/`
- write common MCP client config files
- only fall back to asking for missing Feishu credentials when those values are truly required

In other words, the long-form setup flow now lives in the skill itself instead of a repo-side playbook.

### 2.4 Install

```bash
npm install
cp .env.example .env
```

### 2.5 Fill The Smallest Possible `.env`

If you only want the quickest first run, start with `tenant` mode:

```dotenv
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_AUTH_TYPE=tenant
```

Everything else can stay at the `.env.example` defaults for now. In practice, keep `MCP_MODE=auto` and avoid changing it to `http` for normal usage.

### 2.6 Keep `MCP_MODE=auto`

This is the lowest-friction setup:

- Keep `MCP_MODE=auto` in `.env`
- Use `npm run dev` or `npm run start` for normal work; they effectively run as `stdio`
- Only use an `--http` startup command in the small number of cases that really need it

In this project, `auto` is effectively "let the startup command decide the mode", not "stay in HTTP by default".

### 2.7 Connect It In Your MCP Client (minimal example)

#### `stdio`: recommended for first-time MCP users

Build once:

```bash
npm run build
```

Then configure a `stdio` server in your MCP client. Field names vary a bit by client, but the core idea is the same:

```json
{
  "mcpServers": {
    "feishu-creator": {
      "command": "node",
      "args": ["/absolute/path/to/feishu-creator/dist/index.js", "--stdio"]
    }
  }
}
```

Notes:

- `dist/index.js` automatically loads `.env` from the repo root.
- There is no `/mcp` port in `stdio` mode.
- Manually running `npm run dev` in a terminal is useful for debugging the server itself, but it does not mean your client is already connected to it.
- Only switch to `HTTP` temporarily when you need OAuth callback for `user` token acquisition. Do not change your default mode to `http` just for that. See [Advanced usage (English)](./docs/advanced.md) for that path.

### 2.8 First Calls To Make

This order makes debugging much easier:

1. `ping`
   Input: `{ "message": "hello" }`
   Purpose: proves the MCP transport is working.
2. `auth_status`
   Input: `{}`
   Purpose: confirms whether you are in `tenant` or `user` mode.
3. `auth_status`
   Input: `{ "fetchToken": true }`
   Purpose: confirms the server can actually fetch a Feishu token.
4. `get_feishu_document_info`
   Input: `{ "documentId": "<docx_id_or_url>" }`
   Purpose: confirms you are not just running the server, but can really access Feishu content.

If the first three succeed but the last one fails, the issue is usually Feishu permission, document id, auth mode, or app capability scope rather than MCP transport.

## 3. When To Use `user` Mode

Use `tenant` to get started quickly. Turn on `user` only when you explicitly need user-context access.

- If you already have tokens: set `FEISHU_USER_ACCESS_TOKEN` or `FEISHU_USER_REFRESH_TOKEN` and keep using `stdio`.
- If you do not have tokens yet: switch to `HTTP` only temporarily for the OAuth callback flow, then return to `MCP_MODE=auto` + `stdio`.

For the detailed `user` initialization path, rely on the skill flow plus [Advanced usage (English)](./docs/advanced.md).

## 4. Common Beginner Pitfalls

- `stdio` is not "start a local port and point the client at it"; in the default path it does not need a port at all.
- Do not use `search_feishu_documents` as the first verifier right after create/delete. Prefer `get_feishu_document_info` or `get_feishu_wiki_tree` first because search can lag behind indexing.
- If you changed the server code, restart the MCP process before testing again. A running process will not hot-reload repo changes automatically.
- For new wiki pages, prefer `wikiContext.spaceId`. Only use `folderToken` when you intentionally need Drive-folder compatibility.

## 5. Required Env

The `MCP_HTTP_*` variables below are only needed if you intentionally use `HTTP` mode. For the default `stdio` path, you can ignore them at first.

| Variable | Required When | Default | Description |
| --- | --- | --- | --- |
| `FEISHU_APP_ID` | Always | - | Feishu app id |
| `FEISHU_APP_SECRET` | Always | - | Feishu app secret |
| `FEISHU_AUTH_TYPE` | Always | - | `tenant` or `user` |
| `MCP_HTTP_BIND_HOST` | HTTP mode | `127.0.0.1` | MCP HTTP bind host |
| `MCP_HTTP_REQUIRE_AUTH` | HTTP mode | `true` | Require auth header for `/mcp` |
| `MCP_HTTP_AUTH_TOKEN` | HTTP mode + `MCP_HTTP_REQUIRE_AUTH=true` | - | Bearer token for `/mcp` |

## 6. Common Optional Env

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

## 7. Smoke Check

| Check | Tool | Example Input |
| --- | --- | --- |
| Service reachable | `ping` | `{ "message": "hello" }` |
| Auth status | `auth_status` | `{}` |
| Token fetch path | `auth_status` | `{ "fetchToken": true }` |
| Real doc read | `get_feishu_document_info` | `{ "documentId": "<docx_id_or_url>" }` |

## 8. Tool Catalog

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

## 9. Text Update Payload

For `update_feishu_block_text` and `batch_update_feishu_blocks`:

| Format | Status | Example |
| --- | --- | --- |
| Object array | Preferred | `[{ "text": "Hello world" }]` |
| String array | Backward compatible (auto-normalized) | `["Hello world"]` |

## 10. Inline Code In Rich Text

Text fields in `generate_section_blocks`, `generate_rich_text_blocks`, `replace_section_blocks`, `insert_before_heading`, and `replace_section_with_ordered_list` support lightweight inline-code parsing:

- Wrap code spans in backticks, for example ``Run `npm run build` ``.
- Only inline code spans are parsed; the input is not treated as a full Markdown document.
- `code` blocks are still written verbatim, so backticks inside them are not reinterpreted as inline styles.

## 11. Markdown Import And Export

The initial Markdown workflow is intentionally lightweight rather than fully lossless.

- Import supports headings, paragraphs, ordered lists, bullet lists, quotes, fenced code blocks, and inline code spans.
- Export supports the same block set and also renders common inline styles like bold, italic, strikethrough, inline code, and underline (`<u>...</u>`).
- Nested lists, tables, attachments, and other advanced Feishu-only blocks are not preserved yet.

## 12. Operational Notes

- `create_feishu_document` is wiki-first in normal usage. Pass `wikiContext.spaceId` for new wiki pages, or `folderToken` only when you intentionally need Drive-folder compatibility.
- Do not use `search_feishu_documents` as the first verifier for a page you just created or deleted. Prefer `get_feishu_document_info` or `get_feishu_wiki_tree` first, then search later if needed.
- After `delete_feishu_document` or `batch_delete_feishu_documents`, immediate verification may return a regular not-found response or Feishu `code=1770003` / `resource deleted`. Both should be treated as successful deletion confirmation, and current service code reports that as `postDeleteCheck.verifiedDeleted=true`.
- `copy_section` and `move_section` operate on the full resolved section range, including trailing non-heading blocks such as images.
- When a transferred section contains images, the service now downloads the source media bytes and re-uploads them into the target document. Copied images receive new file tokens and may take longer than text-only transfers.
- `preview_edit_plan` is the safest way to confirm section boundaries before a cross-document copy or move, especially when the section may include images or nested child blocks.
- If you just changed the server code, restart the MCP process before validating behavior from an external client. A long-running process will not pick up repo edits automatically.

## 13. Advanced Docs

- [Advanced usage (English)](./docs/advanced.md)
- [高级说明（中文）](./docs/advanced.zh-CN.md)
