# feishu-creator

用于飞书文档/知识库自动化的 TypeScript MCP 服务。

[English](./README.md)

## 一、先知道这 3 件事

1. 这是一个 MCP 服务，不是网页应用。你需要在支持 MCP 的客户端里调用它。
2. 推荐保留 `MCP_MODE=auto`：平时默认还是走 `stdio`，只有你明确传了 `--http` 时才切到 `HTTP`。这样普通使用不用反复改 `.env`。
3. 对新手来说，第一次“真正跑通”的标准不是服务启动了，而是能连续完成 `ping`、`auth_status`、`get_feishu_document_info` 这 3 步。

## 二、最短上手路径

### 0. 准备条件

- Node.js `>= 20.17.0`
- 一组飞书应用 `app id` / `app secret`
- 一个你有权限访问的飞书文档 URL 或 `docx_id`

### 1. 创建飞书应用

   在使用工具之前，需要创建一个飞书应用：
   - 访问 飞书开放平台 并登录
   - 点击“控制台”并创建一个新应用程序
   - 获取应用程序ID和应用程序密钥，它们将用于API身份验证
   - 根据您的使用场景，为您的应用程序添加必要的权限（反正我是把所有的免审权限都开了）
   - 安全设置》重定向URL添加：http://localhost:3333/callback（终端登录飞书会报错：https://open.feishu.cn/document/faq/trouble-shooting/how-to-resolve-the-authorization-page-20029-error）


### 2. 详细安装与初始化交给飞书文档工作流助手

主 README 只保留最短成功路径；如果你在 Codex 里明确提到需要安装、初始化、配置或接入 `feishu-creator`，当前 `feishu-creator-doc-workflow` skill 会优先自动做这些事：

- 安装依赖
- 准备 `.env`
- 构建 `dist/`
- 写入常见 MCP 客户端配置
- 只在确实缺少飞书凭证时，才回退到让你补字段

也就是说，长版初始化流程不再维护在仓库文档里，而是收敛到 skill 本身。

### 3. 安装依赖

```bash
npm install
cp .env.example .env
```

### 4. 先填最小 `.env`

如果你只是想先跑通，先用 `tenant` 模式最省事：

```dotenv
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_AUTH_TYPE=tenant
```

其余配置先沿用 `.env.example` 默认值即可。默认保留 `MCP_MODE=auto` 就好，不建议为了日常使用改成 `http`。

### 5. 推荐保留 `MCP_MODE=auto`

这是当前最省心的用法：

- `.env` 里保持 `MCP_MODE=auto`
- 平时用 `npm run dev` 或 `npm run start`，实际会按 `stdio` 跑
- 只有少数场景才临时用带 `--http` 的启动命令

换句话说，`auto` 在这个项目里更像“让启动命令决定模式”，而不是让你长期固定在 `http`。

### 6. 在客户端里怎么接入（最小示例）

#### `stdio`：推荐给第一次接 MCP 的人

先编译一次：

```bash
npm run build
```

然后在你的 MCP 客户端里配置一个 `stdio` 服务。大多数客户端配置字段名会有一点差异，但核心意思都是“执行这个命令”：

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

