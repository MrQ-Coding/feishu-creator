# feishu-creator

用于飞书文档与知识库自动化的 TypeScript MCP 服务。

[English](./README.md)

## 一、项目定位

`feishu-creator` 不是网页应用，而是一个给 MCP 客户端调用的服务端。

它现在主要聚焦在 4 件事：

1. 把飞书文档/知识库操作整理成稳定的 MCP 工具面。
2. 把平台无关的文档工作流，与飞书特有的适配器代码逐步拆开。
3. 在“块级 API 很底层”的前提下，补一层更适合 AI 和脚本调用的语义化编辑能力。
4. 把图表渲染、Markdown 转换、知识库删除这类旁路能力也收进同一套工作流里。

当前公开 MCP 工具面覆盖：

- 鉴权与运行时
- 文档创建、读取、删除
- 块级编辑与 section 级语义编辑
- Markdown 导入导出
- Graphviz / PlantUML 渲染与回写
- 本地图片上传
- 基础表格操作
- 知识库空间、节点树与搜索

为了兼顾跨平台可读性与旧客户端兼容性，服务现在会同时暴露两类名称：

- 推荐优先使用通用 alias，例如 `create_document`、`get_document_info`、`update_block_text`
- 继续保留旧的飞书命名 alias，例如 `create_feishu_document`、`get_feishu_document_info`、`update_feishu_block_text`

## 二、能力概览

### 1. 鉴权与运行模式

- 支持 `tenant` 与 `user` 两种鉴权模式。
- 支持 `stdio` 与 `HTTP` 两种 MCP 传输模式。
- 推荐保留 `MCP_MODE=auto`，平时走 `stdio`，只有显式传 `--http` 时才切换到 HTTP。
- `user` 模式支持 OAuth 授权链接生成、`code` 换 token、运行时切换、写回 `.env`。

### 2. 文档与知识库能力

- `create_document` / `create_feishu_document` 以 wiki-first 为主，`folderToken` 仅保留给 Drive 文件夹兼容场景。
- `get_document_info` / `get_feishu_document_info` 同时支持 `docx` 与 `wiki` 输入。
- `get_document_blocks` / `get_feishu_document_blocks` 提供自动分页的块树读取能力。
- 删除链路支持单个与批量删除，并带删除后校验。

### 3. 语义化编辑能力

- 支持单块文本更新、批量文本更新、批量创建子块。
- 支持按标题定位 section，再做 `insert`、`replace`、`delete`、`upsert`。
- 支持 `copy_section` / `move_section` 跨文档转移整段 section。
- 支持 `preview_edit_plan` 先预览命中标题、范围与插入点，再执行真正修改。
- 写入链路统一支持分块写入、自适应缩块、断点续跑、`client_token` checkpoint。

### 4. 附加能力

- `import_markdown_to_document` / `export_document_to_markdown` 负责轻量 Markdown 往返。
- `render_graphviz_diagram` / `render_plantuml_diagram` 负责本地渲染。
- `create_graphviz_diagram_block` / `create_plantuml_diagram_block` 负责渲染后直接上传回文档。
- `upload_local_image` 负责插入或替换图片块。
- 基础表格支持创建、读取、改单元格、整体替换。

## 三、源码架构

### 1. 主调用链

```text
MCP client
  -> src/index.ts
  -> src/mcp/app.ts
  -> src/mcp/tools/*
  -> src/services/*
  -> src/feishu/client.ts
  -> Feishu Open API / Playwright browser flow
```

### 2. 目录分层

| 路径 | 责任 |
| --- | --- |
| `src/index.ts` | 进程入口，决定 `stdio` / `http` 模式，并处理 HTTP `/health`、`/callback`、MCP session 生命周期 |
| `src/mcp/app.ts` | 注册 MCP server 与全部工具 |
| `src/mcp/tools/*` | 每个工具的 schema、参数说明、错误包装、到 service 的派发 |
| `src/platform/*` | 平台适配层，包括文档引用解析、块工厂、块读取/识别、Markdown codec、document/query/edit/media gateway |
| `src/feishu/*` | 鉴权管理、原始 HTTP 客户端、文档 ID/wiki token 解析、用户 token 持久化 |
| `src/services/document/*` | 文档创建、文档信息读取、块树读取与缓存 |
| `src/services/documentEdit/*` | 文档编辑主干，包括块变更、标题定位、section 转移、图片上传、表格与删除 |
| `src/services/diagramImage/*` | Graphviz / PlantUML 渲染，以及渲染结果上传到文档 |
| `src/services/markdown/*` | Markdown 解析与导出渲染 |
| `src/services/wiki/*` | 知识库空间列表与节点树读取 |
| `src/services/wikiBrowser/*` | 需要浏览器上下文的删除流程、登录恢复、Playwright session 复用 |
| `src/appContext.ts` | 把 auth/client/services/cache cleanup 组装成运行时上下文 |

