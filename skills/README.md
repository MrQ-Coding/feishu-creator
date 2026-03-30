# Skills

仓库里的 `skills/` 用来和 `src/` 一起维护本地 skill。`src/` 负责 MCP 执行能力，`skills/` 负责给宿主提供工作流、触发条件和 guardrail。

## 当前包含的 skill

### `feishu-setup`

适用场景：

- 安装或初始化 `feishu-creator`
- 把 MCP server 接入 Claude Code、Cursor、Codex 等客户端
- 配置 `.env` 凭据、验证鉴权和启动状态
- 共享 HTTP 部署和多用户 OAuth 配置

目录：

- [`feishu-setup/SKILL.md`](./feishu-setup/SKILL.md)
- [`feishu-setup/references/http-multi-user-recipes.md`](./feishu-setup/references/http-multi-user-recipes.md)
- [`feishu-setup/references/user-agent-mcp-protocol.md`](./feishu-setup/references/user-agent-mcp-protocol.md)
- [`feishu-setup/agents/openai.yaml`](./feishu-setup/agents/openai.yaml)

### `feishu-creator-doc-workflow`

适用场景：

- 按标题执行 section 级替换、插入、复制、移动、删除
- 创建新文档或 wiki 页面
- 将本地 markdown 同步到飞书
- 批量操作多篇文档
- 图表渲染与插入、表格操作

目录：

- [`feishu-creator-doc-workflow/SKILL.md`](./feishu-creator-doc-workflow/SKILL.md)
- [`feishu-creator-doc-workflow/agents/openai.yaml`](./feishu-creator-doc-workflow/agents/openai.yaml)

### `feishu-doc-writer`

适用场景：

- 从零起草飞书文档（技术分析、方案设计、会议纪要、通用文档）
- 重写现有草稿，让结构更清晰
- 把零散笔记整理成有编号的技术说明
- 根据代码阅读结果输出面向团队的中文说明文档

目录：

- [`feishu-doc-writer/SKILL.md`](./feishu-doc-writer/SKILL.md)
- [`feishu-doc-writer/references/template-technical.md`](./feishu-doc-writer/references/template-technical.md)
- [`feishu-doc-writer/references/template-design.md`](./feishu-doc-writer/references/template-design.md)
- [`feishu-doc-writer/references/template-meeting.md`](./feishu-doc-writer/references/template-meeting.md)
- [`feishu-doc-writer/references/template-general.md`](./feishu-doc-writer/references/template-general.md)
- [`feishu-doc-writer/agents/openai.yaml`](./feishu-doc-writer/agents/openai.yaml)

### `feishu-style-extract`

适用场景：

- 从多篇飞书文档中分析个人或团队成员的写作风格
- 为"按某人的文风写作"生成可复用的风格画像
- 校准一组文档的语气、段落节奏、标题习惯和表达方式
- 把分析结果保存回飞书，作为后续写作的风格基线

目录：

- [`feishu-style-extract/SKILL.md`](./feishu-style-extract/SKILL.md)
- [`feishu-style-extract/references/style-profile-template.md`](./feishu-style-extract/references/style-profile-template.md)
- [`feishu-style-extract/agents/openai.yaml`](./feishu-style-extract/agents/openai.yaml)

### `knowledge-qa`

适用场景：

- 遇到技术问题时，先搜索知识库中是否已有解决方案
- 问题解决后，将解决方案记录到知识库
- 首次使用时构建本地知识索引
- 知识库「查 → 解 → 记」闭环工作流

目录：

- [`knowledge-qa/SKILL.md`](./knowledge-qa/SKILL.md)

## Skill 之间的协作关系

```
feishu-setup          → 安装配置完成后，交给 doc-workflow
feishu-doc-workflow   → 文档操作（CRUD），需要写内容时调用 doc-writer
feishu-doc-writer     → 写作内容，需要风格时调用 style-extract
feishu-style-extract  → 风格提取，结果保存后供 doc-writer 复用
knowledge-qa          → 知识库问答闭环，查 → 解 → 记，依赖 doc-workflow 写入
```

## 使用方式

### Claude Code（推荐：Plugin 安装）

feishu-creator 是一个 Claude Code plugin，包含 5 个 skills + MCP server。一条命令完成安装：

```bash
node scripts/installPlugin.mjs
```

脚本会自动：
1. 检查前置依赖（Node.js、git、Claude CLI）
2. 执行 `npm install` 和 `npm run build`（可用 `--skip-build` 跳过）
3. 初始化 `.env`，检查飞书凭据配置
4. 交互式选择 MCP 传输模式（stdio 或 http）；WSL 默认 http
5. 在 `~/.claude/feishu-creator-marketplace/` 创建 marketplace 并安装 plugin
6. 同步 skills 到 Codex（可用 `--claude-only` 跳过）
7. 运行 MCP 冒烟测试验证

可用参数：`--force`（覆盖安装），`--transport=stdio|http`（跳过交互），`--skip-build`，`--claude-only`，`--codex-only`。

安装后重启 Claude Code 即可加载 skills 和 MCP。

> **WSL 注意**：WSL 下 MCP 走 HTTP 模式，需确保 Windows 侧已通过 pm2 启动 HTTP 服务：
> `pm2 start dist/index.js --name feishu-mcp -- --http`

### Codex（Skill 同步）

Codex 不支持 Claude Code plugin 格式，使用独立的 skill 同步脚本：

```bash
# macOS / Linux
npm run skills:sync

# Windows（不支持 symlink，用 copy 模式）
npm run skills:sync -- --mode copy --force
```

同步后重启 Codex 或打开新会话。宿主会先扫描每个 `SKILL.md` 的元数据，再在命中时按需读取正文和 references。

Codex 的 MCP 需要单独配置，在 `~/.codex/` 对应配置文件中添加 feishu-creator MCP server。
