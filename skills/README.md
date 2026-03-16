# Skills

仓库里的 `skills/` 用来和 `src/` 一起维护本地 skill。`src/` 负责 MCP 执行能力，`skills/` 负责给宿主提供工作流、触发条件和 guardrail。

## 当前包含的 skill

### `feishu-creator-doc-workflow`

适用场景：

- 安装或初始化 `feishu-creator`
- 把 MCP server 接入 Codex、Claude Desktop、Cursor 等客户端
- 验证鉴权、启动状态、文档可读性
- 按标题执行 section 级替换、插入、复制、移动、删除

目录：

- [`feishu-creator-doc-workflow/SKILL.md`](./feishu-creator-doc-workflow/SKILL.md)
- [`feishu-creator-doc-workflow/references/setup-recipes.md`](./feishu-creator-doc-workflow/references/setup-recipes.md)
- [`feishu-creator-doc-workflow/references/operation-recipes.md`](./feishu-creator-doc-workflow/references/operation-recipes.md)
- [`feishu-creator-doc-workflow/references/install-report-template.md`](./feishu-creator-doc-workflow/references/install-report-template.md)

### `feishu-doc-writer`

适用场景：

- 从零起草一篇飞书技术文档
- 重写现有草稿，让结构更清晰
- 把零散笔记整理成有编号的技术说明
- 根据代码阅读结果输出面向团队的中文说明文档

目录：

- [`feishu-doc-writer/SKILL.md`](./feishu-doc-writer/SKILL.md)
- [`feishu-doc-writer/references/feishu-note-template.md`](./feishu-doc-writer/references/feishu-note-template.md)
- [`feishu-doc-writer/agents/openai.yaml`](./feishu-doc-writer/agents/openai.yaml)

## 使用方式

先把仓库里的 skill 同步到本机 Codex skill 目录：

```bash
npm run skills:sync
```

同步后重启 Codex 或打开新会话。宿主会先扫描每个 `SKILL.md` 的元数据，再在命中时按需读取正文和 references。
