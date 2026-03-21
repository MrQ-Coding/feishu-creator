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

## Skill 之间的协作关系

```
feishu-setup          → 安装配置完成后，交给 doc-workflow
feishu-doc-workflow   → 文档操作（CRUD），需要写内容时调用 doc-writer
feishu-doc-writer     → 写作内容，需要风格时调用 style-extract
feishu-style-extract  → 风格提取，结果保存后供 doc-writer 复用
```

## 使用方式

先把仓库里的 skill 同步到本机 Codex skill 目录：

```bash
npm run skills:sync
```

同步后重启 Codex 或打开新会话。宿主会先扫描每个 `SKILL.md` 的元数据，再在命中时按需读取正文和 references。
