# feishu-creator

用于飞书文档/知识库自动化的 TypeScript MCP 服务。

[English](./README.md)

## 快速开始

| 步骤 | 操作 | 命令 / 值 |
| --- | --- | --- |
| 1 | 安装依赖 | `npm install` |
| 2 | 准备环境变量文件 | `cp .env.example .env` |
| 3 | 默认模式（`stdio`）启动 | `npm run dev` |
| 4 | HTTP 模式启动 | `npm run dev:http` |

`npm run dev` 和 `npm run start` 默认是 `stdio`，除非被 `MCP_MODE` 或命令行参数覆盖。

## 必填环境变量

| 变量 | 何时必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `FEISHU_APP_ID` | 始终 | - | 飞书应用 app id |
| `FEISHU_APP_SECRET` | 始终 | - | 飞书应用 app secret |
| `FEISHU_AUTH_TYPE` | 始终 | - | `tenant` 或 `user` |
| `MCP_HTTP_BIND_HOST` | HTTP 模式 | `127.0.0.1` | MCP HTTP 绑定地址 |
| `MCP_HTTP_REQUIRE_AUTH` | HTTP 模式 | `true` | `/mcp` 是否强制鉴权 |
| `MCP_HTTP_AUTH_TOKEN` | HTTP 模式且 `MCP_HTTP_REQUIRE_AUTH=true` | - | `/mcp` Bearer token |

## 常用可选环境变量

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

## 快速连通性检查

| 检查项 | 工具 | 示例输入 |
| --- | --- | --- |
| 服务可达 | `ping` | `{ "message": "hello" }` |
| 鉴权状态 | `auth_status` | `{}` |
| 取 token 链路 | `auth_status` | `{ "fetchToken": true }` |
| 真实文档读取 | `get_feishu_document_info` | `{ "documentId": "<docx_id_or_url>" }` |

## 工具清单

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

| 工具 | 作用 |
| --- | --- |
| `update_feishu_block_text` | 更新单个文本类块 |
| `batch_update_feishu_blocks` | 批量更新文本类块 |
| `delete_feishu_document_blocks` | 按索引区间删除子块 |
| `batch_create_feishu_blocks` | 批量创建子块 |
| `locate_section_range` | 按标题定位 section 范围 |
| `copy_section` | 在同文档/跨文档复制 section |
| `move_section` | 在同文档/跨文档移动 section |
| `preview_edit_plan` | 预览语义化编辑计划，不真正修改文档 |
| `insert_before_heading` | 在标题前插入内容 |
| `replace_section_blocks` | 替换 section 内容 |
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

## 文本更新参数格式

`update_feishu_block_text` 与 `batch_update_feishu_blocks` 的 `textElements`：

| 格式 | 状态 | 示例 |
| --- | --- | --- |
| 对象数组 | 推荐 | `[{ "text": "你好，世界" }]` |
| 字符串数组 | 向后兼容（自动归一化） | `["你好，世界"]` |

## 富文本里的内联代码

`generate_section_blocks`、`generate_rich_text_blocks`、`replace_section_blocks`、`insert_before_heading`、`replace_section_with_ordered_list` 的文本字段支持轻量级内联代码解析：

- 使用反引号包裹代码片段，例如 ``请执行 `npm run build` ``。
- 仅解析内联代码 span，不会把整段文本当作完整 Markdown 文档处理。
- `code` 类型块仍按原样写入，不会把其中的反引号再解释成内联样式。

## Markdown 导入与导出

第一版 Markdown 工作流是“够用优先”的轻量实现，不追求完全无损。

- 导入支持标题、段落、有序列表、无序列表、引用、围栏代码块和内联代码。
- 导出支持同一组块类型，并会尽量输出粗体、斜体、删除线、内联代码，以及下划线形式的 `<u>...</u>`。
- 目前还不保留嵌套列表、表格、附件以及其他飞书特有的高级块。

## 操作注意事项

- `create_feishu_document` 的常规用法是 wiki-first。新建知识库页面请传 `wikiContext.spaceId`；只有明确需要兼容 Drive 文件夹时才传 `folderToken`。
- 新建或删除文档后，不要第一时间用 `search_feishu_documents` 当成验收依据。应先用 `get_feishu_document_info` 或 `get_feishu_wiki_tree`，搜索可留到索引同步后再做。
- `delete_feishu_document` 或 `batch_delete_feishu_documents` 的即时校验，可能返回普通 not-found，也可能返回飞书 `code=1770003` / `resource deleted`。这两种都应视为“删除已成功确认”，当前服务会把它们统一映射成 `postDeleteCheck.verifiedDeleted=true`。
- `copy_section` 和 `move_section` 处理的是完整 section 区间，标题后面紧跟的图片等非标题块也会一起算进去。
- 当 section 内含图片时，服务会先下载源图片字节，再在目标文档重新上传，所以复制后的图片会拿到新的 `file_token`，整体也会比纯文本转移更慢。
- 跨文档 `copy_section` / `move_section` 前，优先用 `preview_edit_plan` 看清 section 边界，尤其是末尾可能带图片或子块时。
- 如果你刚改过服务端代码，要先重启 MCP 进程，再用外部客户端验行为；长时间运行的进程不会自动拾取仓库里的最新修改。

## 高级文档

- [Advanced usage (English)](./docs/advanced.md)
- [高级说明（中文）](./docs/advanced.zh-CN.md)
