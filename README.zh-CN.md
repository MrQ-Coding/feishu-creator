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

| 工具 | 作用 |
| --- | --- |
| `create_feishu_document` | 在 drive/wiki 创建文档 |
| `get_feishu_document_info` | 查询文档基础信息 |
| `get_feishu_document_blocks` | 查询文档块结构 |
| `delete_feishu_document` | 删除单个文档/wiki 节点 |
| `batch_delete_feishu_documents` | 批量删除文档/wiki 节点 |

### 文档编辑

| 工具 | 作用 |
| --- | --- |
| `update_feishu_block_text` | 更新单个文本类块 |
| `batch_update_feishu_blocks` | 批量更新文本类块 |
| `delete_feishu_document_blocks` | 按索引区间删除子块 |
| `batch_create_feishu_blocks` | 批量创建子块 |
| `locate_section_range` | 按标题定位 section 范围 |
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

## 高级文档

- [Advanced usage (English)](./docs/advanced.md)
- [高级说明（中文）](./docs/advanced.zh-CN.md)
