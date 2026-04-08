# feishu-creator

**让 AI 直接帮你写飞书文档。**

基于 MCP 协议的飞书文档自动化服务，支持 Claude Code、Codex（plugin / skill 一键安装）、Cursor、Windsurf 等 AI 编程工具。告诉 AI 你想写什么，它替你完成从创建文档到发布内容的全过程。

[![Node.js](https://img.shields.io/badge/node-%3E%3D20.17.0-brightgreen)](https://nodejs.org)

---

## 能做什么

- **写文档** — "帮我写一篇技术方案"、"把会议记录整理成飞书文档"、"把这份 Markdown 导入飞书"
- **改内容** — "把第三章换成新版方案"、"在背景章节前面加一段"、"删掉过期的第五章"
- **跨文档操作** — "把这段移到另一篇文档"、"把背景章节复制到设计文档里"
- **图表与图片** — "画一个架构图插到文档里"、"加一个流程图"、"把这张截图上传到文档"
- **表格** — "在文档里插一个对比表"、"更新表格第二行的数据"
- **知识库** — "这个问题记录到知识库"、"搜一下之前怎么解决的"、"帮我建一下知识库索引"
- **Wiki 管理** — "列出所有知识库空间"、"在 Wiki 里新建一个页面"、"把这个文档导出成 Markdown"
- **文风** — "分析我的写作风格"、"按这个风格帮我重写"、"把风格画像保存到飞书"

---

## 上手

1. 登录 [飞书开放平台](https://open.feishu.cn/app?lang=zh-CN)，创建自建应用，添加 `docs:doc`、`wiki:wiki`、`drive:drive:readonly` 等权限，记录 App ID 和 App Secret。
2. 让你的 AI 工具来完成安装：

**Claude Code / Codex**（推荐）— 直接说："帮我安装 feishu-creator，仓库地址 `https://github.com/MrQ-Coding/feishu-creator`"，内置的 `feishu-setup` skill 会自动完成克隆、构建、凭据配置、客户端接入和验证。安装后获得完整的 skills 工作流引导 + MCP 工具能力。

**Cursor / Windsurf / 其他 MCP 客户端** — 克隆仓库后手动配置：

```bash
git clone https://github.com/MrQ-Coding/feishu-creator.git
cd feishu-creator
npm install && cp .env.example .env && npm run build
```

编辑 `.env` 填入 App ID 和 App Secret，然后在客户端 MCP 设置中添加：

```json
{
  "feishu-creator": {
    "command": "node",
    "args": ["/你的路径/feishu-creator/dist/index.js", "--stdio"],
    "cwd": "/你的路径/feishu-creator"
  }
}
```

启用 skills 工作流引导（可选）：在你的 `.cursorrules` / `.windsurfrules` 或项目规则文件中添加以下内容，AI 会按需读取对应的 skill 文件：

```
当任务涉及飞书文档操作时，根据场景读取对应的 skill 获取工作流指引：

- 安装/配置/故障排查 → 读取 feishu-creator/skills/feishu-setup/SKILL.md
- 文档操作（创建/编辑/移动/删除）→ 读取 feishu-creator/skills/feishu-creator-doc-workflow/SKILL.md
- 内容写作/起草 → 读取 feishu-creator/skills/feishu-doc-writer/SKILL.md
- 写作风格分析 → 读取 feishu-creator/skills/feishu-style-extract/SKILL.md
- 知识库问答 → 读取 feishu-creator/skills/knowledge-qa/SKILL.md
```

---

## 内置 Skills

| Skill | 说明 |
|-------|------|
| [feishu-setup](./skills/feishu-setup/SKILL.md) | 安装配置、客户端接入、故障排查、HTTP 部署 |
| [feishu-creator-doc-workflow](./skills/feishu-creator-doc-workflow/SKILL.md) | 文档操作：创建、编辑、移动、复制、删除 |
| [feishu-doc-writer](./skills/feishu-doc-writer/SKILL.md) | 内容写作：技术方案、设计文档、会议纪要、通用文档 |
| [feishu-style-extract](./skills/feishu-style-extract/SKILL.md) | 写作风格分析与画像提取 |

环境变量见 [`.env.example`](./.env.example)。