### 3. 几个关键设计

#### 文档编辑统一收口在 `DocumentEditService`

`DocumentEditService` 是这个仓库最核心的一层。块级修改、按标题定位的 section 编辑、图片上传、表格、删除能力，最终都从这里汇总出去。

这一层做了几件很重要的事：

- 对单文档修改加 document lock，避免并发写乱序。
- 对跨文档 `copy_section` / `move_section` / `preview_edit_plan` 做双文档锁。
- 统一做缓存失效，保证修改后 `documentInfo`、`documentBlocks`、`locateCache` 不会继续读旧值。

#### “按标题改文档”依赖 progressive scan + 缓存

`headingLocator.ts`、`sectionLocator.ts`、`sectionRange.ts` 这一组文件，把“先找到标题，再确定 section 范围”抽成了公共能力。

这也是为什么高层工具可以稳定支持：

- `insert_before_heading`
- `replace_section_blocks`
- `upsert_section`
- `delete_by_heading`
- `copy_section`
- `move_section`
- `preview_edit_plan`

#### 图表能力不是独立写文档链路，而是“先渲染，再复用图片上传”

`DiagramImageService` 只负责本地渲染与临时文件管理，真正回写文档时复用的是 `DocumentEditService.uploadLocalImage()`。

这让图表能力和普通图片上传共用一套插入/替换语义，而不是维护两套文档写入实现。

#### 删除能力走浏览器上下文，不假设开放 API 足够

`delete_feishu_document` / `batch_delete_feishu_documents` 最终走的是 `WikiBrowserDeletionService`。

实现上会优先尝试内部 API，失败后退回 UI 自动化删除；如果无头模式发现未登录，还会根据配置尝试交互式登录恢复。

#### MCP 工具名现在分成“推荐通用名”和“兼容飞书名”

service 层正在逐步去飞书耦合，但项目还需要兼容已经接入的旧客户端。

所以现在的 MCP 工具命名遵循这个原则：

- 优先推荐通用名，例如 `create_document`、`get_document_info`、`import_markdown_to_document`、`update_block_text`、`create_table`
- 继续保留旧飞书名 alias，例如 `create_feishu_document`、`get_feishu_document_info`、`import_markdown_to_feishu`、`update_feishu_block_text`、`create_feishu_table`
- 明显仍然属于飞书专有能力的工具，继续保留飞书语义，例如 wiki 空间/节点树、浏览器驱动删除

#### 有些能力会明确保留成飞书专有，不强行抽象

这个项目不会为了“看起来更整齐”把所有功能都硬塞进跨平台接口。

下面这些能力目前会明确保留为飞书专有：

- 浏览器驱动删除链路：`delete_feishu_document`、`batch_delete_feishu_documents`、`WikiBrowserDeletionService`
- 飞书知识库空间与节点树能力：`list_feishu_wiki_spaces`、`get_feishu_wiki_tree`
- 带飞书语义约束的搜索能力：`search_feishu_documents`
- 飞书 OAuth 与运行时鉴权细节：`get_user_authorize_url`、`exchange_user_auth_code`、`set_user_tokens`、`set_auth_mode`，以及 `src/feishu/*` 里的鉴权/token 持久化实现

原因很简单：这些能力要么依赖飞书专有产品概念，要么依赖不稳定的浏览器流程，要么直接绑定飞书鉴权语义，不值得伪装成通用接口。

#### 读链路有 TTL 缓存，写链路负责失效

这些服务都带缓存：

- `DocumentBlockService`
- `DocumentInfoService`
- `WikiSpaceService`
- `WikiTreeService`
- `DocumentEditService` 内部的 section locate cache

`src/appContext.ts` 会定时清理过期缓存；真正发生文档修改时，由写链路主动失效对应缓存。

