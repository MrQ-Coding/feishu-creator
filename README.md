# feishu-creator

TypeScript MCP server for Feishu document and wiki automation.

[中文说明](./README.zh-CN.md)

## 1. What This Project Is

`feishu-creator` is not a web app. It is an MCP server meant to be called from an MCP client.

It now focuses on four things:

1. Exposing Feishu document/wiki operations as a stable MCP tool surface.
2. Separating platform-neutral document workflows from Feishu-specific adapter code.
3. Adding a higher-level semantic editing layer on top of low-level block APIs.
4. Keeping related workflows such as diagram rendering, Markdown conversion, and wiki deletion in the same server.

The public MCP surface now contains:

- auth and runtime control
- document create/read/delete
- block-level and section-level editing
- Markdown import/export
- Graphviz / PlantUML rendering
- local image upload
- basic table operations
- wiki tree and search

For cross-platform readability, the server now exposes generic aliases such as `create_document`, `get_document_info`, and `update_block_text`, while still keeping legacy Feishu-named aliases for compatibility.

## 2. Capability Overview

### 2.1 Auth and runtime

- Supports both `tenant` and `user` auth modes.
- Supports both `stdio` and `HTTP` MCP transports.
- Recommended default is `MCP_MODE=auto`, with normal usage staying on `stdio` unless you explicitly start with `--http`.
- `user` mode includes OAuth authorize URL generation, code exchange, runtime mode switching, and optional `.env` persistence.

### 2.2 Documents and wiki

- `create_document` / `create_feishu_document` are wiki-first, with `folderToken` kept only for Drive-folder compatibility.
- `get_document_info` / `get_feishu_document_info` accept both docx and wiki inputs.
- `get_document_blocks` / `get_feishu_document_blocks` provide paginated block-tree reads.
- Delete flows support both single and batch delete with post-delete verification.

### 2.3 Semantic editing

- Supports single-block text updates, batch text updates, and batch child-block creation.
- Supports heading-based section targeting for `insert`, `replace`, `delete`, and `upsert`.
- Supports full-section `copy_section` and `move_section` across documents.
- Supports `preview_edit_plan` to inspect heading matches, ranges, and insertion positions before mutating.
- Write paths consistently support chunking, adaptive chunk shrink, resume checkpoints, and deterministic `client_token` seeds.

### 2.4 Supporting workflows

- `import_markdown_to_document` / `export_document_to_markdown` provide a lightweight Markdown round-trip.
- `render_graphviz_diagram` / `render_plantuml_diagram` render locally.
- `create_graphviz_diagram_block` / `create_plantuml_diagram_block` render and upload back into a document.
- `upload_local_image` inserts or replaces image blocks.
- Basic tables support create, inspect, single-cell replace, and whole-table replace.

## 3. Architecture

### 3.1 Main call path

```text
MCP client
  -> src/index.ts
  -> src/mcp/app.ts
  -> src/mcp/tools/*
  -> src/services/*
  -> src/feishu/client.ts
  -> Feishu Open API / Playwright browser flow
```

### 3.2 Layer map

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Process entrypoint, `stdio` / `http` mode selection, HTTP `/health`, `/callback`, and MCP session lifecycle |
| `src/mcp/app.ts` | MCP server creation and tool registration |
| `src/mcp/tools/*` | Tool schemas, parameter docs, error wrapping, and dispatch into services |
| `src/platform/*` | Platform adapter layer: doc reference parsing, block factories, block introspection, markdown codec, document/query/edit/media gateways |
| `src/feishu/*` | Auth manager, raw HTTP client, doc/wiki ID parsing, user-token persistence |
| `src/services/document/*` | Document creation, document info reads, block-tree reads, and caching |
| `src/services/documentEdit/*` | Core edit workflows: block mutation, heading lookup, section transfer, image upload, tables, and deletion |
| `src/services/diagramImage/*` | Graphviz / PlantUML rendering and rendered-image upload |
| `src/services/markdown/*` | Markdown parsing and Markdown export rendering |
| `src/services/wiki/*` | Wiki space listing and wiki tree reads |
| `src/services/wikiBrowser/*` | Browser-backed deletion, login recovery, and Playwright session reuse |
| `src/appContext.ts` | Runtime wiring for auth, client, services, and periodic cache cleanup |

