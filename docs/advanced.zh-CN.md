# 高级说明（中文）

本页汇总顶层 README 中不展开的运行细节与运维说明。

## OAuth 回调细节

HTTP 模式下回调地址：

- `http://localhost:<PORT>/callback`

典型流程：

1. 调 `get_user_authorize_url`，传 `redirectUri=http://localhost:<PORT>/callback`。
2. 浏览器打开 `authorizeUrl` 并授权。
3. 回跳 `/callback` 时带上 `code` 和 `state`。
4. 服务校验一次性 `state`，自动换 token，切到 `user` 模式，并回写 `.env`。

如果 `.env` 已有 `FEISHU_AUTH_TYPE=user` 且存在 `FEISHU_USER_REFRESH_TOKEN`，服务会在启动时对“过期信息缺失或接近过期”的 token 做预刷新。

## HTTP `/mcp` 鉴权头

当 `MCP_HTTP_REQUIRE_AUTH=true` 时，请携带以下任一请求头：

- `Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>`
- `x-mcp-token: <MCP_HTTP_AUTH_TOKEN>`

## Playwright Wiki 删除细节

### 当前策略

| 配置项 | 取值 |
| --- | --- |
| `FEISHU_WIKI_DELETE_STRATEGY` | `playwright` |

### 删除路径

1. 优先走内部接口 `/space/api/wiki/v2/tree/del_single_node/`（复用已登录网页态）。
2. 直连失败后回退 UI 自动化删除。
3. 无头模式遇到登录态失效时，若有 GUI，则走交互恢复登录后重试无头删除。

### 浏览器选择优先级

| 优先级 | 规则 |
| --- | --- |
| 1 | 配置了 `FEISHU_PLAYWRIGHT_EXECUTABLE_PATH` 则优先使用 |
| 2 | 可自动化的系统默认浏览器 |
| 3 | 系统已安装的 Chrome / Edge / Chromium / Firefox |
| 4 | Playwright 自带 Chromium 兜底 |

### Profile 与锁行为

| 项目 | 行为 |
| --- | --- |
| `FEISHU_PLAYWRIGHT_USER_DATA_DIR` 相对路径 | 相对于项目根目录解析 |
| 登录会话保存位置 | `FEISHU_PLAYWRIGHT_USER_DATA_DIR` |
| 锁释放时机 | 每次顶层删除调用结束后关闭持久化 context，按次释放 profile 锁 |

### 可选：提前准备自动化 Profile

```bash
npm run profile:bootstrap -- --source .playwright/system-chrome-clone-20260306-143253 --target .playwright/feishu-automation-profile
```

准备完成后可设置 `FEISHU_PLAYWRIGHT_USER_DATA_DIR=.playwright/feishu-automation-profile`。

## 性能调优变量

| 变量 |
| --- |
| `FEISHU_MAX_CONCURRENCY` |
| `FEISHU_REQUEST_MAX_RETRIES` |
| `FEISHU_REQUEST_BACKOFF_BASE_MS` |
| `FEISHU_OAUTH_STATE_TTL_SECONDS` |
| `FEISHU_DOC_INFO_CACHE_TTL_SECONDS` |
| `FEISHU_DOC_BLOCKS_CACHE_TTL_SECONDS` |
| `FEISHU_WIKI_SPACES_CACHE_TTL_SECONDS` |
| `FEISHU_WIKI_TREE_CACHE_TTL_SECONDS` |
| `FEISHU_WIKI_TREE_MAX_CONCURRENCY` |
| `FEISHU_CACHE_MAX_ENTRIES` |
| `FEISHU_CACHE_CLEANUP_INTERVAL_SECONDS` |