## 四、快速上手

### 1. 前置条件

- Node.js `>= 20.17.0`
- 一组飞书应用 `app id` / `app secret`
- 一个你有权限访问的飞书文档 URL 或 `docx_id`

### 2. 创建飞书应用

- 登录 [飞书开放平台](https://open.feishu.cn/app?lang=zh-CN)。
- 创建一个应用，拿到 `App ID` 和 `App Secret`。
- 按你的场景补齐所需权限。
- 如果你要走 OAuth 回调，安全设置里加入 `http://localhost:3333/callback`。

### 3. 安装与构建

```bash
npm install
cp .env.example .env
npm run build
```

### 4. 最小 `.env`

第一次建议先用 `tenant` 模式跑通：

```dotenv
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_AUTH_TYPE=tenant
MCP_MODE=auto
```

### 5. MCP 客户端接入示例

推荐先用 `stdio`：

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

说明：

- `dist/index.js` 会读取仓库根目录的 `.env`。
- 当仓库根目录存在 `.env` 时，代码会优先用该文件里的 `FEISHU_*` 变量覆盖当前进程中的同名值。
- `stdio` 模式不需要本地端口。
- 如果 MCP 客户端没有把代理环境变量透传给子进程，请补 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`，并设置 `NODE_USE_ENV_PROXY=1`。

### 6. 第一次建议这样验证

1. `ping`
2. `auth_status`
3. `auth_status` with `{ "fetchToken": true }`
4. `get_document_info`

如果前 3 步通了，第 4 步不通，通常是飞书权限、文档 ID、鉴权模式或应用权限范围的问题，而不是 MCP 传输本身的问题。

## 五、认证与运行模式

### 1. 推荐默认组合

- `MCP_MODE=auto`
- MCP 客户端以 `--stdio` 启动
- `FEISHU_AUTH_TYPE=tenant`

这是日常最省心的组合。

### 2. 什么时候启用 `user`

只有在你明确需要“按用户身份访问”时，再切到 `user`：

- 已经有 token：直接设置 `FEISHU_USER_ACCESS_TOKEN` 或 `FEISHU_USER_REFRESH_TOKEN`
- 没有 token：先调用 `get_user_authorize_url`，完成浏览器授权后再调用 `exchange_user_auth_code`

### 3. 什么时候用 HTTP

HTTP 模式主要适合两类场景：

- 你要接真实 HTTP MCP client
- 你要用本地 OAuth 回调 `/callback`

如果只是平时在 Codex、Claude Desktop 一类客户端里调用，`stdio` 就够了。

## 六、关键环境变量

完整字段看 [`.env.example`](./.env.example)；日常最常用的是下面这些。

| 变量 | 说明 |
| --- | --- |
| `FEISHU_APP_ID` | 飞书应用 app id |
| `FEISHU_APP_SECRET` | 飞书应用 app secret |
| `FEISHU_AUTH_TYPE` | `tenant` 或 `user` |
| `MCP_MODE` | `auto`、`stdio`、`http` |
| `MCP_HTTP_BIND_HOST` | HTTP 模式绑定地址 |
| `MCP_HTTP_REQUIRE_AUTH` | HTTP 模式下 `/mcp` 是否需要 Bearer 鉴权 |
| `MCP_HTTP_AUTH_TOKEN` | HTTP 模式 Bearer token |
| `FEISHU_USER_ACCESS_TOKEN` | `user` 模式 access token |
| `FEISHU_USER_REFRESH_TOKEN` | `user` 模式 refresh token |
| `FEISHU_PLAYWRIGHT_HEADLESS` | 删除流程是否无头执行 |
| `FEISHU_PLAYWRIGHT_EXECUTABLE_PATH` | 指定浏览器可执行文件 |
| `FEISHU_PLAYWRIGHT_USER_DATA_DIR` | 浏览器 profile 路径 |
| `FEISHU_GRAPHVIZ_DOT_PATH` | 指定 Graphviz `dot` 路径 |
| `FEISHU_PLANTUML_COMMAND` | 指定 `plantuml` 命令 |
| `FEISHU_PLANTUML_JAR_PATH` | 指定 PlantUML jar 路径 |
| `FEISHU_JAVA_PATH` | jar 模式下指定 `java` |

## 七、工具地图

### 1. 鉴权与运行时

- `ping`
- `auth_status`
- `get_user_authorize_url`
- `exchange_user_auth_code`
- `set_user_tokens`
- `set_auth_mode`

### 2. 文档基础

推荐通用 alias：

- `create_document`
- `get_document_info`
- `get_document_blocks`

兼容飞书 alias：

- `create_feishu_document`
- `get_feishu_document_info`
- `get_feishu_document_blocks`
- `delete_feishu_document`
- `batch_delete_feishu_documents`

### 3. 文档编辑

推荐通用 alias：

- `update_block_text`
- `batch_update_blocks`
- `delete_document_blocks`
- `batch_create_blocks`
- `upload_local_image`
- `create_table`
- `get_table`
- `update_table_cell`
- `replace_table`

本来就是通用语义的编辑工具：

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

兼容飞书 alias：

- `update_feishu_block_text`
- `batch_update_feishu_blocks`
- `delete_feishu_document_blocks`
- `batch_create_feishu_blocks`
- `upload_local_image_to_feishu`
- `create_feishu_table`
- `get_feishu_table`
- `update_feishu_table_cell`
- `replace_feishu_table`

### 4. 图表

- `render_graphviz_diagram`
- `create_graphviz_diagram_block`
- `render_plantuml_diagram`
- `create_plantuml_diagram_block`

### 5. Markdown

推荐通用 alias：

- `import_markdown_to_document`
- `export_document_to_markdown`

兼容飞书 alias：

- `import_markdown_to_feishu`
- `export_feishu_document_to_markdown`

### 6. 知识库与搜索

这组能力会继续保留为飞书专有：

- `list_feishu_wiki_spaces`
- `get_feishu_wiki_tree`
- `search_feishu_documents`

## 八、典型工作流

### 1. 新建一篇知识库文档并填内容

1. 用 `list_feishu_wiki_spaces` 找到 `spaceId`
2. 用 `create_document` 创建 wiki 文档
3. 用 `generate_section_blocks`、`generate_rich_text_blocks` 或 `import_markdown_to_document` 写入内容
4. 用 `get_document_blocks` 或 `export_document_to_markdown` 验证结果

### 2. 按标题替换一段 section

1. 先用 `preview_edit_plan`
2. 再用 `replace_section_blocks` 或 `upsert_section`
3. 如果目标其实是有序列表，直接用 `replace_section_with_ordered_list`

### 3. 跨文档复制或移动章节

1. 先用 `preview_edit_plan` 确认标题命中与插入点
2. 用 `copy_section` 或 `move_section`
3. 如果 section 内含图片，预期复制会更慢，因为图片会重新上传并生成新的 `file_token`

### 4. 图表回写到文档

1. 本地只想先看效果时，用 `render_graphviz_diagram` 或 `render_plantuml_diagram`
2. 要直接写回文档时，用 `create_graphviz_diagram_block` 或 `create_plantuml_diagram_block`
3. 如果只是已有图片文件，直接走 `upload_local_image`

### 5. 基础表格编辑

1. 新建表格用 `create_table`
2. 读取当前表格内容用 `get_table`
3. 改单个单元格用 `update_table_cell`
4. 改整张表用 `replace_table`

## 九、实现与使用注意事项

- 不要把 `search_feishu_documents` 当作新建/删除后的第一验收手段，搜索有索引延迟。
- `preview_edit_plan` 是做 section 级编辑前最安全的探路工具。
- `copy_section` / `move_section` 处理的是完整 section 区间，不只是一行标题。
- Markdown 导入导出是轻量实现，不是完全无损格式。
- Markdown 已支持基础表格，但复杂样式、行列级操作、合并单元格编辑仍以原生表格工具为主。
- `create_plantuml_diagram_block` 在部分类图场景下仍依赖 Graphviz `dot`。
- 改完服务端代码后，要重启 MCP 进程；已运行中的进程不会自动加载仓库最新代码。
- 删除流程依赖浏览器会话；无头模式如果未登录，服务会按配置尝试交互式恢复。

## 十、开发命令

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

本地调单个工具时，也可以用：

```bash
node scripts/callTool.mjs --tool ping --args-json '{"message":"测试"}'
```

## 十一、进一步阅读

- [Advanced usage (English)](./docs/advanced.md)
- [高级说明（中文）](./docs/advanced.zh-CN.md)