### 3.3 Key design choices

#### `DocumentEditService` is the editing hub

`DocumentEditService` is the core of the repository. Block mutations, heading-based section edits, image upload, table operations, and delete flows all converge there.

That layer is also where the project centralizes:

- per-document write locks
- multi-document locks for cross-document copy/move/preview flows
- cache invalidation after mutations

#### Heading-based editing uses progressive scan plus caching

`headingLocator.ts`, `sectionLocator.ts`, and `sectionRange.ts` form the shared "find heading, resolve section range" layer.

That is what enables stable higher-level tools such as:

- `insert_before_heading`
- `replace_section_blocks`
- `upsert_section`
- `delete_by_heading`
- `copy_section`
- `move_section`
- `preview_edit_plan`

#### Diagram workflows reuse normal image upload

`DiagramImageService` only handles local rendering and temp-file cleanup. The actual write-back path delegates to `DocumentEditService.uploadLocalImage()`.

That keeps diagram insertion aligned with the same insert/replace semantics used for ordinary images.

#### Delete flows assume browser context may still be required

`delete_feishu_document` and `batch_delete_feishu_documents` ultimately rely on `WikiBrowserDeletionService`.

The implementation first tries an internal delete API, then falls back to UI automation. If headless deletion finds an unauthenticated session, the service can attempt interactive login recovery based on config.

#### Tool names now have a generic layer plus legacy aliases

The service layer is increasingly platform-neutral, but the project must remain compatible with existing Feishu clients.

That means the MCP tool surface now follows this rule:

- prefer generic aliases such as `create_document`, `get_document_info`, `import_markdown_to_document`, `update_block_text`, `create_table`
- keep legacy aliases such as `create_feishu_document`, `get_feishu_document_info`, `import_markdown_to_feishu`, `update_feishu_block_text`, `create_feishu_table`
- keep clearly Feishu-specific capabilities named as Feishu-specific, especially wiki discovery and browser-backed delete flows

#### Some capabilities intentionally remain Feishu-specific

The project does not try to force every feature behind a fake cross-platform abstraction.

These areas intentionally remain Feishu-specific today:

- browser-backed delete flows: `delete_feishu_document`, `batch_delete_feishu_documents`, and `WikiBrowserDeletionService`
- Feishu wiki discovery and traversal: `list_feishu_wiki_spaces`, `get_feishu_wiki_tree`
- Feishu-specific search behavior: `search_feishu_documents`
- Feishu OAuth and auth runtime details: `get_user_authorize_url`, `exchange_user_auth_code`, `set_user_tokens`, `set_auth_mode`, and the auth manager / token persistence layer in `src/feishu/*`

Those capabilities either depend on Feishu-only product concepts, unstable browser flows, or Feishu auth semantics that are not worth pretending are universal.

#### Read paths use TTL caches and write paths invalidate them

Caching currently exists in:

- `DocumentBlockService`
- `DocumentInfoService`
- `WikiSpaceService`
- `WikiTreeService`
- the section-locate cache inside `DocumentEditService`

`src/appContext.ts` periodically cleans expired cache entries, while mutation flows invalidate affected document state eagerly.

## 4. Quick Start

### 4.1 Prerequisites

- Node.js `>= 20.17.0`
- a Feishu app `app id` / `app secret`
- a real Feishu document URL or `docx_id` you can access

### 4.2 Create a Feishu app