- `dist/index.js` 会按项目路径自动读取仓库根目录下的 `.env`。
- 如果你的 MCP 客户端不会把代理环境变量透传给子进程，请在 server `env` 里补上 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`，并设置 `NODE_USE_ENV_PROXY=1`。
- `stdio` 模式没有 `/mcp` 端口，不需要你自己再开一个 HTTP 服务。
- 如果你手动在终端里运行 `npm run dev`，那是在调试服务本身，不等于客户端已经接上它。
- 如果你只是为了 OAuth 回调拿 `user` token，才临时切到 `HTTP`；平时不要为了这个把默认模式改成 `http`。具体配置见 [高级说明（中文）](./docs/advanced.zh-CN.md)。
- 在 Windows PowerShell 里，本地冒烟测试不要把带中文的内联 JSON 直接管道给 `node`。更稳的做法是走真实 MCP 客户端调用，或者用 `node scripts/callTool.mjs --tool <name> --args-file <utf8-json>`。

### 7. 第一次建议这样调用

按下面顺序最容易定位问题：

1. `ping`
   输入：`{ "message": "hello" }`
   作用：确认 MCP 传输链路是通的。
2. `auth_status`
   输入：`{}`
   作用：确认当前是 `tenant` 还是 `user` 模式。
3. `auth_status`
   输入：`{ "fetchToken": true }`
   作用：确认服务真的能拿到飞书 token。
4. `get_feishu_document_info`
   输入：`{ "documentId": "<docx_id_or_url>" }`
   作用：确认你不是只把服务启动了，而是真的能访问飞书文档。

如果前 3 步都成功，但第 4 步失败，通常就不是 MCP 问题，而是飞书权限、文档 ID、鉴权模式或应用能力范围的问题。

如果你要做本地工具冒烟，尤其是 Windows 上带中文参数时，也可以直接用：

```bash
node scripts/callTool.mjs --tool ping --args-json '{"message":"测试"}'
```

或者先把 UTF-8 JSON 写进文件，再调用：

```bash
node scripts/callTool.mjs --tool create_feishu_document --args-file ./request.json
```

## 三、什么时候用 `user` 模式

`tenant` 适合先跑通；`user` 只在你明确需要“以用户身份”访问时再启用。

- 如果你已经有现成 token：直接填写 `FEISHU_USER_ACCESS_TOKEN` 或 `FEISHU_USER_REFRESH_TOKEN`，仍然建议继续用 `stdio`。
- 如果你还没有 token：只在 OAuth 回调那次临时切到 `HTTP`，拿到 token 后回到 `MCP_MODE=auto` + `stdio`。

详细的 `user` 初始化说明只保留在 skill 流程和 [高级说明（中文）](./docs/advanced.zh-CN.md) 里。

## 四、常见误区

- `stdio` 不是“先启动一个本地端口，再让客户端去连”；默认情况下它根本不需要端口。
- 新建或删除文档后，不要第一时间拿 `search_feishu_documents` 当验收依据；优先用 `get_feishu_document_info` 或 `get_feishu_wiki_tree`，搜索可能有索引延迟。
- 你刚改完服务端代码时，已经运行中的 MCP 进程不会自动加载新代码；要先重启再验证。
- 新建知识库页面时，优先传 `wikiContext.spaceId`；只有明确要兼容 Drive 文件夹时才传 `folderToken`。

## 五、必填环境变量

下面的 `MCP_HTTP_*` 变量只在你确实要用 `HTTP` 模式时才需要；默认 `stdio` 路径可以先忽略它们。

| 变量 | 何时必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `FEISHU_APP_ID` | 始终 | - | 飞书应用 app id |
| `FEISHU_APP_SECRET` | 始终 | - | 飞书应用 app secret |
| `FEISHU_AUTH_TYPE` | 始终 | - | `tenant` 或 `user` |
| `MCP_HTTP_BIND_HOST` | HTTP 模式 | `127.0.0.1` | MCP HTTP 绑定地址 |
| `MCP_HTTP_REQUIRE_AUTH` | HTTP 模式 | `true` | `/mcp` 是否强制鉴权 |
| `MCP_HTTP_AUTH_TOKEN` | HTTP 模式且 `MCP_HTTP_REQUIRE_AUTH=true` | - | `/mcp` Bearer token |

## 六、常用可选环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FEISHU_USER_ACCESS_TOKEN` | - | `user` 模式 access token |
| `FEISHU_USER_REFRESH_TOKEN` | - | `user` 模式 refresh token |
| `FEISHU_USER_ACCESS_TOKEN_EXPIRES_AT` | - | access token 过期时间戳 |
| `FEISHU_USER_REFRESH_TOKEN_EXPIRES_AT` | - | refresh token 过期时间戳 |
| `FEISHU_WIKI_DELETE_STRATEGY` | `playwright` | 当前仅支持 `playwright` |
| `FEISHU_UI_BASE_URL` | 飞书默认域名 | 飞书网页基地址 |
| `FEISHU_PLAYWRIGHT_HEADLESS` | `true` | 是否无头运行浏览器 |
| `FEISHU_PLAYWRIGHT_EXECUTABLE_PATH` | - | 指定浏览器可执行文件 |
| `FEISHU_PLAYWRIGHT_USER_DATA_DIR` | 项目配置值 | 浏览器 profile 目录 |
| `FEISHU_PLAYWRIGHT_ACTION_TIMEOUT_MS` | `45000` | 页面动作超时 |
| `FEISHU_PLAYWRIGHT_LOGIN_RECOVERY_MODE` | `on_demand` | `on_demand` 或 `interactive_first` |
| `FEISHU_PLAYWRIGHT_LOGIN_TIMEOUT_MS` | 项目配置值 | 交互登录等待时长 |
| `FEISHU_GRAPHVIZ_DOT_PATH` | - | 指定 `dot` 可执行文件；未填时走系统 PATH |
| `FEISHU_PLANTUML_COMMAND` | - | 指定 `plantuml` 可执行文件；优先级高于 jar 配置 |
| `FEISHU_PLANTUML_JAR_PATH` | - | 指定 PlantUML jar 路径；未填时走系统 PATH 上的 `plantuml` |
| `FEISHU_JAVA_PATH` | - | 当使用 jar 模式时指定 `java` 可执行文件 |

