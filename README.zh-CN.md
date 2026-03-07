# feishu-creator

用于逐步重写飞书自动化能力的 TypeScript MCP 服务基础工程。

[English](./README.md)

## 当前进度

当前已完成可运行的 MCP 基线能力：

- Streamable HTTP 端点：`/mcp`
- 健康检查端点：`/health`
- 内置工具：`ping`、`auth_status`、`get_user_authorize_url`、`exchange_user_auth_code`、`set_user_tokens`、`set_auth_mode`、`create_feishu_document`、`get_feishu_document_info`、`get_feishu_document_blocks`、`delete_feishu_document`、`batch_delete_feishu_documents`、`update_feishu_block_text`、`batch_update_feishu_blocks`、`delete_feishu_document_blocks`、`batch_create_feishu_blocks`、`insert_before_heading`、`locate_section_range`、`replace_section_blocks`、`delete_by_heading`、`replace_section_with_ordered_list`、`generate_section_blocks`、`generate_rich_text_blocks`、`list_feishu_wiki_spaces`、`get_feishu_wiki_tree`、`search_feishu_documents`
- 运行模式：`http`（默认）或 `stdio`
- 飞书认证：支持 `tenant` / `user`

## 启动方式

```bash
npm install
npm run dev:http
```

或：

```bash
npm run dev:stdio
```

## 用户 OAuth 自动回调

HTTP 模式下可用 OAuth 回调端点：

- `http://localhost:<PORT>/callback`

典型流程：

1. 调 `get_user_authorize_url`，`redirectUri` 传 `http://localhost:<PORT>/callback`。
2. 浏览器打开返回的 `authorizeUrl` 并授权。
3. 授权后浏览器回跳 `/callback`，服务会自动换 token、切到 `user` 模式，并写入 `.env`。

如果 `.env` 中已存在 `FEISHU_AUTH_TYPE=user` 且带 `FEISHU_USER_REFRESH_TOKEN`，服务启动时会自动预刷新一次 user token，并把最新 token 回写到 `.env`。

## 飞书认证环境变量

两种认证都必填：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_AUTH_TYPE=tenant|user`

`user` 模式可选：

- `FEISHU_USER_ACCESS_TOKEN`
- `FEISHU_USER_REFRESH_TOKEN`
- `FEISHU_WIKI_DELETE_STRATEGY=clear_content|playwright`
- `FEISHU_UI_BASE_URL`
- `FEISHU_PLAYWRIGHT_HEADLESS`
- `FEISHU_PLAYWRIGHT_EXECUTABLE_PATH`
- `FEISHU_PLAYWRIGHT_USER_DATA_DIR`
- `FEISHU_PLAYWRIGHT_ACTION_TIMEOUT_MS`
- `FEISHU_PLAYWRIGHT_LOGIN_TIMEOUT_MS`

其中：

- `clear_content`：当前默认策略。删除 wiki-backed 文档时回退为清空内容。
- `playwright`：由当前服务进程内置的 Playwright 自动化执行 wiki 节点删除。

Playwright 删除补充说明：

- 服务会优先复用已登录的飞书网页会话，直接调用飞书网页内部删除接口 `/space/api/wiki/v2/tree/del_single_node/`；只有这条直连链路失败时，才回退到页面菜单点击删除。
- 服务会优先使用系统默认浏览器；如果默认浏览器不可自动化，会继续探测系统里常见的 Chrome / Edge / Chromium / Firefox。
- `FEISHU_PLAYWRIGHT_EXECUTABLE_PATH` 可显式指定浏览器可执行文件路径，优先级最高。
- 默认建议保持 `FEISHU_PLAYWRIGHT_HEADLESS=true`。
- `FEISHU_PLAYWRIGHT_ACTION_TIMEOUT_MS` 默认值为 `45000`，网络或页面加载较慢时建议继续调大。
- 如果无头删除时发现网页登录态失效，服务会先自动准备一份轻量自动化 profile，再临时拉起一个可见浏览器窗口用于你手动完成一次飞书登录；登录完成后窗口会自动关闭，并把登录态保存到 `FEISHU_PLAYWRIGHT_USER_DATA_DIR`，随后立即回到无头模式继续删除。
- 登录态会保存在 `FEISHU_PLAYWRIGHT_USER_DATA_DIR`，后续删除会继续复用同一份会话。
- 同一服务进程内的多次 wiki 删除会复用同一个 Playwright 浏览器上下文；`batch_delete_feishu_documents` 也会沿用这份会话，避免为每篇文档重复启动浏览器。
- 服务会优先尝试从系统浏览器当前用户目录裁剪出轻量 profile；如果找不到可复用的系统 profile，也会自动创建空白轻量 profile 并等待你登录。
- 如果你希望提前准备 profile，仍然可以用下面的命令从一个已登录的 Chrome profile 裁剪出自动化专用目录：

```bash
npm run profile:bootstrap -- --source .playwright/system-chrome-clone-20260306-143253 --target .playwright/feishu-automation-profile
```

- 生成完成后，把 `FEISHU_PLAYWRIGHT_USER_DATA_DIR` 指到 `.playwright/feishu-automation-profile`。
- 如果服务运行环境没有图形界面，就需要提前准备好这份浏览器用户目录，否则 wiki 真删除会因为缺少网页登录态而失败。
- 当系统默认浏览器是 Safari 一类当前未直接支持的浏览器时，服务会继续回退到已安装的 Chromium / Firefox；再不行才会回退到 Playwright 自带浏览器。

## 性能相关配置

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

## 连通性测试建议

1. 调 `ping`：验证 MCP 服务可达  
2. 调 `auth_status`：验证认证配置  
3. 调 `auth_status` with `{"fetchToken": true}`：验证取 token 链路  
4. 调 `get_feishu_document_info`：验证真实文档查询能力

## 下一步建议

继续接入更多技术文档相关能力，例如：

- 表格、图片、附件与图表渲染