- Sign in to the [Feishu Open Platform](https://open.feishu.cn/app?lang=en-US).
- Create an app and copy the `App ID` and `App Secret`.
- Add the permissions your use case needs.
- If you plan to use OAuth callback flow, add `http://localhost:3333/callback` as a redirect URL.

### 4.3 Install and build

```bash
npm install
cp .env.example .env
npm run build
```

### 4.4 Minimal `.env`

For the first successful run, start with `tenant` mode:

```dotenv
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_AUTH_TYPE=tenant
MCP_MODE=auto
```

### 4.5 MCP client config example

Start with `stdio`:

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

- `dist/index.js` loads `.env` from the repo root.
- When repo-root `.env` exists, the server intentionally reloads `FEISHU_*` values from that file and overrides same-named process env values.
- `stdio` mode does not need a local port.
- If your MCP client does not pass proxy env vars into child processes, add `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, and `NODE_USE_ENV_PROXY=1`.

### 4.6 Suggested first verification path

1. `ping`
2. `auth_status`
3. `auth_status` with `{ "fetchToken": true }`
4. `get_document_info`

If the first three work and the fourth fails, the issue is usually Feishu permission, document ID, auth mode, or app scope rather than MCP transport.

## 5. Auth and Runtime Modes

### 5.1 Recommended default combination

- `MCP_MODE=auto`
- MCP client starts the server with `--stdio`
- `FEISHU_AUTH_TYPE=tenant`

That is the lowest-friction day-to-day setup.

### 5.2 When to enable `user`

Only switch to `user` when you explicitly need user-context access:

- If you already have tokens, set `FEISHU_USER_ACCESS_TOKEN` or `FEISHU_USER_REFRESH_TOKEN`
- If you do not have tokens yet, call `get_user_authorize_url`, complete browser authorization, then call `exchange_user_auth_code`

### 5.3 When HTTP mode is useful

HTTP mode is mainly useful when:

- you need a real HTTP MCP client
- you need the local OAuth callback `/callback`

For normal Codex or desktop-client usage, `stdio` is usually enough.

## 6. Key Environment Variables

See [`.env.example`](./.env.example) for the full set. The most commonly used ones are:

| Variable | Description |
| --- | --- |
| `FEISHU_APP_ID` | Feishu app id |
| `FEISHU_APP_SECRET` | Feishu app secret |
| `FEISHU_AUTH_TYPE` | `tenant` or `user` |
| `MCP_MODE` | `auto`, `stdio`, or `http` |
| `MCP_HTTP_BIND_HOST` | HTTP bind host |
| `MCP_HTTP_REQUIRE_AUTH` | Whether `/mcp` requires Bearer auth |
| `MCP_HTTP_AUTH_TOKEN` | Bearer token for HTTP MCP |
| `FEISHU_USER_ACCESS_TOKEN` | User-mode access token |
| `FEISHU_USER_REFRESH_TOKEN` | User-mode refresh token |
| `FEISHU_PLAYWRIGHT_HEADLESS` | Whether browser-backed delete runs headless |
| `FEISHU_PLAYWRIGHT_EXECUTABLE_PATH` | Pin a browser executable |
| `FEISHU_PLAYWRIGHT_USER_DATA_DIR` | Browser profile path |
| `FEISHU_GRAPHVIZ_DOT_PATH` | Pin Graphviz `dot` |
| `FEISHU_PLANTUML_COMMAND` | Pin `plantuml` command |
| `FEISHU_PLANTUML_JAR_PATH` | Pin PlantUML jar |
| `FEISHU_JAVA_PATH` | Pin `java` for jar mode |

## 7. Tool Map

### 7.1 Auth and runtime

- `ping`
- `auth_status`
- `get_user_authorize_url`
- `exchange_user_auth_code`
- `set_user_tokens`
- `set_auth_mode`

### 7.2 Document core

Preferred generic aliases:

- `create_document`
- `get_document_info`
- `get_document_blocks`

Legacy Feishu aliases:

- `create_feishu_document`
- `get_feishu_document_info`
- `get_feishu_document_blocks`
- `delete_feishu_document`
- `batch_delete_feishu_documents`

### 7.3 Document editing

Preferred generic aliases:

- `update_block_text`
- `batch_update_blocks`
- `delete_document_blocks`
- `batch_create_blocks`
- `upload_local_image`
- `create_table`
- `get_table`
- `update_table_cell`
- `replace_table`

Generic semantic editing tools:

- `locate_section_range`
- `preview_edit_plan`
- `insert_before_heading`
- `replace_section_blocks`
- `upsert_section`
- `delete_by_heading`
- `replace_section_with_ordered_list`
- `copy_section`
- `move_section`
- `generate_section_blocks`
- `generate_rich_text_blocks`

Legacy Feishu aliases:

- `update_feishu_block_text`
- `batch_update_feishu_blocks`
- `delete_feishu_document_blocks`
- `batch_create_feishu_blocks`
- `upload_local_image_to_feishu`
- `create_feishu_table`
- `get_feishu_table`
- `update_feishu_table_cell`
- `replace_feishu_table`

### 7.4 Diagrams

- `render_graphviz_diagram`
- `create_graphviz_diagram_block`
- `render_plantuml_diagram`
- `create_plantuml_diagram_block`

### 7.5 Markdown

Preferred generic aliases:

- `import_markdown_to_document`
- `export_document_to_markdown`

Legacy Feishu aliases:

- `import_markdown_to_feishu`
- `export_feishu_document_to_markdown`

### 7.6 Wiki and search

These remain Feishu-specific on purpose:

- `list_feishu_wiki_spaces`
- `get_feishu_wiki_tree`
- `search_feishu_documents`

## 8. Typical Workflows

### 8.1 Create a wiki document and fill content

1. Use `list_feishu_wiki_spaces` to find the target `spaceId`
2. Use `create_document` to create the wiki doc
3. Use `generate_section_blocks`, `generate_rich_text_blocks`, or `import_markdown_to_document` to write content
4. Use `get_document_blocks` or `export_document_to_markdown` to verify the result

### 8.2 Replace a section by heading

1. Run `preview_edit_plan`
2. Run `replace_section_blocks` or `upsert_section`
3. If the desired output is an ordered list, use `replace_section_with_ordered_list`

### 8.3 Copy or move sections across documents

1. Run `preview_edit_plan` to confirm heading match and insertion point
2. Run `copy_section` or `move_section`
3. If the section includes images, expect slower execution because images are re-uploaded and receive new `file_token` values

### 8.4 Render diagrams into documents

1. Use `render_graphviz_diagram` or `render_plantuml_diagram` when you only want a local render
2. Use `create_graphviz_diagram_block` or `create_plantuml_diagram_block` when you want render-plus-upload
3. If you already have an image file, use `upload_local_image`

### 8.5 Basic table editing

1. Create with `create_table`
2. Inspect with `get_table`
3. Update one cell with `update_table_cell`
4. Replace the full table with `replace_table`

## 9. Practical Notes

- Do not use `search_feishu_documents` as the first verification step right after create/delete because search can lag behind indexing.
- `preview_edit_plan` is the safest probe before section-level edits.
- `copy_section` and `move_section` operate on the full resolved section range, not just the heading line.
- Markdown import/export is intentionally lightweight, not fully lossless.
- Markdown now supports basic tables, but complex styling, row/column operations, and merge editing still belong to the native table tools.
- `create_plantuml_diagram_block` can still depend on Graphviz `dot` for some diagram types.
- If you change the server code, restart the MCP process before testing again.
- Delete flows depend on browser session state; if headless deletion is not logged in, the service can attempt interactive recovery depending on config.

## 10. Dev Commands

```bash
npm run dev
npm run dev:stdio
npm run dev:http
npm run build
npm run type-check
npm run start
npm run start:stdio
npm run start:http
```

For local one-off tool calls, you can also use:

```bash
node scripts/callTool.mjs --tool ping --args-json '{"message":"test"}'
```

## 11. Further Reading

- [Advanced usage (English)](./docs/advanced.md)
- [高级说明（中文）](./docs/advanced.zh-CN.md)