## 七、快速连通性检查

| 检查项 | 工具 | 示例输入 |
| --- | --- | --- |
| 服务可达 | `ping` | `{ "message": "hello" }` |
| 鉴权状态 | `auth_status` | `{}` |
| 取 token 链路 | `auth_status` | `{ "fetchToken": true }` |
| 真实文档读取 | `get_feishu_document_info` | `{ "documentId": "<docx_id_or_url>" }` |

## 八、工具清单

### 鉴权与运行时

| 工具 | 作用 |
| --- | --- |
| `ping` | 连通性检查 |
| `auth_status` | 查看鉴权模式与 token 缓存 |
| `get_user_authorize_url` | 生成 OAuth 授权链接 |
| `exchange_user_auth_code` | 用 OAuth code 换 user token |
| `set_user_tokens` | 运行时设置 user token |
| `set_auth_mode` | 切换运行时鉴权模式 |

### 文档基础

本服务以 wiki 为主，不提供独立的 Drive 浏览/搜索工具；保留的 Drive 相关能力仅限于基于 `folderToken` 的兼容创建，以及文档搜索兜底、图片上传、删除落点判断这些仍然依赖的内部能力。

| 工具 | 作用 |
| --- | --- |
| `create_feishu_document` | 在 wiki 创建文档，或在传入 `folderToken` 时创建到 Drive 文件夹 |
| `get_feishu_document_info` | 查询文档基础信息 |
| `get_feishu_document_blocks` | 查询文档块结构 |
| `delete_feishu_document` | 删除单个文档/wiki 节点 |
| `batch_delete_feishu_documents` | 批量删除文档/wiki 节点 |
| `import_markdown_to_feishu` | 将简化 Markdown 导入文档 |
| `export_feishu_document_to_markdown` | 将文档导出为简化 Markdown |

### 文档编辑

当前公开的 MCP 工具总数是 40 个，其中 `render_graphviz_diagram`、`create_graphviz_diagram_block`、`render_plantuml_diagram`、`create_plantuml_diagram_block`、`upload_local_image_to_feishu`、`upsert_section` 和基础表格工具都已经属于正式的文档编辑能力。

| 工具 | 作用 |
| --- | --- |
| `update_feishu_block_text` | 更新单个文本类块 |
| `batch_update_feishu_blocks` | 批量更新文本类块 |
| `render_graphviz_diagram` | 将 Graphviz DOT 源码渲染为本地 PNG/SVG 文件 |
| `create_graphviz_diagram_block` | 将 Graphviz DOT 源码渲染为 PNG 后上传进飞书文档 |
| `render_plantuml_diagram` | 将 PlantUML 源码渲染为本地 PNG/SVG 文件 |
| `create_plantuml_diagram_block` | 将 PlantUML 源码渲染为 PNG 后上传进飞书文档 |
| `upload_local_image_to_feishu` | 上传本地图片到文档，或原位替换已有图片块 |
| `create_feishu_table` | 创建基础表格块，并可选填充纯文本单元格内容 |
| `get_feishu_table` | 读取表格块，返回纯文本单元格矩阵 |
| `update_feishu_table_cell` | 按行列位置替换单个表格单元格 |
| `replace_feishu_table` | 整体替换基础表格；尺寸变化时会在原位置重建 |
| `delete_feishu_document_blocks` | 按索引区间删除子块 |
| `batch_create_feishu_blocks` | 批量创建子块 |
| `locate_section_range` | 按标题定位 section 范围 |
| `copy_section` | 在同文档/跨文档复制 section |
| `move_section` | 在同文档/跨文档移动 section |
| `preview_edit_plan` | 预览语义化编辑计划，不真正修改文档 |
| `insert_before_heading` | 在标题前插入内容 |
| `replace_section_blocks` | 替换 section 内容 |
| `upsert_section` | 命中时替换 section 内容，未命中时追加新的标题加内容 section |
| `delete_by_heading` | 按标题删除 section |
| `replace_section_with_ordered_list` | 用有序列表替换 section |
| `generate_section_blocks` | 生成标题/段落/列表 section |
| `generate_rich_text_blocks` | 生成富文本块集合 |

### 知识库与搜索

