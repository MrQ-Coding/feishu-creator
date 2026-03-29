---
name: feishu-setup
description: Install, build, configure, and health-check feishu-creator. Use when the user asks to install feishu-creator, wire it into an MCP client (Claude Code, Cursor, Codex, etc.), set up .env credentials, verify auth, or troubleshoot startup failures.
---

# 飞书 Creator 安装配置

当任务涉及 feishu-creator 的安装、构建、环境配置、客户端接入或启动验证时使用本 skill。服务健康后，交给 `feishu-doc-workflow` 处理文档操作。

## 工作流

### 1. 前置检查

- 确认 `node >= 20.17.0` 和 `npm` 可用。
- 仓库不存在时通过 `git` 克隆或引导用户获取。

### 2. 安装与构建

1. `npm install`
2. 若 `.env` 不存在，从 `.env.example` 复制一份。
3. `npm run build`
4. 准备 MCP 客户端入口：`node /absolute/path/to/dist/index.js --stdio`

### 3. 配置凭据

最小 `.env` 配置：

```dotenv
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_AUTH_TYPE=tenant
MCP_MODE=auto
```

用户只想验证构建时不要阻塞在缺失凭据上，记录哪些值仍需填写，继续后续步骤。

### 4. 验证

按顺序执行以下 MCP 工具调用，首次失败时停下诊断：

| 步骤 | 工具调用 | 通过条件 |
|------|----------|----------|
| 1 | `ping` | 返回成功 |
| 2 | `auth_status` | 显示已配置的 App ID 和鉴权类型 |
| 3 | `auth_status`（`fetchToken: true`） | 返回有效的 access token |
| 4 | `get_document_info`（已知文档） | 返回文档元信息 |

**故障诊断：**

| 失败步骤 | 可能原因 | 修复方法 |
|----------|----------|----------|
| 步骤 1 | MCP 传输未连接 | 检查客户端配置路径，重新构建 |
| 步骤 2 | `.env` 未加载或变量缺失 | 确认 `.env` 存在且内容完整 |
| 步骤 3 | App 凭据错误或应用未审批 | 在飞书开放平台检查 App ID/Secret |
| 步骤 4 | 应用权限不足或文档 ID 错误 | 检查飞书应用权限范围、文档分享设置 |

### 5. 安装报告

向用户报告安装结果时包含以下内容：

- **安装结果**：成功/失败
- **环境**：Node 版本、操作系统
- **仓库位置**：使用绝对路径
- **执行结果**：install 和 build 的输出摘要
- **生成或更新的文件**：列出绝对路径
- **启动冒烟测试**：验证步骤的结果
- **仍需手动填写**：缺失的凭据或前置条件
- **下一步建议**：具体的后续操作

注意标注是否检测到代理环境变量（`HTTP_PROXY`、`HTTPS_PROXY`）。

### 6. 图表工具安装（按需）

当用户首次使用画图功能遇到 `not available` 错误，或主动要求安装时执行。

所有图表工具默认安装到项目 `vendor/` 目录下（便携式，不污染系统环境）。feishu-creator 会自动检测 `vendor/` 下的工具，无需配置环境变量。

#### Graphviz（`dot` 命令）

**推荐：便携安装到 vendor/**

Windows：
```bash
# 下载并解压 Graphviz 便携版到 vendor/graphviz/
curl -fSL -o vendor/graphviz.zip https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/12.2.1/windows_10_cmake_Release_graphviz-install-12.2.1-win64.exe.sha256
# 或者直接用 winget 安装然后复制
mkdir -p vendor/graphviz/bin
cp "/c/Program Files/Graphviz/bin/"* vendor/graphviz/bin/
```

macOS / Linux（系统安装也可以）：

| 平台 | 安装命令 |
|------|----------|
| macOS | `brew install graphviz` |
| Ubuntu/Debian | `sudo apt-get install -y graphviz` |
| RHEL/CentOS | `sudo yum install -y graphviz` |
| Arch | `sudo pacman -S --noconfirm graphviz` |

feishu-creator 查找 `dot` 的优先级：`vendor/graphviz/bin/dot` → PATH → 系统已知路径。

#### PlantUML

**推荐：下载 jar 到 vendor/**

1. 确保 Java 可用（如果没有）：
   - Windows: `winget install --id EclipseAdoptium.Temurin.21.JRE --accept-source-agreements --accept-package-agreements`
   - macOS: `brew install --cask temurin`
   - Linux: `sudo apt-get install -y default-jre-headless`

2. 下载 plantuml.jar：
   ```bash
   mkdir -p vendor
   curl -fSL -o vendor/plantuml.jar https://github.com/plantuml/plantuml/releases/latest/download/plantuml.jar
   ```

feishu-creator 会自动检测 `vendor/plantuml.jar` 并使用 `java -jar` 方式调用，无需额外配置。

macOS / Linux 也可以用包管理器直装：`brew install plantuml`、`sudo apt-get install -y plantuml` 等。

#### 安装验证

安装后调用 `render_graphviz_diagram` 和 `render_plantuml_diagram` 验证。HTTP 模式下需先重启服务：`pm2 restart feishu-mcp --update-env`。

## HTTP 多用户部署

当用户需要将 feishu-creator 部署为共享 HTTP 服务时，参考 [references/http-multi-user-recipes.md](references/http-multi-user-recipes.md)。

核心要点：

- `MCP_HTTP_AUTH_TOKEN` 仅保护 MCP 端点的访问权限，不代表终端用户身份。
- 每个 MCP HTTP 会话拥有独立的 `AppContext` 和 `FeishuAuthManager`。
- 身份分三层：应用用户身份（你的系统）→ 飞书授权（OAuth）→ 业务归属（产物所有权）。
- 调用方通过会话初始化 header 注入用户级飞书 token。

## 用户代理 / 网关协议

当调用方是用户控制的 agent 或上游网关时，参考 [references/user-agent-mcp-protocol.md](references/user-agent-mcp-protocol.md)。

## 推荐配套 MCP 工具

用户完成 feishu-creator 安装后，可推荐以下配套工具增强文档工作流。这些工具应安装到**用户全局配置**（`~/.claude/.mcp.json`），不要写入项目级 `.mcp.json`。

详见 [references/companion-mcp-tools.md](references/companion-mcp-tools.md)。

安装流程：

1. 读取用户现有的 `~/.claude/.mcp.json`（可能不存在）。
2. 将所选工具的配置合并写入，保留已有配置。
3. 提醒用户重启 Claude Code 以加载新的 MCP server。

## 护栏

- 报告文件时始终使用绝对路径。
- 默认 `MCP_MODE=auto` + `--stdio`，除非用户明确要求 HTTP。
- 图表工具缺失时引导用户通过步骤 6 安装，不要在 MCP 服务内部自动安装。
- 不要直接输出原始 MCP 工具返回——附上一句解释说明。
- 共享 HTTP 模式下，明确说明 `MCP_HTTP_AUTH_TOKEN` 是传输层访问控制，不是用户身份。
- 不要要求终端用户在 MCP 配置中填写原始账号密码。
