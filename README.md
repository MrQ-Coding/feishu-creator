# feishu-creator

**让 AI 助手直接操作飞书文档和知识库的 MCP 服务。**

创建文档、按标题替换章节内容、渲染图表并插入文档、Markdown 导入导出、管理 Wiki 结构，全部通过自然语言指令完成。

[![Node.js](https://img.shields.io/badge/node-%3E%3D20.17.0-brightgreen)](https://nodejs.org)

---

## 适合做什么

- 按标题整体替换某一章内容，不影响其他章节
- 把一个 section 复制或移动到另一篇文档
- 用 Graphviz 或 PlantUML 渲染图并直接插入飞书文档
- 把 Markdown 导入成飞书原生块，或把文档导出成 Markdown
- 列出知识库空间和目录树，创建 Wiki 文档，删除不再需要的节点

如果你希望 AI 在真正修改前先“看一眼会改哪里”，可以先调用 `preview_edit_plan`。

---

## 5 分钟上手

### 1. 创建飞书应用

登录 [飞书开放平台](https://open.feishu.cn/app?lang=zh-CN)，创建自建应用并添加常用权限：

```text
docs:doc
docs:doc:readonly
wiki:wiki
wiki:wiki:readonly
drive:drive:readonly
```

如果需要上传图片，再补 `drive:file`。记录下 `App ID` 和 `App Secret`。

### 2. 安装项目

```bash
git clone https://github.com/MrQ-Coding/feishu-creator.git
cd feishu-creator
npm install
cp .env.example .env
npm run build
```

`.env` 最小配置：

```dotenv
FEISHU_APP_ID=cli_你的AppID
FEISHU_APP_SECRET=你的AppSecret
FEISHU_AUTH_TYPE=tenant
MCP_MODE=auto
```

### 3. 接入 MCP 客户端

推荐先用 `stdio`。

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

Claude Desktop、Cursor、Codex 等支持 `stdio` 的客户端都可以按这个思路接。改完配置后重启客户端。

如果你的环境访问飞书需要代理，要在客户端里显式透传 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`，并设置 `NODE_USE_ENV_PROXY=1`。

### 4. 验证链路

在 AI 对话中依次执行：

```text
1. ping
2. auth_status
3. auth_status（携带 fetchToken: true）
4. get_document_info
```

如果前 3 步通过，但 `get_document_info` 失败，通常是飞书权限、文档 token，或认证模式的问题，而不是 MCP 传输层问题。

---

## 核心能力

仓库优先暴露通用 alias，例如 `create_document`、`get_document_info`、`update_block_text`。为了兼容旧客户端，也保留 `create_feishu_document`、`get_feishu_document_info` 这类 legacy alias。

### 文档与章节编辑

- `create_document`
- `get_document_info`
- `get_document_blocks`
- `preview_edit_plan`
- `replace_section_blocks`
- `upsert_section`
- `insert_before_heading`
- `delete_by_heading`
- `copy_section`
- `move_section`
- `locate_section_range`

这组能力的重点是“按标题定位”，不需要你先拿到 `block_id`。

### 块级写入

- `generate_section_blocks`
- `generate_rich_text_blocks`
- `update_block_text`
- `batch_update_blocks`
- `batch_create_blocks`
- `delete_document_blocks`

### 图片、图表、表格、Markdown

- `upload_local_image`
- `render_graphviz_diagram`
- `create_graphviz_diagram_block`
- `render_plantuml_diagram`
- `create_plantuml_diagram_block`
- `import_markdown_to_document`
- `export_document_to_markdown`
- `create_table`
- `get_table`
- `update_table_cell`
- `replace_table`

### Wiki 与运维

- `list_feishu_wiki_spaces`
- `get_feishu_wiki_tree`
- `search_feishu_documents`
- `delete_feishu_document`
- `batch_delete_feishu_documents`
- `ping`
- `auth_status`
- `set_auth_mode`
- `get_user_authorize_url`
- `exchange_user_auth_code`
- `set_user_tokens`

---

## 典型工作流

### 按标题更新一章

```text
preview_edit_plan（operation: replace_section_blocks, sectionHeading: "二、方案设计"）
replace_section_blocks（documentId: xxx, sectionHeading: "二、方案设计", blocks: [...]）
```

### 新建 Wiki 文档并写入内容

```text
list_feishu_wiki_spaces
create_document（wikiContext: { spaceId: "xxx" }, title: "..."）
import_markdown_to_document（documentId: xxx, markdown: "..."）
```

### 渲染图表并插入文档

```text
create_graphviz_diagram_block(
  documentId: xxx,
  sourceText: "digraph G { A -> B -> C }",
  parentBlockId: xxx
)
```

### 跨文档复制章节

```text
preview_edit_plan（operation: copy_section, documentId: 源文档ID, sectionHeading: "背景"）
copy_section（documentId: 源文档ID, sectionHeading: "背景", targetDocumentId: 目标文档ID）
```

---

## 认证与运行模式

**默认推荐**：`MCP_MODE=auto` + `--stdio` + `FEISHU_AUTH_TYPE=tenant`

`tenant` 模式最省心，适合日常自动化；限制是 Wiki 搜索会自动降级为文档搜索。  
`user` 模式用指定用户的 token，适合需要按用户权限访问内容的场景。

需要特别注意：`stdio` 模式天然更适合单用户。本项目当前的 HTTP 模式已经支持“每个 MCP session 独立的运行时鉴权上下文”，但前提是外层调用方在 session 初始化时把用户对应的 Feishu token 信息带进来。

如果要走 OAuth 回调或接真实 HTTP MCP 客户端，可以启用 HTTP 模式：

```bash
npm run start:http
```

HTTP 模式提供：

- `GET /health`
- `POST /mcp`
- `GET /callback`

默认开启 Bearer 鉴权，可通过 `Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>` 或 `x-mcp-token` 传入。

需要特别注意：`MCP_HTTP_AUTH_TOKEN` 只用于保护 MCP 入口，不代表“这是哪个最终用户”。当前 HTTP 模式里的服务进程仍共享一套运行时飞书鉴权上下文，所以它更适合：

- 单用户独占实例
- 单一 `tenant` 自动化身份

如果要把它部署成真正的多用户共享服务，推荐在外层应用或网关先完成用户登录与 Feishu OAuth 绑定，再按你自己的 `app_user_id` 解析该用户对应的 Feishu token，并为每个请求提供用户级鉴权上下文。不要让终端用户在 MCP 配置里直接提交账号密码。

当前 HTTP 实现支持在 MCP initialize 时注入这些可选请求头，用来创建 session 级别的用户上下文：

- `x-app-user-id`
- `x-feishu-auth-type`
- `x-feishu-user-access-token`
- `x-feishu-user-refresh-token`
- `x-feishu-user-access-token-expires-at`
- `x-feishu-user-refresh-token-expires-at`

推荐做法是：你的网关先识别业务用户，再查你自己保存的 Feishu OAuth 记录，然后只在创建 MCP session 时把该用户对应的 token 信息透传给 `feishu-creator`。后续工具调用复用同一个 MCP session 即可。

### 用户代理 -> MCP 协议

如果你希望 `feishu-creator` 只做服务层，而由用户系统或本地代理负责 OAuth 和 token 刷新，推荐按下面的角色分工接入：

- 用户系统 / 用户本地代理负责：
  - 完成 Feishu OAuth
  - 刷新用户 token
  - 在创建 MCP session 时把用户 token 透传给 `feishu-creator`
- `feishu-creator` 负责：
  - 使用这些 token 调 Feishu API
  - 读取用户文档
  - 生成文风画像或技术文档
  - 把画像和生成结果保存回用户自己的飞书文档

推荐的默认内容归宿也是“用户自己的飞书”：

- `feishu-style-extract` 默认把确认后的画像保存回用户飞书
- `feishu-doc-writer` 在需要复用文风时，优先从用户飞书里取回画像文档再应用

更完整的请求协议和 header 约定见 [user-agent-mcp-protocol.md](./skills/feishu-creator-doc-workflow/references/user-agent-mcp-protocol.md)。

---

## 使用边界

- Markdown 导入导出是轻量实现，不保证完全无损
- 复杂表格样式、合并单元格等能力仍不在当前工具面里
- `search_feishu_documents` 存在索引延迟，不适合拿来做新建/删除后的第一验收
- Wiki 删除依赖 Playwright 浏览器会话；首次使用通常要先完成一次飞书登录
- PlantUML 在部分图类型下仍可能依赖 Graphviz `dot`
- 改完服务端代码后，要重启 MCP 进程

---

## 常用环境变量

完整字段见 [`.env.example`](./.env.example)。日常最常用的是：

| 变量 | 说明 |
| --- | --- |
| `FEISHU_APP_ID` | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret |
| `FEISHU_AUTH_TYPE` | `tenant` 或 `user` |
| `MCP_MODE` | `auto` / `stdio` / `http` |
| `MCP_HTTP_BIND_HOST` | HTTP 绑定地址 |
| `MCP_HTTP_REQUIRE_AUTH` | HTTP 模式是否启用鉴权 |
| `MCP_HTTP_AUTH_TOKEN` | HTTP Bearer token |
| `FEISHU_USER_ACCESS_TOKEN` | `user` 模式 access token |
| `FEISHU_USER_REFRESH_TOKEN` | `user` 模式 refresh token |
| `FEISHU_GRAPHVIZ_DOT_PATH` | Graphviz `dot` 路径 |
| `FEISHU_PLANTUML_COMMAND` | PlantUML 命令 |
| `FEISHU_PLANTUML_JAR_PATH` | PlantUML jar 路径 |
| `FEISHU_JAVA_PATH` | `java` 路径 |
| `FEISHU_PLAYWRIGHT_HEADLESS` | Wiki 删除是否无头执行 |
| `FEISHU_PLAYWRIGHT_USER_DATA_DIR` | 浏览器 profile 路径 |

---

## 本地开发

```bash
npm run dev
npm run dev:stdio
npm run dev:http
npm run build
npm run type-check
node scripts/callTool.mjs --tool ping --args-json '{"message":"test"}'
node scripts/callTool.mjs --list-tools
```

---

## 仓库内置 Skills

仓库同时维护了本地 skill，方便和 MCP 一起做版本管理：

- [skills/README.md](./skills/README.md)

同步到本机 Codex skill 目录：

```bash
npm run skills:sync
```