| 工具 | 作用 |
| --- | --- |
| `list_feishu_wiki_spaces` | 列出可见知识库空间 |
| `get_feishu_wiki_tree` | 获取知识库节点树 |
| `search_feishu_documents` | 按关键词搜索文档/wiki 节点 |

## 九、文本更新参数格式

`update_feishu_block_text` 与 `batch_update_feishu_blocks` 的 `textElements`：

| 格式 | 状态 | 示例 |
| --- | --- | --- |
| 对象数组 | 推荐 | `[{ "text": "你好，世界" }]` |
| 字符串数组 | 向后兼容（自动归一化） | `["你好，世界"]` |

## 十、富文本里的内联代码

`generate_section_blocks`、`generate_rich_text_blocks`、`replace_section_blocks`、`upsert_section`、`insert_before_heading`、`replace_section_with_ordered_list` 的文本字段支持轻量级内联代码解析：

- 使用反引号包裹代码片段，例如 ``请执行 `npm run build` ``。
- 仅解析内联代码 span，不会把整段文本当作完整 Markdown 文档处理。
- `code` 类型块仍按原样写入，不会把其中的反引号再解释成内联样式。

## 十一、Markdown 导入与导出

第一版 Markdown 工作流是“够用优先”的轻量实现，不追求完全无损。

- 导入支持标题、段落、有序列表、无序列表、引用、围栏代码块、内联代码，以及基础 Markdown 表格。
- 导出支持同一组核心块类型，并会尽量输出粗体、斜体、删除线、内联代码、下划线形式的 `<u>...</u>`，以及在结构可还原时输出基础 Markdown 表格。
- 现在已经补上了基础表格 MCP 工具，可直接创建表格、读取表格、替换单元格，以及整体替换基础表格。
- Markdown 表格链路仍然适合导入导出场景，但它不是无损方案，也不应被描述成完整的表格编辑面。
- 行级、列级、合并单元格、样式这类更强的表格能力目前仍未单独开放。
- 嵌套列表、附件以及其他飞书特有的高级块目前仍不保留。

## 十二、操作注意事项

- `create_feishu_document` 的常规用法是 wiki-first。新建知识库页面请传 `wikiContext.spaceId`；只有明确需要兼容 Drive 文件夹时才传 `folderToken`。
- 流程图与通用有向图优先使用 `render_graphviz_diagram` / `create_graphviz_diagram_block`，输入应为完整的 Graphviz DOT 源码。
- 时序图、类图等 UML 图优先使用 `render_plantuml_diagram` / `create_plantuml_diagram_block`。如果源码里未显式写 `@startuml` / `@enduml`，服务会自动补齐。
- `create_plantuml_diagram_block` 渲染类图时仍依赖本机可用的 Graphviz `dot`；如果 `dot` 不在系统 PATH，可通过 `FEISHU_GRAPHVIZ_DOT_PATH` 配置。
- 做基础文档表格时，优先使用 `create_feishu_table`、`get_feishu_table`、`update_feishu_table_cell`、`replace_feishu_table`；如果源内容本来就是 Markdown 表格，再考虑 `import_markdown_to_feishu` / `export_feishu_document_to_markdown`。
- 需要插入本地图片或替换现有图片时，优先使用 `upload_local_image_to_feishu`，不要手写底层图片块结构。
- 新建或删除文档后，不要第一时间用 `search_feishu_documents` 当成验收依据。应先用 `get_feishu_document_info` 或 `get_feishu_wiki_tree`，搜索可留到索引同步后再做。
- `delete_feishu_document` 或 `batch_delete_feishu_documents` 的即时校验，可能返回普通 not-found，也可能返回飞书 `code=1770003` / `resource deleted`。这两种都应视为“删除已成功确认”，当前服务会把它们统一映射成 `postDeleteCheck.verifiedDeleted=true`。
- `copy_section` 和 `move_section` 处理的是完整 section 区间，标题后面紧跟的图片等非标题块也会一起算进去。
- 当 section 内含图片时，服务会先下载源图片字节，再在目标文档重新上传，所以复制后的图片会拿到新的 `file_token`，整体也会比纯文本转移更慢。
- 跨文档 `copy_section` / `move_section` 前，优先用 `preview_edit_plan` 看清 section 边界，尤其是末尾可能带图片或子块时。
- 如果你刚改过服务端代码，要先重启 MCP 进程，再用外部客户端验行为；长时间运行的进程不会自动拾取仓库里的最新修改。

## 十三、高级文档

- [Advanced usage (English)](./docs/advanced.md)
- [高级说明（中文）](./docs/advanced.zh-CN.md)
