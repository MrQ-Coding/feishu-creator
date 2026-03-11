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

### 即时校验语义

- 删除后的即时校验，会把普通 not-found 和飞书 `code=1770003` / `resource deleted` 都视为“删除已成功确认”。
- 在当前服务返回结构里，这种情况应表现为 `postDeleteCheck.verifiedDeleted=true`。

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

## Section 复制 / 移动

- `copy_section` 会复制完整的 section 区间，包含标题块本身。
- `move_section` 采用“先复制、后删除源 section”的流程；如果删除源 section 失败，会尽力回滚目标侧插入。
- 目标位置可以用 `targetIndex` 指定，也可以用 `targetSectionHeading` / `targetHeadingPath` 作为插入锚点。
- 如果不提供目标锚点，会追加到 `targetParentBlockId`（未指定时为目标文档根块）末尾。
- 在同一父块下移动时，如果目标位置落在源 section 内部，会直接拒绝，避免自重叠。
- 在同一父块下，直到遇到下一个标题前的非标题块都属于这个 section，末尾图片也不例外。
- 如果 section 内含图片，当前实现会走“媒体重建”：先下载源图片字节，再上传到目标文档，因此复制后的图片会拿到新的 `file_token`。
- `preview_edit_plan` 遇到图片或嵌套子块时会给 warning。这个 warning 主要是提示行为和耗时，不等于工具必然失败。
- 图片重建依赖当前鉴权上下文具备源图片下载权限；如果鉴权模式受限，这条链路仍可能失败。

## 本地代码改动后的验证方式

如果你改的是服务实现本身，不要默认一个已经运行中的 MCP 进程会自动加载新代码。

1. 通过外部客户端验证前，先重启 MCP 服务。
2. 或者直接调用本地 service 层做集成验证。
3. 记录测试结论时，明确标注证据来自 MCP 工具调用、本地脚本，还是代码阅读推断。
